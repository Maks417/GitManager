import { list, type Plugin } from 'postcss'

/** Electron supports WOFF2; keep Fontsource's weights and character subsets intact. */
export function fontsourceWoff2Only(): Plugin {
  return {
    postcssPlugin: 'git-manager-fontsource-woff2',
    Once(root) {
      const file = root.source?.input.file?.replace(/\\/g, '/') ?? ''
      if (!/\/node_modules\/@fontsource\/ibm-plex-(?:sans|mono)\//.test(file)) return

      root.walkAtRules('font-face', (face) => {
        face.walkDecls('src', (declaration) => {
          const sources = list.comma(declaration.value)
          const woff2 = sources.filter((source) => /format\(['"]?woff2['"]?\)/.test(source))
          if (woff2.length === 0) throw declaration.error('Fontsource face has no WOFF2 source')
          declaration.value = woff2.join(', ')
        })
      })
    }
  }
}
