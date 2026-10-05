import { useState } from 'react'
import type React from 'react'
import type { BranchInfo, Repository, SaveRemoteRequest } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal, Select } from '../../components/ui'
import { sameRepoPath } from '../../lib/paths'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { useAppStatus } from '../../state/AppStatusProvider'
import { useGitActions, useRemoteOp } from '../../state/GitActionsProvider'
import { useSessionActions } from '../../state/RepoSessionProvider'
import { RemoteForm } from './RemoteForm'
import { RemoteOperationStatus } from './RemoteOperationStatus'
import { useRemoteConfigs } from './useRemoteConfigs'

interface Props {
  repo: Repository
  branch: BranchInfo
  onClose: () => void
}

export function PublishBranchModal({ repo, branch, onClose }: Props): React.JSX.Element {
  const { remotes, loading, error: loadError, reload } = useRemoteConfigs(repo.path)
  const [destination, setDestination] = useState<string | null>(null)
  const [targetBranch, setTargetBranch] = useState(branch.upstream?.includes('/') ? branch.upstream.slice(branch.upstream.indexOf('/') + 1) : branch.name)
  const [setTracking, setSetTracking] = useState(false)
  const [addingRemote, setAddingRemote] = useState(false)
  const { busy, error, run } = useAsyncAction()
  const { busy: appBusy } = useAppStatus()
  const op = useRemoteOp()
  const blocked = busy || appBusy || Boolean(op)
  const { runRemote } = useGitActions()
  const { getActiveRepo, afterGitMutation } = useSessionActions()
  const publish = !branch.upstream
  const defaultRemote = remotes.find((remote) => branch.upstream?.startsWith(`${remote.name}/`))?.name
    ?? remotes.find((remote) => remote.name === 'origin')?.name
    ?? (remotes.length === 1 ? remotes[0].name : '')
  const remote = remotes.find((item) => item.name === (destination ?? defaultRemote))
  const showDestination = !loading && remotes.length > 0

  const saveRemote = (request: SaveRemoteRequest): void => {
    void run(async () => {
      await window.gitManager.git.saveRemote(request)
      setAddingRemote(false)
      setDestination(request.name)
      await reload()
      await afterGitMutation({ history: 'tip' })
    })
  }
  const push = (): void => {
    if (blocked || !remote || !targetBranch.trim() || !branch.sha) return
    void run(async () => {
      if (!sameRepoPath(getActiveRepo()?.path, repo.path)) throw new Error('The active repository changed. Review the destination again.')
      let result
      try {
        result = await runRemote('push', { remote: remote.name, targetBranch: targetBranch.trim(), setUpstream: publish || setTracking, expectedBranch: branch.name })
      } finally {
        await afterGitMutation({ history: 'tip' })
      }
      if (result.outcome === 'done') onClose()
    })
  }

  return (
    <Modal title={publish ? 'Publish branch' : 'Push to'} className="remote-modal" bodyClassName="remote-flow" onClose={onClose} dismissible={!busy} returnFocusFallback=".toolbar-menu > button"
      footer={addingRemote ? null : <div className="modal-actions">
        <Button disabled={busy} onClick={onClose}>Cancel</Button>
        {showDestination && <Button variant="primary" disabled={blocked || !remote || !targetBranch.trim() || !branch.sha} onClick={push}>{publish ? 'Publish' : 'Push'}</Button>}
      </div>}
    >
      <div className="remote-source"><span className="muted">{repo.name}</span><strong>{branch.name}</strong></div>
      {(error || loadError) && <Banner>{error || loadError}</Banner>}
      <RemoteOperationStatus />
      {loading ? <p className="muted modal-lead">Loading remotes…</p> : addingRemote ? (
        <RemoteForm repoPath={repo.path} remotes={remotes} disabled={blocked} onSave={saveRemote} onCancel={() => setAddingRemote(false)} />
      ) : remotes.length === 0 ? (
        <div className="stack">
          <p className="muted modal-lead">Add a remote pointing to an existing repository to publish this branch.</p>
          <div className="row-inline"><Button disabled={blocked || Boolean(loadError)} onClick={() => setAddingRemote(true)}>Add remote</Button></div>
        </div>
      ) : (
        <>
          <Field label="Remote">
            <Select value={remote?.name ?? ''} disabled={blocked} onChange={(e) => setDestination(e.target.value)}>
              <option value="" disabled>Choose a remote</option>
              {remotes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </Select>
          </Field>
          {remote && <div className="remote-destination"><span className="muted text-sm">Push URL</span><span className="muted remote-url">{remote.pushUrl}</span></div>}
          <Field label="Destination branch"><Input value={targetBranch} disabled={blocked} onChange={(e) => setTargetBranch(e.target.value)} placeholder={branch.name} /></Field>
          {publish ? (
            <p className="muted text-sm modal-lead">{remote && targetBranch.trim() ? `${remote.name}/${targetBranch.trim()}` : 'This destination'} will become the upstream for Pull and branch status.</p>
          ) : (
            <>
              <label className="row-inline"><input type="checkbox" checked={setTracking} disabled={blocked} onChange={(e) => setSetTracking(e.target.checked)} />Use this destination as upstream</label>
              <p className="muted text-sm modal-lead">{setTracking ? 'Future Pull and branch status will use this destination.' : `Current upstream stays ${branch.upstream}.`}</p>
            </>
          )}
          {!branch.sha && <p className="muted text-sm modal-lead">Create a commit before publishing this branch.</p>}
        </>
      )}
    </Modal>
  )
}
