import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { letTabLeaveReadOnlyEditors } from './monaco-keys'

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
 * @monaco-editor/react defaults to a CDN loader. Electron CSP blocks those
 * scripts, so DiffEditor stays on "Loading…" forever. Bundle Monaco locally.
 */
export function setupMonaco(): void {
  ;(globalThis as unknown as { MonacoEnvironment: { getWorker: (id: string, label: string) => Worker } }).MonacoEnvironment =
    {
      getWorker(_workerId: string, label: string): Worker {
        switch (label) {
          case 'json':
            return new jsonWorker()
          case 'css':
          case 'scss':
          case 'less':
            return new cssWorker()
          case 'html':
          case 'handlebars':
          case 'razor':
            return new htmlWorker()
          case 'typescript':
          case 'javascript':
            return new tsWorker()
          default:
            return new editorWorker()
        }
      }
    }

  loader.config({ monaco })
  disableCommandPalette(monaco)
  letTabLeaveReadOnlyEditors()
}
