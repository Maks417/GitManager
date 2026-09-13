import { useEffect, useState } from 'react'
import type React from 'react'
import type { GitIdentity } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal } from '../../components/ui'

interface Props {
  repoPath: string
  onClose: () => void
  onSaved: (identity: GitIdentity) => void
}

export function IdentityModal({ repoPath, onClose, onSaved }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [scope, setScope] = useState<'local' | 'global'>('local')
  const [current, setCurrent] = useState<GitIdentity | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const id = await window.gitManager.git.getIdentity(repoPath)
        if (cancelled) return
        setCurrent(id)
        setName(id.name)
        setEmail(id.email)
        if (id.nameSource === 'local' || id.emailSource === 'local') setScope('local')
        else if (id.name || id.email) setScope('global')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repoPath])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.gitManager.git.setIdentity({
        repoPath,
        name: name.trim(),
        email: email.trim(),
        scope
      })
      onSaved(next)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Git identity"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || loading || !name.trim() || !email.trim()}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Name and email used to sign commits. Local applies only to this repository; global applies to all repos on this
        machine.
      </p>
      {error && <Banner>{error}</Banner>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="stack">
          {current && (current.name || current.email) && (
            <p className="muted text-sm" style={{ margin: 0 }}>
              Current effective: {current.name || '(no name)'} &lt;{current.email || 'no email'}&gt;
              {current.nameSource !== 'unset' || current.emailSource !== 'unset'
                ? ` · name ${current.nameSource}, email ${current.emailSource}`
                : ''}
            </p>
          )}
          <Field label="Name">
            <Input
              className="w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
            />
          </Field>
          <Field label="Email">
            <Input
              className="w-full"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <fieldset className="scope-fieldset">
            <legend className="muted text-sm">Save to</legend>
            <label className="row-inline">
              <input
                type="radio"
                name="identity-scope"
                checked={scope === 'local'}
                onChange={() => setScope('local')}
              />
              This repository only
            </label>
            <label className="row-inline">
              <input
                type="radio"
                name="identity-scope"
                checked={scope === 'global'}
                onChange={() => setScope('global')}
              />
              All repositories (global Git config)
            </label>
          </fieldset>
        </div>
      )}
    </Modal>
  )
}
