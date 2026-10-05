import { useCallback, useEffect, useState } from 'react'
import type { RemoteConfig } from '@shared/ipc'
import { toErrorMessage } from '../../lib/errors'

export function useRemoteConfigs(repoPath: string): {
  remotes: RemoteConfig[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
} {
  const [remotes, setRemotes] = useState<RemoteConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.gitManager.git.remotes(repoPath).then(
      (list) => { if (!cancelled) { setRemotes(list); setLoading(false) } },
      (err) => { if (!cancelled) { setError(toErrorMessage(err)); setLoading(false) } }
    )
    return () => { cancelled = true }
  }, [repoPath])

  const reload = useCallback(async (): Promise<void> => {
    setRemotes(await window.gitManager.git.remotes(repoPath))
    setError(null)
  }, [repoPath])

  return { remotes, loading, error, reload }
}
