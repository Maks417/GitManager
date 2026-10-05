import { useState } from 'react'
import type React from 'react'
import type { RemoteConfig, Repository, SaveRemoteRequest } from '@shared/ipc'
import { Banner, Button, Modal } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { useConfirm } from '../../state/ConfirmProvider'
import { useRemoteOp } from '../../state/GitActionsProvider'
import { useSessionActions } from '../../state/RepoSessionProvider'
import { useAppStatus } from '../../state/AppStatusProvider'
import { RemoteForm } from './RemoteForm'
import { useRemoteConfigs } from './useRemoteConfigs'

interface Props {
  repo: Repository
  onClose: () => void
}

export function RemotesModal({ repo, onClose }: Props): React.JSX.Element {
  const { remotes, loading, error: loadError, reload } = useRemoteConfigs(repo.path)
  const [editor, setEditor] = useState<RemoteConfig | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { busy, error, setError, run } = useAsyncAction()
  const { busy: appBusy } = useAppStatus()
  const remoteOp = useRemoteOp()
  const blocked = busy || appBusy || Boolean(remoteOp)
  const { afterGitMutation } = useSessionActions()
  const confirm = useConfirm()

  const refresh = async (): Promise<void> => {
    await reload()
    await afterGitMutation({ history: 'tip' })
  }
  const save = (request: SaveRemoteRequest): void => {
    void run(async () => {
      await window.gitManager.git.saveRemote(request)
      setEditor(null)
      setNotice(`Saved ${request.name}. Fetch to load its remote branches.`)
      await refresh()
    })
  }

  return (
    <Modal title={`${editor ? editor === 'new' ? 'Add remote' : 'Edit remote' : 'Manage remotes'} · ${repo.name}`} className="remote-modal" bodyClassName="remote-flow" onClose={onClose} dismissible={!busy}
      footer={editor ? null : <div className="modal-actions"><Button disabled={busy} onClick={onClose}>Close</Button></div>}
    >
      {(error || loadError) && <Banner>{error || loadError}</Banner>}
      {editor ? (
        <RemoteForm repoPath={repo.path} remotes={remotes} remote={editor === 'new' ? undefined : editor} disabled={blocked} onSave={save} onCancel={() => { setError(null); setEditor(null) }} />
      ) : (
        <>
          {notice && <Banner tone="info">{notice}</Banner>}
          <ul className="repo-list remote-config-list" aria-label="Configured remotes">
            {remotes.map((remote) => (
              <li key={remote.name}>
                <div className="remote-config-description">
                  <strong>{remote.name}</strong>
                  <div className="muted remote-url">{remote.fetchUrl}</div>
                  {remote.pushUrl !== remote.fetchUrl && <div className="muted remote-url">Push: {remote.pushUrl}</div>}
                </div>
                <div className="row-inline">
                  <Button disabled={blocked} onClick={() => { setError(null); setNotice(null); setEditor(remote) }}>Edit</Button>
                  <Button disabled={blocked} onClick={() => {
                    void confirm({ title: 'Remove remote', message: `Remove ${remote.name} and its local remote-tracking branches? The repository on the server is kept.`, confirmLabel: 'Remove', danger: true }).then((ok) => {
                      if (ok) void run(async () => {
                        await window.gitManager.git.removeRemote(repo.path, remote.name)
                        setNotice(`Removed ${remote.name}.`)
                        await refresh()
                      })
                    })
                  }}>Remove</Button>
                </div>
              </li>
            ))}
            {loading && <li className="muted">Loading remotes…</li>}
            {!loading && remotes.length === 0 && !loadError && <li className="muted">No remotes configured.</li>}
          </ul>
          <div className="row-inline"><Button disabled={blocked || loading || Boolean(loadError)} onClick={() => { setError(null); setNotice(null); setEditor('new') }}>Add remote</Button></div>
        </>
      )}
    </Modal>
  )
}
