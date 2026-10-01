import { useMemo } from 'react'
import type React from 'react'
import { looksLikeHtml, toNoteNodes, type NoteNode } from '../../logic/release-notes'

function render(nodes: NoteNode[]): React.ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === 'text') return node.text
    const children = render(node.children)
    switch (node.tag) {
      case 'br':
        return <br key={index} />
      case 'a': {
        const href = node.href ?? ''
        return (
          <a
            key={index}
            href={href}
            onClick={(e) => {
              // Links open in the browser, never inside the app window.
              e.preventDefault()
              void window.gitManager.shell.openExternal(href)
            }}
          >
            {children}
          </a>
        )
      }
      default: {
        const Tag = node.tag
        return <Tag key={index}>{children}</Tag>
      }
    }
  })
}

/** Release notes from GitHub (HTML, shown through an allow-list) or plain text. */
export function ReleaseNotes({ notes }: { notes: string }): React.JSX.Element {
  const content = useMemo(() => {
    if (!looksLikeHtml(notes)) return <p className="release-notes-text">{notes}</p>
    const doc = new DOMParser().parseFromString(notes, 'text/html')
    return render(toNoteNodes(doc.body))
  }, [notes])
  return <div className="release-notes">{content}</div>
}
