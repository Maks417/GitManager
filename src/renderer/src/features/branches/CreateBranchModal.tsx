import { useState } from 'react'
import type React from 'react'
import { Banner, Button, Field, Input, Modal } from '../../components/ui'

interface Props {
  onClose: () => void
  onCreate: (name: string, checkout: boolean) => Promise<void>
}

export function CreateBranchModal({ onClose, onCreate }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [checkout, setCheckout] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Branch name is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate(trimmed, checkout)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New branch"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      }
    >
      {error && <Banner>{error}</Banner>}
      <Field label="Name">
        <Input
          className="w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="feature/my-change"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
      </Field>
      <label className="row-inline">
        <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
        Check out after create
      </label>
    </Modal>
  )
}
