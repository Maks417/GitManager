import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { fontsourceWoff2Only } from '../services/build/fontsource-woff2'

describe('packaged font sources', () => {
  for (const [family, weights] of [['sans', [400, 500, 600]], ['mono', [400, 500]]] as const) {
    for (const weight of weights) {
      it(`preserves all IBM Plex ${family} ${weight} faces except their WOFF fallback`, async () => {
        const from = resolve(`node_modules/@fontsource/ibm-plex-${family}/${weight}.css`)
        const original = readFileSync(from, 'utf8')
        const result = await postcss([fontsourceWoff2Only()]).process(original, { from })
        const expected = postcss.parse(original)
        expected.walkDecls('src', (declaration) => {
          declaration.value = postcss.list.comma(declaration.value).filter((source) => source.includes("format('woff2')")).join(', ')
        })
        expect(result.css).toBe(expected.toString())
        expect(result.css).not.toMatch(/\.woff\)/)
        expect(result.css).toContain('unicode-range:')
      })
    }
  }

  it('leaves unrelated font CSS unchanged', async () => {
    const css = "@font-face { src: url(font.woff2) format('woff2'), url(font.woff) format('woff'); }"
    const result = await postcss([fontsourceWoff2Only()]).process(css, { from: resolve('src/custom-font.css') })
    expect(result.css).toBe(css)
  })

  it('fails instead of silently dropping a face without WOFF2', async () => {
    await expect(postcss([fontsourceWoff2Only()]).process('@font-face { src: url(font.woff); }', {
      from: resolve('node_modules/@fontsource/ibm-plex-sans/broken.css')
    })).rejects.toThrow('no WOFF2 source')
  })
})
