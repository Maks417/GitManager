import { useEffect, useState } from 'react'
import type React from 'react'
import type { BranchInfo, RemoteBranchInfo, RemoteConfig, Repository } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal, Select } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { useConfirm } from '../../state/ConfirmProvider'
import { useGitActions, useRemoteOp } from '../../state/GitActionsProvider'
import { useSessionActions } from '../../state/RepoSessionProvider'
import { useAppStatus } from '../../state/AppStatusProvider'
import { toErrorMessage } from '../../lib/errors'

interface Props {
  repo: Repository
  branches: BranchInfo[]
  remoteBranches: RemoteBranchInfo[]
  onClose: () => void
}

export function RemotesModal({ repo, branches, remoteBranches, onClose }: Props): React.JSX.Element {
  const [remotes, setRemotes] = useState<RemoteConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('origin')
  const [url, setUrl] = useState('')
  const [pushUrl, setPushUrl] = useState('')
  const current = branches.find((branch) => branch.current)
  const [branch, setBranch] = useState(current?.name ?? branches[0]?.name ?? '')
  const [upstreamDraft, setUpstreamDraft] = useState<{ branch: string; current: string; value: string } | null>(null)
  const [destination, setDestination] = useState('')
  const [targetBranch, setTargetBranch] = useState(current?.name ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  const { busy, error, setError, run } = useAsyncAction()
  const { busy: appBusy } = useAppStatus()
  const remoteOp = useRemoteOp()
  const blocked = busy || appBusy || Boolean(remoteOp)
  const { runRemote, cancelRemote } = useGitActions()
  const { afterGitMutation } = useSessionActions()
  const confirm = useConfirm()
  const publishRemote = remotes.some((remote) => remote.name === destination) ? destination : remotes[0]?.name ?? ''
  const selectedBranch = branches.find((item) => item.name === branch) ?? current ?? branches[0]
  const tracked = selectedBranch?.upstream ?? ''
  const upstream = upstreamDraft?.branch === selectedBranch?.name && upstreamDraft?.current === tracked
    ? upstreamDraft.value
    : tracked

  useEffect(() => {
    let cancelled = false
    window.gitManager.git.remotes(repo.path).then(
      (list) => { if (!cancelled) { setRemotes(list); setLoading(false) } },
      (err) => { if (!cancelled) { setError(toErrorMessage(err)); setLoading(false) } }
    )
    return () => { cancelled = true }
  }, [repo.path, setError])

  const reload = async (): Promise<void> => {
    setRemotes(await window.gitManager.git.remotes(repo.path))
    await afterGitMutation({ history: 'tip' })
  }
  const change = (fn: () => Promise<void>, message: string): void => {
    setNotice(null)
    void run(async () => {
      try { await fn() } finally { await reload() }
      setNotice(message)
    })
  }
  const newRemote = (): void => { setEditing(false); setName(''); setUrl(''); setPushUrl('') }

  return (
    <Modal title={`Remotes · ${repo.name}`} wide onClose={onClose} dismissible={!busy}
      footer={<div className="modal-actions"><Button disabled={busy} onClick={onClose}>Close</Button></div>}
    >
      {error && <Banner>{error}</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}
      {remoteOp && <div className="row-inline" role="status" aria-live="polite">
        <span>{remoteOp.cancelling ? 'Cancelling…' : `${remoteOp.kind === 'fetch' ? 'Fetching' : remoteOp.kind === 'push' ? 'Pushing' : 'Pulling'}${remoteOp.phase ? ` · ${remoteOp.phase}` : '…'}${remoteOp.percent !== null ? ` ${remoteOp.percent}%` : ''}`}</span>
        <Button disabled={!remoteOp.cancellable || remoteOp.cancelling} onClick={cancelRemote}>Cancel {remoteOp.kind}</Button>
      </div>}
      <ul className="repo-list remote-config-list" aria-label="Configured remotes">
        {remotes.map((remote) => (
          <li key={remote.name}>
            <div className="remote-config-description"><strong>{remote.name}</strong>
              <div className="muted remote-url">{remote.fetchUrl}</div>
              {remote.pushUrl !== remote.fetchUrl && <div className="muted remote-url">Push: {remote.pushUrl}</div>}
            </div>
            <div className="row-inline">
              <Button disabled={blocked} onClick={() => { setEditing(true); setName(remote.name); setUrl(remote.fetchUrl); setPushUrl(remote.pushUrl === remote.fetchUrl ? '' : remote.pushUrl) }}>Edit</Button>
              <Button disabled={blocked} onClick={() => {
                void confirm({ title: 'Remove remote', message: `Remove ${remote.name} and its local remote-tracking branches? The repository on the server is kept.`, confirmLabel: 'Remove', danger: true }).then((ok) => {
                  if (ok) change(async () => { await window.gitManager.git.removeRemote(repo.path, remote.name); if (editing && name === remote.name) newRemote() }, `Removed ${remote.name}.`)
                })
              }}>Remove</Button>
            </div>
          </li>
        ))}
        {loading && <li className="muted">Loading remotes…</li>}
        {!loading && remotes.length === 0 && <li className="muted">Add a remote to publish this repository.</li>}
      </ul>
      <div className="panel-title">{editing ? `Edit ${name}` : 'Add remote'}</div>
      <div className="remote-fields">
        <Field label="Name"><Input value={name} disabled={blocked || editing} onChange={(e) => setName(e.target.value)} placeholder="origin" /></Field>
        <Field label="Fetch URL"><Input value={url} disabled={blocked} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repository.git" /></Field>
        <Field label="Push URL (optional)"><Input value={pushUrl} disabled={blocked} onChange={(e) => setPushUrl(e.target.value)} placeholder="Use the fetch URL" /></Field>
      </div>
      <div className="row-inline">
        <Button variant="primary" disabled={blocked || loading || !name.trim() || !url.trim()} onClick={() => change(
          async () => {
            await window.gitManager.git.saveRemote({ repoPath: repo.path, name: name.trim(), url: url.trim(), pushUrl: pushUrl.trim(), create: !editing })
            setName(name.trim())
            setEditing(true)
          },
          `Saved ${name.trim()}. Fetch to load its branches.`
        )}>{editing ? 'Save remote' : 'Add remote'}</Button>
        {editing && <Button disabled={blocked} onClick={newRemote}>New remote</Button>}
      </div>
      <div className="row-inline"><Button disabled={blocked || !remotes.length} onClick={() => void run(async () => { try { await runRemote('fetch') } finally { await reload() } })}>Fetch remotes</Button></div>
      <div className="panel-title">Branch tracking</div>
      <p className="muted text-sm">Fetch after adding a remote to load its branches. Current tracking: {tracked || 'none'}.</p>
      <div className="remote-fields">
        <Field label="Local branch"><Select value={selectedBranch?.name ?? ''} disabled={blocked} onChange={(e) => { setBranch(e.target.value); setUpstreamDraft(null) }}>
          {!branches.length && <option value="">No branches yet</option>}
          {branches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </Select></Field>
        <Field label="Upstream"><Select value={upstream} disabled={blocked} onChange={(e) => setUpstreamDraft({ branch: selectedBranch?.name ?? '', current: tracked, value: e.target.value })}>
          <option value="">No upstream</option>
          {upstream && !remoteBranches.some((item) => item.name === upstream) && <option value={upstream}>{upstream} (not fetched)</option>}
          {remoteBranches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
        </Select></Field>
      </div>
      <Button disabled={blocked || !selectedBranch} onClick={() => change(() => window.gitManager.git.setUpstream({ repoPath: repo.path, branch: selectedBranch?.name ?? '', upstream: upstream || null }), 'Updated branch tracking.')}>Save tracking</Button>
      <div className="panel-title">Publish current branch</div>
      <p className="muted text-sm">Push {current?.name ?? 'the current branch'} to an existing remote repository and set its upstream.</p>
      <div className="remote-fields">
        <Field label="Remote"><Select value={publishRemote} disabled={blocked} onChange={(e) => setDestination(e.target.value)}>
          {!remotes.length && <option value="">Add a remote first</option>}
          {remotes.map((remote) => <option key={remote.name} value={remote.name}>{remote.name}</option>)}
        </Select></Field>
        <Field label="Destination branch"><Input value={targetBranch} disabled={blocked} onChange={(e) => setTargetBranch(e.target.value)} placeholder="main" /></Field>
      </div>
      <Button variant="primary" disabled={blocked || !current || !publishRemote || !targetBranch.trim()} onClick={() => {
        void confirm({ title: 'Publish branch', message: `Push ${current?.name} to ${publishRemote}/${targetBranch.trim()} and track that branch?`, confirmLabel: 'Publish' }).then((ok) => {
          if (!ok) return
          setNotice(null)
          void run(async () => {
            let result
            try { result = await runRemote('push', { remote: publishRemote, targetBranch: targetBranch.trim() }) } finally { await reload() }
            if (result.outcome === 'done') setNotice(`Published to ${publishRemote}/${targetBranch.trim()}.`)
          })
        })
      }}>Publish branch</Button>
    </Modal>
  )
}
