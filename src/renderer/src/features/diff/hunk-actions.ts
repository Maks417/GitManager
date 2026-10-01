import type { DiffHunk, PartialAction, PartialSelection } from '@shared/ipc'
import type * as monaco from '../../lib/monaco-api'
import { firstChangeLine, hunkAtLine, hunkLineRange, selectedChanges, selectionLines } from '../../logic/hunk-selection'

export interface HunkActionsOptions {
  /** Which diff is shown: unstaged changes can be staged or discarded, staged ones unstaged. */
  side: 'staged' | 'unstaged'
  /** Runs the action; the buttons stay disabled until it settles. */
  run: (selection: PartialSelection, action: PartialAction) => Promise<void>
}

/** Mouse targets in the content view zone of a deleted block (inline diff): `afterLineNumber` says where. */
const CONTENT_VIEW_ZONE = 8

const pluralLines = (n: number): string => `${n} line${n === 1 ? '' : 's'}`

/**
 * A small toolbar above the hunk under the pointer (or the cursor) of a read-only diff: Stage / Discard hunk, or
 * Unstage hunk, and the same for the changed lines selected in the editor. Monaco's own gutter menu stays off; it
 * cannot stage from a read-only diff.
 */
export function attachHunkActions(
  diffEditor: monaco.editor.IStandaloneDiffEditor,
  hunks: DiffHunk[],
  getOptions: () => HunkActionsOptions
): () => void {
  const modified = diffEditor.getModifiedEditor()
  const original = diffEditor.getOriginalEditor()
  const node = document.createElement('div')
  node.className = 'hunk-actions'
  node.setAttribute('role', 'toolbar')
  node.setAttribute('aria-label', 'Hunk actions')
  // Clicks on the toolbar must not move the editor's selection, which the line buttons read.
  node.addEventListener('mousedown', (e) => e.stopPropagation())

  const widget: monaco.editor.IOverlayWidget = {
    getId: () => 'gitmanager.hunkActions',
    getDomNode: () => node,
    getPosition: () => null
  }
  modified.addOverlayWidget(widget)

  let active = hunks.length > 0 ? 0 : -1
  let pending = false
  let disposed = false
  /** The editor whose selection picks lines: the original one only in a side-by-side diff. */
  let selectionSource: 'modified' | 'original' = 'modified'

  const lineSelection = (): { oldLines: number[]; newLines: number[] } | null => {
    const editor = selectionSource === 'original' ? original : modified
    const lines = selectionLines(editor.getSelections() ?? [])
    if (lines.size === 0) return null
    const picked =
      selectionSource === 'original'
        ? selectedChanges(hunks, new Set(), lines)
        : selectedChanges(hunks, lines, new Set())
    return picked.oldLines.length + picked.newLines.length > 0 ? picked : null
  }

  const button = (label: string, title: string, onClick: () => void, danger = false): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = danger ? 'hunk-action hunk-action-danger' : 'hunk-action'
    b.textContent = label
    b.title = title
    b.disabled = pending
    b.addEventListener('click', onClick)
    return b
  }

  const runAction = (selection: PartialSelection, action: PartialAction): void => {
    if (pending) return
    pending = true
    render()
    void getOptions()
      .run(selection, action)
      .finally(() => {
        if (disposed) return
        pending = false
        render()
      })
  }

  const render = (): void => {
    node.replaceChildren()
    if (active < 0) {
      node.style.display = 'none'
      return
    }
    const { side } = getOptions()
    const hunk = { hunk: active }
    const lines = lineSelection()
    const count = lines ? lines.oldLines.length + lines.newLines.length : 0
    if (side === 'unstaged') {
      node.append(
        button('Stage hunk', 'Stage this hunk', () => runAction(hunk, 'stage')),
        button('Discard hunk', 'Discard this hunk from the file', () => runAction(hunk, 'discard'), true)
      )
      if (lines) {
        node.append(
          button(`Stage ${pluralLines(count)}`, 'Stage the selected changed lines', () => runAction(lines, 'stage')),
          button(
            `Discard ${pluralLines(count)}`,
            'Discard the selected changed lines from the file',
            () => runAction(lines, 'discard'),
            true
          )
        )
      }
    } else {
      node.append(button('Unstage hunk', 'Unstage this hunk', () => runAction(hunk, 'unstage')))
      if (lines) {
        node.append(
          button(`Unstage ${pluralLines(count)}`, 'Unstage the selected changed lines', () => runAction(lines, 'unstage'))
        )
      }
    }
    position()
  }

  /** Above the hunk's first change, at the right edge; pinned to the top while the hunk is scrolled through. */
  const position = (): void => {
    if (active < 0) return
    const hunk = hunks[active]
    const lineCount = modified.getModel()?.getLineCount() ?? 0
    const { end } = hunkLineRange(hunk)
    const anchor = Math.min(firstChangeLine(hunk), Math.max(1, lineCount))
    const scrollTop = modified.getScrollTop()
    const height = node.offsetHeight || 24
    const viewHeight = modified.getLayoutInfo().height
    const top = modified.getTopForLineNumber(anchor, true) - scrollTop - height - 2
    const bottom = modified.getBottomForLineNumber(Math.min(end, Math.max(1, lineCount))) - scrollTop
    if (lineCount === 0 || bottom < 0 || top > viewHeight) {
      node.style.display = 'none'
      return
    }
    node.style.display = ''
    node.style.top = `${Math.max(2, Math.min(top, bottom - height))}px`
    node.style.right = `${modified.getLayoutInfo().verticalScrollbarWidth + 12}px`
  }

  const activate = (index: number): void => {
    if (index < 0 || index === active) return
    active = index
    render()
  }

  const disposables: monaco.IDisposable[] = [
    modified.onMouseMove((e) => {
      const line =
        e.target.position?.lineNumber ??
        (e.target.type === CONTENT_VIEW_ZONE ? (e.target.detail as { afterLineNumber: number }).afterLineNumber + 1 : null)
      if (line !== null) activate(hunkAtLine(hunks, line))
    }),
    modified.onDidChangeCursorSelection((e) => {
      selectionSource = 'modified'
      activate(hunkAtLine(hunks, e.selection.positionLineNumber))
      render()
    }),
    original.onDidChangeCursorSelection(() => {
      if (!original.hasTextFocus()) return
      selectionSource = 'original'
      render()
    }),
    modified.onDidScrollChange(position),
    modified.onDidLayoutChange(position)
  ]
  render()

  return () => {
    disposed = true
    for (const d of disposables) d.dispose()
    try {
      modified.removeOverlayWidget(widget)
    } catch {
      // The editor may already be gone.
    }
  }
}
