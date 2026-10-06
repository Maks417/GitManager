import type { ConflictRegion, RegionChoice } from '@merge-core/conflict'
import type * as monaco from '../../lib/monaco-api'

export interface ConflictActionsOptions {
  /** The conflict the toolbar acts on; none hides it. */
  region: () => ConflictRegion | null
  accept: (choice: RegionChoice) => void
  /** The pointer is over this 0-based result line. */
  hover: (line: number) => void
}

const ACTIONS: { choice: RegionChoice; label: string; title: string }[] = [
  { choice: 'ours', label: 'Accept ours', title: 'Keep the ours side of this conflict' },
  { choice: 'theirs', label: 'Accept theirs', title: 'Keep the theirs side of this conflict' },
  { choice: 'both', label: 'Both', title: 'Keep both sides: ours, then theirs' },
  { choice: 'both-theirs-first', label: 'Both, theirs first', title: 'Keep both sides: theirs, then ours' }
]

/**
 * A small toolbar at the active conflict of the result editor, pinned to its top edge while the conflict is scrolled
 * through, like the hunk toolbar of the Changes diff. Call `update` after the conflict or the text changes.
 */
export function attachConflictActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  options: ConflictActionsOptions
): { update: () => void; dispose: () => void } {
  const node = document.createElement('div')
  node.className = 'hunk-actions merge-conflict-actions'
  node.setAttribute('role', 'toolbar')
  node.setAttribute('aria-label', 'Conflict actions')
  // Clicks on the toolbar must not move the cursor, which picks the active conflict.
  node.addEventListener('mousedown', (e) => e.stopPropagation())
  for (const action of ACTIONS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `hunk-action merge-action-${action.choice}`
    b.textContent = action.label
    b.title = action.title
    b.addEventListener('click', () => options.accept(action.choice))
    node.append(b)
  }

  const widget: monaco.editor.IOverlayWidget = {
    getId: () => 'gitmanager.conflictActions',
    getDomNode: () => node,
    getPosition: () => null
  }
  editor.addOverlayWidget(widget)

  /** Above the conflict's first marker, at the right edge; kept inside the conflict while it is scrolled through. */
  const position = (): void => {
    const region = options.region()
    const lineCount = editor.getModel()?.getLineCount() ?? 0
    if (!region || lineCount === 0) {
      node.style.display = 'none'
      return
    }
    node.style.display = ''
    const scrollTop = editor.getScrollTop()
    const height = node.offsetHeight || 24
    const viewHeight = editor.getLayoutInfo().height
    const first = Math.min(region.startLine + 1, lineCount)
    const last = Math.min(region.endLine + 1, lineCount)
    const top = editor.getTopForLineNumber(first) - scrollTop - height - 2
    const bottom = editor.getBottomForLineNumber(last) - scrollTop
    if (bottom < 0 || top > viewHeight) {
      node.style.display = 'none'
      return
    }
    node.style.top = `${Math.max(2, Math.min(top, bottom - height))}px`
    node.style.right = `${editor.getLayoutInfo().verticalScrollbarWidth + 12}px`
  }

  const disposables: monaco.IDisposable[] = [
    editor.onMouseMove((e) => {
      const line = e.target.position?.lineNumber
      if (line !== undefined) options.hover(line - 1)
    }),
    editor.onDidScrollChange(position),
    editor.onDidLayoutChange(position)
  ]
  position()

  return {
    update: position,
    dispose: () => {
      for (const d of disposables) d.dispose()
      try {
        editor.removeOverlayWidget(widget)
      } catch {
        // The editor may already be gone.
      }
    }
  }
}
