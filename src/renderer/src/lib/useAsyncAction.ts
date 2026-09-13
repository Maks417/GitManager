import { useCallback, useState } from 'react'
import { toErrorMessage } from './errors'

type RunOptions = {
  /** When false, leave existing error uncleared until success/failure (default true). */
  clearError?: boolean
}

/**
 * Shared busy + error wrapper for modal / pane actions.
 * Prefer this over hand-rolled setBusy/try/catch/finally blocks.
 */
export function useAsyncAction(): {
  busy: boolean
  error: string | null
  setError: (msg: string | null) => void
  run: <T>(fn: () => Promise<T>, opts?: RunOptions) => Promise<T | undefined>
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async <T,>(fn: () => Promise<T>, opts?: RunOptions): Promise<T | undefined> => {
    setBusy(true)
    if (opts?.clearError !== false) setError(null)
    try {
      return await fn()
    } catch (err) {
      setError(toErrorMessage(err))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, setError, run }
}

/**
 * Run an async action with external busy/error sinks (e.g. App-level banner).
 */
export async function runWithBusy<T>(
  fn: () => Promise<T>,
  opts: {
    setBusy?: (busy: boolean) => void
    setError: (msg: string | null) => void
  }
): Promise<T | undefined> {
  opts.setBusy?.(true)
  opts.setError(null)
  try {
    return await fn()
  } catch (err) {
    opts.setError(toErrorMessage(err))
    return undefined
  } finally {
    opts.setBusy?.(false)
  }
}
