import { describe, expect, it } from 'vitest'
import {
  createLanguageLookup,
  HIGHLIGHT_MAX_CHARS,
  highlightLanguage,
  PLAINTEXT,
  type LanguageInfo
} from '../src/renderer/src/logic/syntax-language'

/** A few entries as `monaco.languages.getLanguages()` lists them. */
const LANGUAGES: LanguageInfo[] = [
  { id: 'plaintext', extensions: ['.txt'] },
  { id: 'csharp', extensions: ['.cs', '.csx', '.cake'] },
  { id: 'java', extensions: ['.java', '.jav'] },
  { id: 'go', extensions: ['.go'] },
  { id: 'typescript', extensions: ['.ts', '.tsx', '.cts', '.mts'] },
  { id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
  { id: 'xml', extensions: ['.xml', '.csproj', '.config'] },
  { id: 'html', extensions: ['.html', '.htm'] },
  { id: 'liquid', extensions: ['.liquid', '.html.liquid'] },
  { id: 'pascal', extensions: ['.pas', '.pp'] },
  { id: 'ruby', extensions: ['.rb', '.pp'] }
]

describe('createLanguageLookup', () => {
  const languageFor = createLanguageLookup(LANGUAGES)

  it('finds the language by extension, ignoring case and folders', () => {
    expect(languageFor('src/Services/OrderService.cs')).toBe('csharp')
    expect(languageFor('app/src/main/java/Main.JAVA')).toBe('java')
    expect(languageFor('cmd/server/main.go')).toBe('go')
    expect(languageFor('src/App.tsx')).toBe('typescript')
    expect(languageFor('src\Legacy\Project.CSPROJ')).toBe('xml')
  })

  it('prefers a known file name, then the longest extension', () => {
    expect(languageFor('docker/Dockerfile')).toBe('dockerfile')
    expect(languageFor('templates/page.html.liquid')).toBe('liquid')
    expect(languageFor('templates/page.min.html')).toBe('html')
  })

  it('keeps an extension with the first language that claims it', () => {
    expect(languageFor('manifests/site.pp')).toBe('pascal')
  })

  it('adds common extensions Monaco does not list, only for grammars it has', () => {
    expect(languageFor('Resources/Strings.resx')).toBe('xml')
    expect(languageFor('components/Button.vue')).toBe('html')
    expect(languageFor('settings.jsonc')).toBe(PLAINTEXT)
  })

  it('falls back to plain text', () => {
    expect(languageFor('README')).toBe(PLAINTEXT)
    expect(languageFor('data/export.unknownext')).toBe(PLAINTEXT)
    expect(languageFor('.hidden/')).toBe(PLAINTEXT)
  })
})

describe('highlightLanguage', () => {
  it('keeps the language when colors are on and the text is small enough', () => {
    expect(highlightLanguage('csharp', true, 0)).toBe('csharp')
    expect(highlightLanguage('csharp', true, HIGHLIGHT_MAX_CHARS)).toBe('csharp')
  })

  it('shows plain text when colors are off or the text is too long', () => {
    expect(highlightLanguage('csharp', false, 10)).toBe(PLAINTEXT)
    expect(highlightLanguage('csharp', true, HIGHLIGHT_MAX_CHARS + 1)).toBe(PLAINTEXT)
  })
})
