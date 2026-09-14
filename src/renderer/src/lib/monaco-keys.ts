import * as monaco from 'monaco-editor'

let installed = false

/**
 * Tab and Shift+Tab leave a read-only editor, as they leave any other control. Monaco binds Tab in every
 * editor, read-only ones included, and in 0.52 its `tabFocusMode` option changes nothing; so in a
 * read-only editor the key is kept from Monaco's keybindings and the browser moves focus instead.
 * Editable editors (the merge result) still indent with Tab.
 */
export function letTabLeaveReadOnlyEditors(): void {
  if (installed) return
  installed = true
  monaco.editor.onDidCreateEditor((editor) => {
    editor.onKeyDown((e) => {
      if (e.keyCode !== monaco.KeyCode.Tab || e.ctrlKey || e.altKey || e.metaKey) return
      if (!editor.getOption(monaco.editor.EditorOption.readOnly)) return
      // Monaco's keybinding listener sits on an ancestor of the editor's text area.
      e.stopPropagation()
    })
  })
}
