/** What Monaco says about a language it knows (`monaco.languages.getLanguages()`). */
export interface LanguageInfo {
  id: string
  extensions?: string[]
  filenames?: string[]
}

export const PLAINTEXT = 'plaintext'

/**
 * Longer text is shown without syntax colors. Monaco colors on the main thread, in idle slices after the visible
 * lines; for the merge editor's three panes of up to 8 MB each that would keep the CPU busy for seconds and hold tens
 * of MB of tokens. Diffs are capped well below this (MAX_DIFF_CHARS in the git worker).
 */
export const HIGHLIGHT_MAX_CHARS = 1_000_000

/** Common files whose extension Monaco doesn't list, mapped to the grammar that fits them. */
const EXTRA_EXTENSIONS: Record<string, string> = {
  '.jsonc': 'json',
  '.razor': 'razor',
  '.resx': 'xml',
  '.nuspec': 'xml',
  '.manifest': 'xml',
  '.plist': 'xml',
  '.vue': 'html',
  '.svelte': 'html',
  '.toml': 'ini'
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase()
}

/**
 * Finds a file's language by its name, then by its longest known extension (`.html.liquid` before `.liquid`),
 * ignoring case. The first language that claims a name or extension keeps it.
 */
export function createLanguageLookup(languages: readonly LanguageInfo[]): (path: string) => string {
  const byFilename = new Map<string, string>()
  const byExtension = new Map<string, string>()
  for (const language of languages) {
    for (const name of language.filenames ?? []) {
      if (!byFilename.has(name.toLowerCase())) byFilename.set(name.toLowerCase(), language.id)
    }
    for (const ext of language.extensions ?? []) {
      if (!byExtension.has(ext.toLowerCase())) byExtension.set(ext.toLowerCase(), language.id)
    }
  }
  for (const [ext, id] of Object.entries(EXTRA_EXTENSIONS)) {
    if (!byExtension.has(ext) && languages.some((l) => l.id === id)) byExtension.set(ext, id)
  }

  return (path) => {
    const name = fileName(path)
    const named = byFilename.get(name)
    if (named) return named
    for (let dot = name.indexOf('.'); dot !== -1; dot = name.indexOf('.', dot + 1)) {
      const id = byExtension.get(name.slice(dot))
      if (id) return id
    }
    return PLAINTEXT
  }
}

/** True when the text is too long to color, whatever the setting. */
export function tooLargeToHighlight(textLength: number): boolean {
  return textLength > HIGHLIGHT_MAX_CHARS
}

/** The language to give Monaco: the file's own one, or plain text when colors are off or the text too long. */
export function highlightLanguage(language: string, enabled: boolean, textLength: number): string {
  return enabled && !tooLargeToHighlight(textLength) ? language : PLAINTEXT
}
