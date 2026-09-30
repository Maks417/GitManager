import { createLanguageLookup, highlightLanguage } from '../logic/syntax-language'
import * as monaco from './monaco-api'

let lookup: ((path: string) => string) | null = null

/** The Monaco language for a file path, from the grammars monaco-api registers; `plaintext` when none fits. */
export function languageForPath(path: string): string {
  lookup ??= createLanguageLookup(monaco.languages.getLanguages())
  return lookup(path)
}

/** The language a Monaco model for this file should use, given the syntax colors setting and the longest text. */
export function syntaxLanguageFor(path: string, enabled: boolean, textLength: number): string {
  return highlightLanguage(languageForPath(path), enabled, textLength)
}
