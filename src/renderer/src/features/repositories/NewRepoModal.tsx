import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { NewRepoTarget, Repository } from '@shared/ipc'
import { repoFolderNameProblem } from '@shared/repo-name'
import { Banner, Button, Field, Input, Modal } from '../../components/ui'
import { toErrorMessage } from '../../lib/errors'

interface Props {
  onClose: () => void
  /** Adds the new repository to the list and opens it. */
  onCreated: (repo: Repository) => Promise<void>
  /** Opens the Git identity dialog, for a repository whose first commit needed one. */
  onSetIdentity: () => void
}

/** Typing pauses this long before the location is checked again. */
const CHECK_DELAY_MS = 250

export function NewRepoModal({ onClose, onCreated, onSetIdentity }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [branch, setBranch] = useState('')
  const [readme, setReadme] = useState(true)
  const [checked, setChecked] = useState<{ key: string; target: NewRepoTarget } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the repository was created but its first commit failed; the dialog then stays open to say so.
  const [warning, setWarning] = useState<string | null>(null)
  // The suggested location and branch fill empty fields once; a field cleared later stays empty.
  const defaultsAppliedRef = useRef(false)

  const checkKey = `${parentDir}\0${name}`
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(
      () => {
        window.gitManager.repo.inspectNewRepo({ parentDir, name }).then(
          (target) => {
            if (cancelled) return
            setChecked({ key: checkKey, target })
            if (!defaultsAppliedRef.current) {
              defaultsAppliedRef.current = true
              setParentDir((current) => current || target.suggestedParent)
              setBranch((current) => current || target.defaultBranch)
            }
          },
          (err) => {
            if (!cancelled) setError(toErrorMessage(err))
          }
        )
      },
      defaultsAppliedRef.current ? CHECK_DELAY_MS : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [checkKey, name, parentDir])

  const created = warning !== null
  const target = checked?.key === checkKey ? checked.target : null
  const nameProblem = name ? repoFolderNameProblem(name) : null
  // A name not typed yet is not a problem to point out.
  const problem = name ? (nameProblem ?? target?.problem ?? null) : null
  const canCreate =
    !busy && !created && Boolean(name) && Boolean(branch.trim()) && !nameProblem && target !== null && !target.problem

  const pickDir = async (): Promise<void> => {
    const next = await window.gitManager.repo.pickDirectory()
    if (next) setParentDir(next)
  }

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.gitManager.repo.create({ parentDir, name, initialBranch: branch.trim(), readme })
      await onCreated(result.repo)
      if (result.warning) setWarning(result.warning)
      else onClose()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New repository"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="modal-actions">
          {created ? (
            <>
              <Button onClick={onClose}>Close</Button>
              <Button variant="primary" onClick={onSetIdentity}>
                Set Git identity…
              </Button>
            </>
          ) : (
            <>
              <Button disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!canCreate} onClick={() => void create()}>
                {busy ? 'Creating…' : 'Create repository'}
              </Button>
            </>
          )}
        </div>
      }
    >
      {error && <Banner>{error}</Banner>}
      {warning && <Banner tone="warning">{warning}</Banner>}
      <Field label="Name">
        <Input
          className="w-full"
          value={name}
          placeholder="my-project"
          autoFocus
          disabled={busy || created}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
        />
      </Field>
      <Field label="Location">
        <div className="row-inline">
          <Input
            className="w-full"
            value={parentDir}
            disabled={busy || created}
            onChange={(e) => setParentDir(e.target.value)}
          />
          <Button disabled={busy || created} onClick={() => void pickDir()}>
            Browse…
          </Button>
        </div>
      </Field>
      <Field label="Initial branch">
        <Input
          className="w-full"
          value={branch}
          disabled={busy || created}
          onChange={(e) => setBranch(e.target.value)}
        />
      </Field>
      <label className="confirm-dialog-check">
        <input
          type="checkbox"
          checked={readme}
          disabled={busy || created}
          onChange={(e) => setReadme(e.target.checked)}
        />
        <span>Add a README.md and make the first commit</span>
      </label>
      {problem ? (
        <p className="text-sm new-repo-problem" role="alert">
          {problem}
        </p>
      ) : target?.path ? (
        <p className="muted text-sm" style={{ margin: 0, wordBreak: 'break-all' }}>
          {created ? 'Created' : 'Creates'} <code>{target.path}</code>
        </p>
      ) : null}
      {!problem && !created && target?.insideRepo && (
        <Banner tone="warning">
          This location is inside the repository at {target.insideRepo}. The new repository will be nested in it,
          and that repository will list it as untracked files unless it ignores the folder.
        </Banner>
      )}
    </Modal>
  )
}
