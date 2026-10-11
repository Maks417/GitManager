const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire, builtinModules } = require('node:module')
const { listPackage, extractFile } = require('@electron/asar')

const manifestName = 'compression-files.txt'
const noticeName = 'THIRD-PARTY-NOTICES.txt'
const bundledPackages = [
  'zod', 'electron-updater', 'react', 'react-dom', '@monaco-editor/react',
  'monaco-editor', 'lucide-react', '@fontsource/ibm-plex-sans', '@fontsource/ibm-plex-mono'
]

async function filesUnder(directory, prefix = '') {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in packaged files: ${relative}`)
    if (entry.isDirectory()) files.push(...await filesUnder(path.join(directory, entry.name), relative + '/'))
    else if (entry.isFile()) files.push(relative)
  }
  return files.sort()
}

function encodeManifest(files) {
  const normalized = files.map((file) => {
    const parts = file.replace(/\\/g, '/').split('/')
    if (parts.some((part) => !part || part === '.' || part === '..' || /[:"*?<>|\r\n\0]/.test(part))) {
      throw new Error(`Unsafe compression manifest path: ${file}`)
    }
    // NSIS's Unicode strings are bounded; refuse truncation instead of changing the target.
    if (file.length > 500) throw new Error(`Compression manifest path is too long: ${file}`)
    return parts.join('\\')
  })
  return Buffer.from([...new Set(normalized)].sort().join('\r\n') + '\r\n', 'utf16le')
}

async function thirdPartyNotices(projectDir) {
  const seen = new Set()
  const notices = []
  async function visit(name, from) {
    const resolve = createRequire(path.join(from, 'package.json')).resolve
    let packageFile
    try {
      packageFile = resolve(`${name}/package.json`)
    } catch {
      let directory = path.dirname(resolve(name))
      while (true) {
        try {
          const candidate = path.join(directory, 'package.json')
          if (JSON.parse(await fs.readFile(candidate, 'utf8')).name === name) {
            packageFile = candidate
            break
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        const parent = path.dirname(directory)
        if (parent === directory) throw new Error(`Cannot locate license package: ${name}`)
        directory = parent
      }
    }
    const metadata = JSON.parse(await fs.readFile(packageFile, 'utf8'))
    const identity = `${metadata.name}@${metadata.version}`
    if (seen.has(identity)) return
    seen.add(identity)
    const directory = path.dirname(packageFile)
    const licenseFiles = (await fs.readdir(directory)).filter((file) => /^(licen[sc]e|copying|notice)(?:$|[.-])/i.test(file)).sort()
    if (licenseFiles.length === 0 && identity !== 'lazy-val@1.0.5') throw new Error(`Missing license notice for ${identity}`)
    // lazy-val's published package and upstream repository supply only this license declaration.
    const text = licenseFiles.length > 0
      ? await Promise.all(licenseFiles.map(async (file) => `${file}\n${await fs.readFile(path.join(directory, file), 'utf8')}`))
      : [`package.json license declaration: ${metadata.license}\nAuthor: ${metadata.author}\nRepository: ${metadata.repository}`]
    notices.push(`${identity} (${metadata.license ?? 'see notice'})\n${text.join('\n')}`)
    for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) await visit(dependency, directory)
  }
  for (const name of bundledPackages) await visit(name, projectDir)
  return 'Git Manager bundled third-party software notices\n\n' + notices.sort().join('\n\n' + '-'.repeat(72) + '\n\n') + '\n'
}

function verifyArchive(archive) {
  const files = listPackage(archive).map((file) => file.replace(/\\/g, '/').replace(/^\//, ''))
  const requireFile = (file) => {
    if (!files.includes(file)) throw new Error(`Packaged application is missing ${file}`)
  }
  for (const file of ['out/main/index.js', 'out/main/git-utility.js', 'out/preload/index.js', 'out/renderer/index.html']) requireFile(file)
  if (files.some((file) => file.startsWith('node_modules/'))) throw new Error('Unexpected external dependency in application archive')
  if (files.some((file) => /\.woff$/i.test(file))) throw new Error('Unexpected WOFF fallback in application archive')
  if (!files.some((file) => /editor\.worker.*\.js$/.test(file))) throw new Error('Monaco editor worker is missing')
  if (!files.some((file) => /\.woff2$/.test(file))) throw new Error('WOFF2 fonts are missing')
  const updaterChunks = files.filter((file) => /^out\/main\/.+\.js$/.test(file) && file !== 'out/main/index.js' && file !== 'out/main/git-utility.js')
  if (updaterChunks.length === 0) throw new Error('Lazy backend chunks are missing')
  const externals = new Set(['electron', ...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
  for (const file of files.filter((file) => /^out\/(main|preload)\/.+\.js$/.test(file))) {
    const source = extractFile(archive, path.normalize(file)).toString('utf8')
    for (const match of source.matchAll(/\brequire\((["'])([^"']+)\1\)/g)) {
      if (!match[2].startsWith('.') && !externals.has(match[2])) {
        throw new Error(`Unbundled runtime import in ${file}: ${match[2]}`)
      }
    }
  }
  return { archiveBytes: require('node:fs').statSync(archive).size, files: files.length }
}

async function afterPack(context) {
  const projectDir = context.packager.projectDir ?? context.packager.info.projectDir
  const resources = context.packager.getResourcesDir(context.appOutDir)
  await fs.writeFile(path.join(resources, noticeName), await thirdPartyNotices(projectDir))
  const archive = path.join(resources, 'app.asar')
  const summary = verifyArchive(archive)
  for (const file of await filesUnder(path.join(projectDir, 'out', 'renderer'))) {
    const source = await fs.readFile(path.join(projectDir, 'out', 'renderer', file))
    if (!source.equals(extractFile(archive, path.normalize(`out/renderer/${file}`)))) throw new Error(`Renderer asset changed during packaging: ${file}`)
  }
  if (context.electronPlatformName === 'win32') {
    const files = (await filesUnder(context.appOutDir)).filter((file) => file !== `resources/${manifestName}`)
    // NSIS adds its elevation helper after afterPack. Its name is fixed and owned by the installer.
    if (!files.includes('resources/elevate.exe')) files.push('resources/elevate.exe')
    if (!files.includes('resources/app-update.yml')) files.push('resources/app-update.yml')
    files.push(`resources/${manifestName}`)
    await fs.writeFile(path.join(resources, manifestName), encodeManifest(files))
    const packagedLocales = files.filter((file) => file.startsWith('locales/')).map((file) => file.slice(8)).sort()
    if (process.platform === 'win32') {
      const sourceLocales = (await fs.readdir(path.join(projectDir, 'node_modules/electron/dist/locales'))).sort()
      if (JSON.stringify(packagedLocales) !== JSON.stringify(sourceLocales)) throw new Error('Electron locales changed during packaging')
    }
  }
  console.log(`Verified application archive: ${summary.files} entries, ${(summary.archiveBytes / 1e6).toFixed(2)} MB`)
}

module.exports = afterPack
module.exports.filesUnder = filesUnder
module.exports.encodeManifest = encodeManifest
module.exports.thirdPartyNotices = thirdPartyNotices
module.exports.verifyArchive = verifyArchive
