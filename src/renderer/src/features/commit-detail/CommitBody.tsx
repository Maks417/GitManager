import { useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { Splitter } from '../../components/Splitter'
import { COMMIT_BODY_MIN, commitBodyMax, commitBodyMaxHeight } from '../../logic/commit-body-height'
import { useLayoutActions, useLayoutPaneFiles } from '../../state/LayoutProvider'

/**
 * The commit message below the subject, shown up to a height the splitter under it sets; a longer message
 * scrolls. The splitter appears once the message is taller than the smallest height.
 */
export function CommitBody({ body }: { body: string }): React.JSX.Element {
  const { commitBodyHeight, setCommitBodyHeight } = useLayoutPaneFiles()
  const { persistLayout } = useLayoutActions()
  const ref = useRef<HTMLPreElement>(null)
  const [content, setContent] = useState(0)
  const [room, setRoom] = useState(0)

  // The room is what the message shares with the file list and diff below, which take whatever it leaves.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const below = el.closest('.inspector-fill')?.querySelector('.inspector-body')
    const measure = (): void => {
      setContent(el.scrollHeight)
      if (below) setRoom(el.offsetHeight + below.clientHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (below) ro.observe(below)
    return () => ro.disconnect()
  }, [body])

  const maxHeight = commitBodyMaxHeight(commitBodyHeight, room)
  return (
    <>
      <pre ref={ref} className="commit-body-compact muted" style={{ maxHeight }}>
        {body}
      </pre>
      {content > COMMIT_BODY_MIN && (
        <Splitter
          axis="y"
          className="splitter-commit-body"
          value={Math.min(content, maxHeight)}
          min={COMMIT_BODY_MIN}
          max={commitBodyMax(room, content)}
          onChange={setCommitBodyHeight}
          onChangeEnd={(height) => persistLayout({ commitBodyHeight: height })}
          title="Resize commit message"
        />
      )}
    </>
  )
}
