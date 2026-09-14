import type React from 'react'
import { Download, ExternalLink, FolderPlus, Link } from 'lucide-react'
import { GIT_DOWNLOAD_URL } from '../lib/git-install'
import { Banner, Button } from '../components/ui'
import { useAppStatus } from '../state/AppStatusProvider'
import { useDialogActions } from '../state/DialogsProvider'
import { useGitActions } from '../state/GitActionsProvider'
import { useSession } from '../state/RepoSessionProvider'

export function WelcomeScreen(): React.JSX.Element {
  const { error } = useAppStatus()
  const { gitMissing } = useSession()
  const { addRepo, openClone } = useGitActions()
  const { openDialog } = useDialogActions()

  const openGitDownload = (): void => {
    void window.gitManager.shell.openExternal(GIT_DOWNLOAD_URL)
  }

  return (
    <div className="welcome">
      {error && <Banner>{error}</Banner>}
      <div className="welcome-card">
        <h1 className="welcome-brand">Git Manager</h1>
        <p className="welcome-kicker">History-first Git for the desktop</p>
        {gitMissing ? (
          <p className="muted welcome-hint">
            Git Manager needs the Git command-line tools on this computer. Install Git, restart the
            app, then add or clone a repository.
          </p>
        ) : (
          <p className="muted welcome-hint">
            Use <strong>File → Add Local Repository</strong> or <strong>Clone Repository</strong>, or
            the buttons below. History graph is the main view once a repo is open.
          </p>
        )}
        <div className="welcome-actions">
          {gitMissing ? (
            <Button
              variant="primary"
              icon={<ExternalLink size={16} strokeWidth={1.75} />}
              hint="Open the official Git download page"
              title="Open the official Git download page"
              onClick={openGitDownload}
            >
              Install Git
            </Button>
          ) : null}
          <Button
            variant={gitMissing ? 'default' : 'primary'}
            icon={<FolderPlus size={16} strokeWidth={1.75} />}
            hint={gitMissing ? 'Install Git first' : 'Add a local Git repository'}
            title={gitMissing ? 'Install Git first' : 'Add a local Git repository'}
            disabled={gitMissing}
            onClick={() => void addRepo()}
          >
            Add local repository
          </Button>
          <Button
            icon={<Download size={16} strokeWidth={1.75} />}
            hint={gitMissing ? 'Install Git first' : 'Clone a repository from a URL'}
            title={gitMissing ? 'Install Git first' : 'Clone a repository from a URL'}
            disabled={gitMissing}
            onClick={openClone}
          >
            Clone repository
          </Button>
          <Button
            icon={<Link size={16} strokeWidth={1.75} />}
            hint="Connect GitHub, GitLab, or Bitbucket"
            title="Connect GitHub, GitLab, or Bitbucket"
            onClick={() => openDialog('accounts')}
          >
            Connect GitHub / GitLab / Bitbucket
          </Button>
        </div>
        <ul className="welcome-steps muted">
          <li>Add or clone a Git repo from disk or a remote host</li>
          <li>Browse the commit graph, search history, inspect diffs</li>
          <li>Stage, commit, fetch, pull, push, and resolve merges</li>
        </ul>
      </div>
    </div>
  )
}
