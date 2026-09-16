/**
 * The Monaco the app uses: the editor with all its built-in features and Monarch syntax highlighting, without the
 * TypeScript/JavaScript, CSS, HTML and JSON language services of the `monaco-editor` entry. A diff of such a file
 * would start that service's worker — for TypeScript and JavaScript one TypeScript compiler each, which Monaco never
 * stops — only to check code in a read-only diff that shows no diagnostics. Import Monaco from here, never from
 * 'monaco-editor' (lint enforces it).
 */
import 'monaco-editor/esm/vs/editor/edcore.main'
// Syntax colors for every language; each grammar loads on first use.
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution'
// JSON has no Monarch grammar: its language service tokenizes on the main thread. setupMonaco turns off everything
// else it offers, so it never starts its worker.
import 'monaco-editor/esm/vs/language/json/monaco.contribution'

export * from 'monaco-editor/esm/vs/editor/editor.api'
