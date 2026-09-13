import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import png2icons from 'png2icons'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const rendererDir = join(root, 'src', 'renderer')
const svgPath = join(buildDir, 'icon.svg')

async function raster(size) {
  return sharp(svgPath).resize(size, size).png().toBuffer()
}

async function main() {
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(rendererDir, { recursive: true })

  const png1024 = await raster(1024)
  writeFileSync(join(buildDir, 'icon.png'), png1024)

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoPngs = await Promise.all(icoSizes.map((s) => raster(s)))
  const ico = await pngToIco(icoPngs)
  writeFileSync(join(buildDir, 'icon.ico'), ico)

  const icns = png2icons.createICNS(png1024, png2icons.BILINEAR, 0)
  if (!icns) throw new Error('Failed to create icon.icns')
  writeFileSync(join(buildDir, 'icon.icns'), icns)

  copyFileSync(svgPath, join(rendererDir, 'favicon.svg'))

  const faviconPngs = await Promise.all([16, 32, 48].map((s) => raster(s)))
  const faviconIco = await pngToIco(faviconPngs)
  writeFileSync(join(rendererDir, 'favicon.ico'), faviconIco)

  try {
    rmSync(join(buildDir, '.gitkeep'), { force: true })
  } catch {
    /* ignore */
  }

  console.log('Generated:')
  console.log('  build/icon.svg (source)')
  console.log('  build/icon.png')
  console.log('  build/icon.ico')
  console.log('  build/icon.icns')
  console.log('  src/renderer/favicon.svg')
  console.log('  src/renderer/favicon.ico')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
