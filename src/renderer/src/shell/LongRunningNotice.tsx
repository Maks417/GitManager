import { useEffect, useState } from 'react'
import type React from 'react'
import { Banner, Button } from '../components/ui'
import { toErrorMessage } from '../lib/errors'

/** An action still running after this long is likely waiting on something: offer to stop it. */
const LONG_RUNNING_MS = 10_000

/**
 * Shown while a local Git action has been running for a while: a commit waiting on a signing prompt or a slow
 * hook, a checkout in an LFS download. Stopping ends the Git commands that have run for some seconds (quick
 * refreshes go on) and the action then fails as cancelled. Fetch, pull and push have their own Cancel.
 */
export function LongRunningNotice({ busy, repoPath }: { busy: boolean; repoPath: string }): React.JSX.Element | null {
  // One entry per busy stretch: a new action starts with no notice and no note from the last Stop.
  const [run, setRun] = useState({ busy, long: false, note: null as string | null, stopping: false })
  if (run.busy !== busy) setRun({ busy, long: false, note: null, stopping: false })

  useEffect(() => {
    if (!busy) return
    const timer = setTimeout(() => setRun((current) => (current.busy ? { ...current, long: true } : current)), LONG_RUNNING_MS)
    return () => clearTimeout(timer)
  }, [busy])

  if (!busy || !run.long) return null

  const stop = async (): Promise<void> => {
    setRun((current) => ({ ...current, stopping: true }))
    let note: string | null = null
    try {
      const result = await window.gitManager.git.stopLong(repoPath)
      if (!result.stopped) note = 'Git is not running anything long in this repository; the app is still waiting on it.'
    } catch (err) {
      note = toErrorMessage(err)
    }
    setRun((current) => ({ ...current, stopping: false, note }))
  }

  return (
    <Banner tone="info" className="watch-notice">
      <span className="watch-notice-text">
        {run.note ??
          'Git is still working. It may be waiting for a signing prompt, a hook or a large download.'}
      </span>
      <Button disabled={run.stopping} onClick={() => void stop()}>
        {run.stopping ? 'Stopping' : 'Stop'}
      </Button>
    </Banner>
  )
}
