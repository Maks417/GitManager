import type React from 'react'
import { Banner, Button } from '../components/ui'
import { GIT_DOWNLOAD_URL } from '../lib/git-install'
import { useAppStatus } from '../state/AppStatusProvider'
import { useSession, useSessionActions } from '../state/RepoSessionProvider'

export function StartupScreen(): React.JSX.Element {
  const { startupStatus, gitMissing } = useSession()
  const { retryStartup } = useSessionActions()
  const { error } = useAppStatus()
  return (
    <div className="empty-state" data-testid="startup-screen">
      <div>
        {error && <Banner>{error}</Banner>}
        <p role="status">{startupStatus === 'failed'
          ? 'Could not open your saved repositories.'
          : gitMissing ? 'Install Git to open your saved repositories.' : 'Opening repositories…'}</p>
        {gitMissing && <Button onClick={() => void window.gitManager.shell.openExternal(GIT_DOWNLOAD_URL)}>Install Git</Button>}
        {(startupStatus === 'failed' || gitMissing) && <Button onClick={retryStartup}>Retry</Button>}
      </div>
    </div>
  )
}
