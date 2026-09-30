import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import * as monaco from './monaco-api'
import { letTabLeaveReadOnlyEditors } from './monaco-keys'
import { MONACO_DARK_THEME } from './theme'

const F1 = monaco.KeyCode.F1
const CTRL_SHIFT_P = monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP
const QUICK_COMMAND_ID = 'editor.action.quickCommand'
const SEPARATOR_ID = 'vs.actions.separator'

type MenuActionLike = { id?: string }

/**
 * Monaco has no public API to drop a single context-menu item. Patch the
 * context-menu contribution so Command Palette never appears.
 */
function stripCommandPaletteFromContextMenu(editor: monaco.editor.ICodeEditor): void {
  const contribution = editor.getContribution('editor.contrib.contextmenu') as {
    _getMenuActions?: (...args: unknown[]) => MenuActionLike[]
  } | null
  if (!contribution?._getMenuActions) return

  const original = contribution._getMenuActions.bind(contribution)
  contribution._getMenuActions = (...args: unknown[]) => {
    const filtered = original(...args).filter((item) => item.id !== QUICK_COMMAND_ID)
    const cleaned: MenuActionLike[] = []
    for (const item of filtered) {
      if (item.id === SEPARATOR_ID && (cleaned.length === 0 || cleaned[cleaned.length - 1]?.id === SEPARATOR_ID)) {
        continue
      }
      cleaned.push(item)
    }
    while (cleaned.length > 0 && cleaned[cleaned.length - 1]?.id === SEPARATOR_ID) {
      cleaned.pop()
    }
    return cleaned
  }
}

/**
 * Monaco ships an F1 / Ctrl+Shift+P "Command Palette" (quick command). Unbind it
 * globally and remove it from the editor context menu in diffs / merge UI.
 */
function disableCommandPalette(m: typeof monaco): void {
  m.editor.addKeybindingRule({ keybinding: F1, command: null })
  m.editor.addKeybindingRule({ keybinding: CTRL_SHIFT_P, command: null })

  m.editor.onDidCreateEditor((editor) => {
    // Contribution may not be attached synchronously in every Monaco build.
    queueMicrotask(() => stripCommandPaletteFromContextMenu(editor))

    const standalone = editor as monaco.editor.IStandaloneCodeEditor
    if (typeof standalone.addCommand !== 'function') return
    standalone.addCommand(F1, () => undefined)
    standalone.addCommand(CTRL_SHIFT_P, () => undefined)
    standalone.addAction({
      id: QUICK_COMMAND_ID,
      label: 'Command Palette',
      precondition: 'false',
      run: () => undefined
    })
  })
}

/**
 * Dusk: the dark theme's surfaces and a softer palette in place of vs-dark's cool gray editor, saturated diff slabs and
 * neon brackets. Colors mirror the `[data-theme="dark"]` tokens in global.css (Monaco needs literal hex).
 */
function defineDarkTheme(m: typeof monaco): void {
  const bg = '#1A1917'
  const panel = '#211F1C'
  const elevated = '#2A2825'
  const border = '#3A3631'
  const text = '#D6D0C6'
  const muted = '#A39A8E'
  const added = '#7FAE82'
  const removed = '#E87070'
  const accent = '#EB7A45'

  m.editor.defineTheme(MONACO_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: text.slice(1) },
      { token: 'keyword', foreground: 'C49BD6' },
      { token: 'type', foreground: '7FB8C9' },
      { token: 'string', foreground: 'A9C48C' },
      { token: 'string.escape', foreground: 'DCB567' },
      { token: 'string.key.json', foreground: 'C9B48A' },
      { token: 'string.value.json', foreground: 'A9C48C' },
      { token: 'number', foreground: 'DCB567' },
      { token: 'comment', foreground: '948B80', fontStyle: 'italic' },
      { token: 'regexp', foreground: 'D98E6A' },
      { token: 'tag', foreground: 'C49BD6' },
      { token: 'metatag', foreground: 'C49BD6' },
      { token: 'attribute.name', foreground: 'C9B48A' },
      { token: 'attribute.value', foreground: 'A9C48C' },
      { token: 'variable', foreground: 'C9B48A' },
      { token: 'delimiter', foreground: muted.slice(1) }
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': text,
      'editorGutter.background': bg,
      'editorLineNumber.foreground': '#7D756B',
      'editorLineNumber.activeForeground': muted,
      'editor.lineHighlightBackground': panel,
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': `${accent}40`,
      'editor.inactiveSelectionBackground': `${accent}26`,
      'editorCursor.foreground': accent,
      'editorIndentGuide.background1': '#2F2C28',
      'editorIndentGuide.activeBackground1': '#4A453E',
      'editorBracketHighlight.foreground1': '#C9B48A',
      'editorBracketHighlight.foreground2': '#B89AC9',
      'editorBracketHighlight.foreground3': '#8FB3C4',
      'editorBracketHighlight.foreground4': '#C9B48A',
      'editorBracketHighlight.foreground5': '#B89AC9',
      'editorBracketHighlight.foreground6': '#8FB3C4',
      'diffEditor.insertedLineBackground': `${added}1A`,
      'diffEditor.insertedTextBackground': `${added}38`,
      'diffEditor.removedLineBackground': `${removed}1A`,
      'diffEditor.removedTextBackground': `${removed}38`,
      'diffEditorOverview.insertedForeground': `${added}99`,
      'diffEditorOverview.removedForeground': `${removed}99`,
      'diffEditor.diagonalFill': `${border}99`,
      'diffEditor.unchangedRegionBackground': panel,
      'scrollbarSlider.background': '#4A453E66',
      'scrollbarSlider.hoverBackground': '#4A453E99',
      'scrollbarSlider.activeBackground': '#4A453ECC',
      'editorOverviewRuler.border': '#00000000',
      'editorWidget.background': elevated,
      'editorWidget.border': border,
      'menu.background': elevated,
      'menu.foreground': text,
      'menu.border': border,
      'menu.selectionBackground': `${accent}33`,
      'menu.selectionForeground': text,
      'menu.separatorBackground': border
    }
  })
}

/**
 * @monaco-editor/react defaults to a CDN loader. Electron CSP blocks those
 * scripts, so DiffEditor stays on "Loading…" forever. Bundle Monaco locally.
 */
export function setupMonaco(): void {
  // Monaco is loaded without language services (see monaco-api), so the editor worker, which computes diffs, is
  // the only worker it asks for.
  ;(globalThis as unknown as { MonacoEnvironment: { getWorker: (id: string, label: string) => Worker } }).MonacoEnvironment =
    {
      getWorker: () => new editorWorker()
    }

  // JSON keeps only its main-thread tokenizer: every other feature of its language service asks a worker. Set
  // before the first JSON model, when the service reads this configuration.
  monaco.languages.json.jsonDefaults.setModeConfiguration({
    tokens: true,
    documentFormattingEdits: false,
    documentRangeFormattingEdits: false,
    completionItems: false,
    hovers: false,
    documentSymbols: false,
    colors: false,
    foldingRanges: false,
    diagnostics: false,
    selectionRanges: false
  })

  loader.config({ monaco })
  defineDarkTheme(monaco)
  disableCommandPalette(monaco)
  letTabLeaveReadOnlyEditors()
}
