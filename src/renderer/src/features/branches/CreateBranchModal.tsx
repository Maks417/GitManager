import { useState } from 'react'
import type React from 'react'
import { Banner, Button, Field, Input, Modal } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'

interface Props {
  onClose: () => void
  onCreate: (name: string, checkout: boolean) => Promise<void>
  /** Shown under the title, e.g. the commit the branch starts at. */
  lead?: React.ReactNode
}

export function CreateBranchModal({ onClose, onCreate, lead }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [checkout, setCheckout] = useState(true)
  const { busy, error, setError, run } = useAsyncAction()

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Branch name is required')
      return
    }
    void run(async () => {
      await onCreate(trimmed, checkout)
      onClose()
    })
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
          <Button variant="primary" disabled={busy || !name.trim()} onClick={submit}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      }
    >
      {lead && <p className="muted modal-lead">{lead}</p>}
      {error && <Banner>{error}</Banner>}
      <Field label="Name">
        <Input
          className="w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="feature/my-change"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
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
