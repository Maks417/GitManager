import { useState } from 'react'
import type React from 'react'
import type { AddWorktreeRequest, BranchInfo, RemoteBranchInfo, Repository } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal, SegmentedControl, Select } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { defaultWorktreeFolder } from '../../logic/worktree-paths'
import type { WorktreeSource } from '../../state/DialogsProvider'

type Mode = 'existing' | 'new' | 'commit'

interface Props {
  repo: Repository
  branches: readonly BranchInfo[]
  remoteBranches: readonly RemoteBranchInfo[]
  source: WorktreeSource
  onClose: () => void
  /** Adds the worktree and resolves its folder. */
  onCreate: (request: Omit<AddWorktreeRequest, 'repoPath'>) => Promise<string>
  onOpen: (path: string) => Promise<void>
}

/** The mode, branch and new branch the dialog starts with, from what it was opened for. */
function initialState(source: WorktreeSource, branches: readonly BranchInfo[]): { mode: Mode; branch: string; newName: string; startPoint: string } {
  const free = branches.find((b) => !b.current && !b.worktreePath)?.name ?? ''
  const head = branches.find((b) => b.current)?.name ?? 'HEAD'
  switch (source.kind) {
    case 'branch':
      return { mode: 'existing', branch: source.name, newName: '', startPoint: head }
    case 'remote': {
      const shortName = source.name.slice(source.name.indexOf('/') + 1)
      return branches.some((b) => b.name === shortName)
        ? { mode: 'existing', branch: shortName, newName: '', startPoint: head }
        : { mode: 'new', branch: free, newName: shortName, startPoint: source.name }
    }
    case 'commit':
      return { mode: 'commit', branch: free, newName: '', startPoint: source.sha }
    default:
      return { mode: 'new', branch: free, newName: '', startPoint: head }
  }
}

/**
 * A new linked worktree: an existing branch, a new branch (from a remote branch it then tracks), or a commit
 * opened from History. The folder defaults to a sibling of the main work tree named after the branch.
 */
export function CreateWorktreeModal({ repo, branches, remoteBranches, source, onClose, onCreate, onOpen }: Props): React.JSX.Element {
  const [initial] = useState(() => initialState(source, branches))
  const [mode, setMode] = useState<Mode>(initial.mode)
  const [branch, setBranch] = useState(initial.branch)
  const [newName, setNewName] = useState(initial.newName)
  const [startPoint, setStartPoint] = useState(initial.startPoint)
  const [parent, setParent] = useState<string | null>(null)
  const [typedFolder, setTypedFolder] = useState<string | null>(null)
  const [openAfter, setOpenAfter] = useState(true)
  const { busy, error, setError, run } = useAsyncAction()

  const mainPath = repo.worktreeOf ?? repo.path
  const commit = source.kind === 'commit' ? source : null
  const label = mode === 'existing' ? branch : mode === 'new' ? newName.trim() || 'new-branch' : (commit?.label ?? 'detached')
  const folder = typedFolder ?? defaultWorktreeFolder(mainPath, label, parent ?? undefined)
  const track = mode === 'new' && remoteBranches.some((b) => b.name === startPoint.trim())
  const ready = Boolean(folder.trim()) && (mode === 'existing' ? Boolean(branch) : mode === 'new' ? Boolean(newName.trim()) : Boolean(commit))

  const submit = (): void => {
    if (!ready) {
      setError(mode === 'new' ? 'Name the new branch.' : 'Pick a branch.')
      return
    }
    const path = folder.trim()
    const request: Omit<AddWorktreeRequest, 'repoPath'> =
      mode === 'existing'
        ? { path, branch }
        : mode === 'new'
          ? { path, newBranch: newName.trim(), startPoint: startPoint.trim() || undefined, track }
          : { path, startPoint: commit?.sha }
    void run(async () => {
      const created = await onCreate(request)
      onClose()
      if (openAfter) await onOpen(created)
    })
  }

  const modes: { value: Mode; label: string }[] = [
    { value: 'existing', label: 'Existing branch' },
    { value: 'new', label: 'New branch' },
    ...(commit ? [{ value: 'commit' as const, label: `Commit ${commit.label}` }] : [])
  ]

  return (
    <Modal
      title="New worktree"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !ready} onClick={submit}>
            {busy ? 'Creating' : 'Create'}
          </Button>
        </div>
      }
    >
      <p className="muted modal-lead worktree-lead">
        A worktree is another folder with its own checkout of this repository. Each branch can be checked out in one
        worktree at a time.
      </p>
      {error && <Banner>{error}</Banner>}
      <SegmentedControl ariaLabel="Check out" value={mode} options={modes} onChange={setMode} disabled={busy} />
      {mode === 'existing' && (
        <Field label="Branch">
          <Select className="w-full" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={busy}>
            {!branch && <option value="">Pick a branch</option>}
            {branches.map((b) => (
              <option key={b.name} value={b.name} disabled={b.current || Boolean(b.worktreePath)}>
                {b.name}
                {b.current ? ' (checked out here)' : b.worktreePath ? ' (in another worktree)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {mode === 'new' && (
        <>
          <Field label="New branch">
            <Input className="w-full" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="feature/my-change" autoFocus disabled={busy} />
          </Field>
          <Field label="Starting at">
            <Input className="w-full" value={startPoint} list="worktree-start-points" onChange={(e) => setStartPoint(e.target.value)} placeholder="HEAD" disabled={busy} />
          </Field>
          <datalist id="worktree-start-points">
            {['HEAD', ...branches.map((b) => b.name), ...remoteBranches.map((b) => b.name)].map((ref) => (
              <option key={ref} value={ref} />
            ))}
          </datalist>
          {track && <p className="muted text-sm worktree-note">The new branch tracks {startPoint.trim()}.</p>}
        </>
      )}
      {mode === 'commit' && commit && (
        <p className="muted text-sm worktree-note">The worktree checks out commit {commit.label} without a branch (detached HEAD).</p>
      )}
      <Field label="Folder">
        <div className="row-inline worktree-folder">
          <Input
            className="w-full"
            value={folder}
            onChange={(e) => setTypedFolder(e.target.value)}
            spellCheck={false}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <Button
            disabled={busy}
            title="Choose the folder the worktree's folder goes in"
            onClick={() =>
              void window.gitManager.repo.pickDirectory().then((picked) => {
                if (!picked) return
                setParent(picked)
                setTypedFolder(null)
              })
            }
          >
            Browse…
          </Button>
        </div>
      </Field>
      <label className="row-inline">
        <input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} disabled={busy} />
        Open the worktree after creating it
      </label>
    </Modal>
  )
}
