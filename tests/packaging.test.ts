import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const { encodeManifest, filesUnder, thirdPartyNotices } = createRequire(import.meta.url)('../scripts/after-pack.cjs') as {
  encodeManifest(files: string[]): Buffer
  filesUnder(directory: string): Promise<string[]>
  thirdPartyNotices(projectDir: string): Promise<string>
}
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('Windows compression manifest', () => {
  it('contains exact relative Unicode filenames in UTF-16LE for the NSIS reader', () => {
    const encoded = encodeManifest(['resources/app.asar', 'Git Manager.exe', 'locales/日本語.pak', 'resources/app.asar'])
    expect(encoded.toString('utf16le')).toBe('Git Manager.exe\r\nlocales\\日本語.pak\r\nresources\\app.asar\r\n')
    expect(encoded.subarray(0, 2)).toEqual(Buffer.from('G', 'utf16le'))
  })

  it.each(['../outside', 'resources/../../outside', '/absolute', 'C:\\outside', 'file:stream', 'resources/*.pak', 'a?b', 'a"b', 'a\nb', './file', 'a//b'])('rejects unsafe path %j', (file) => {
    expect(() => encodeManifest([file])).toThrow('Unsafe compression manifest path')
  })

  it('rejects paths the NSIS reader could truncate', () => {
    expect(() => encodeManifest(['a'.repeat(501)])).toThrow('too long')
  })

  it('lists only files in the staged application, including nested resources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gitmanager-packaging-'))
    directories.push(directory)
    await mkdir(join(directory, 'resources'))
    await writeFile(join(directory, 'Git Manager.exe'), 'binary')
    await writeFile(join(directory, 'resources/app.asar'), 'archive')
    expect(await filesUnder(directory)).toEqual(['Git Manager.exe', 'resources/app.asar'])
  })

  it('rejects a junction instead of following it into another directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gitmanager-packaging-'))
    directories.push(directory)
    await mkdir(join(directory, 'staged'))
    await mkdir(join(directory, 'outside'))
    await writeFile(join(directory, 'outside', 'user-data'), 'untouched')
    await symlink(join(directory, 'outside'), join(directory, 'staged', 'resources'), 'junction')
    await expect(filesUnder(join(directory, 'staged'))).rejects.toThrow('Unexpected link')
  })
})

it('keeps complete license notices for backend and renderer dependencies', async () => {
  const notices = await thirdPartyNotices(resolve('.'))
  for (const name of ['electron-updater', 'zod', 'react-dom', 'monaco-editor', 'lucide-react', '@fontsource/ibm-plex-sans', '@fontsource/ibm-plex-mono']) {
    expect(notices).toContain(`${name}@`)
  }
  expect(notices).toContain('SIL OPEN FONT LICENSE')
  expect(notices).toContain('Permission is hereby granted')
})
