import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

const F1 = monaco.KeyCode.F1
const CTRL_SHIFT_P = monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP

/**
 * Monaco ships an F1 / Ctrl+Shift+P "Command Palette" (quick command). Unbind it
 * globally and no-op it on every editor so it never appears in diffs or merge UI.
 */
function disableCommandPalette(m: typeof monaco): void {
  m.editor.addKeybindingRule({ keybinding: F1, command: null })
  m.editor.addKeybindingRule({ keybinding: CTRL_SHIFT_P, command: null })

  m.editor.onDidCreateEditor((editor) => {
    const standalone = editor as monaco.editor.IStandaloneCodeEditor
    if (typeof standalone.addCommand !== 'function') return
    standalone.addCommand(F1, () => undefined)
    standalone.addCommand(CTRL_SHIFT_P, () => undefined)
    // Replace the built-in action so it stays out of the editor context menu.
    standalone.addAction({
      id: 'editor.action.quickCommand',
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
}
