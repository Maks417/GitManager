import { useState } from 'react'
import type React from 'react'
import type { BranchInfo, RemoteBranchInfo, Repository } from '@shared/ipc'
import { Banner, Button, Field, Modal, Select } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { useAppStatus } from '../../state/AppStatusProvider'
import { useDialogActions } from '../../state/DialogsProvider'
import { useGitActions, useRemoteOp } from '../../state/GitActionsProvider'
import { useSessionActions } from '../../state/RepoSessionProvider'
import { RemoteOperationStatus } from '../remotes/RemoteOperationStatus'

interface Props {
  repo: Repository
  branch: BranchInfo
  remoteBranches: RemoteBranchInfo[]
  onClose: () => void
}

export function BranchTrackingModal({ repo, branch, remoteBranches, onClose }: Props): React.JSX.Element {
  const tracked = branch.upstream ?? ''
  const [draft, setDraft] = useState<{ base: string; value: string } | null>(null)
  const upstream = draft?.base === tracked ? draft.value : tracked
  const { busy, error, run } = useAsyncAction()
  const { busy: appBusy } = useAppStatus()
  const op = useRemoteOp()
  const blocked = busy || appBusy || Boolean(op)
  const { runRemote } = useGitActions()
  const { afterGitMutation } = useSessionActions()
  const { openDialog } = useDialogActions()
  const valid = !upstream || remoteBranches.some((item) => item.name === upstream)

  return (
    <Modal title="Branch tracking" className="remote-modal" bodyClassName="remote-flow" onClose={onClose} dismissible={!busy}
      footer={<div className="modal-actions">
        <Button disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={blocked || !branch.sha || !valid || upstream === tracked} onClick={() => void run(async () => {
          await window.gitManager.git.setUpstream({ repoPath: repo.path, branch: branch.name, upstream: upstream || null })
          await afterGitMutation({ history: 'tip' })
          onClose()
        })}>Save</Button>
      </div>}
    >
      <div className="remote-source"><span className="muted">{repo.name}</span><strong>{branch.name}</strong></div>
      {error && <Banner>{error}</Banner>}
      <RemoteOperationStatus />
      <Field label="Upstream branch">
        <Select value={upstream} disabled={blocked || !branch.sha} onChange={(e) => setDraft({ base: tracked, value: e.target.value })}>
          <option value="">No upstream</option>
          {upstream && !remoteBranches.some((item) => item.name === upstream) && <option value={upstream}>{upstream} (not fetched)</option>}
          {remoteBranches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </Select>
      </Field>
      <p className="muted text-sm modal-lead">Used for Pull and ahead/behind status.</p>
      {!branch.sha && <p className="muted text-sm modal-lead">Create a commit before setting this branch’s upstream.</p>}
      {repo.remotes.length > 0 ? (
        <div className="row-inline"><Button disabled={blocked} onClick={() => void run(async () => {
          try { await runRemote('fetch') } finally { await afterGitMutation({ history: 'tip' }) }
        })}>Fetch remote branches</Button><span className="muted text-sm">Refresh available upstreams.</span></div>
      ) : (
        <div className="row-inline"><span className="muted text-sm">Add a remote to choose an upstream.</span><Button disabled={blocked} onClick={() => openDialog('remotes')}>Manage remotes</Button></div>
      )}
    </Modal>
  )
}
