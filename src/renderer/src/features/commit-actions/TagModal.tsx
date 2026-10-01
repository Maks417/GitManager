import { useState } from 'react'
import type React from 'react'
import type { Commit } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal, Textarea } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'

interface Props {
  commit: Commit
  onClose: () => void
  /** A message makes an annotated tag; without one the tag is lightweight. */
  onCreate: (name: string, message: string) => Promise<void>
}

export function TagModal({ commit, onClose, onCreate }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const { busy, error, run } = useAsyncAction()
  const trimmed = name.trim()

  const submit = (): void => {
    if (!trimmed) return
    void run(async () => {
      await onCreate(trimmed, message)
      onClose()
    })
  }

  return (
    <Modal
      title="New tag"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !trimmed} onClick={submit}>
            {busy ? 'Creating…' : 'Create tag'}
          </Button>
        </div>
      }
    >
      <p className="muted modal-lead">
        At <span className="sha">{commit.shortSha}</span> {commit.subject}
      </p>
      {error && <Banner>{error}</Banner>}
      <Field label="Name">
        <Input
          className="w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="v1.2.0"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </Field>
      <Field label="Message (optional: makes an annotated tag)">
        <Textarea
          className="w-full"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Release notes or a short description"
        />
      </Field>
    </Modal>
  )
}
