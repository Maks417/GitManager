import { useMemo, useState } from 'react'
import type React from 'react'
import type { BranchInfo } from '@shared/ipc'
import { Banner, Button, Field, Modal, Select } from '../../components/ui'

interface Props {
  title: string
  confirmVerb: string
  description: string
  branches: BranchInfo[]
  excludeCurrent?: boolean
  onClose: () => void
  onPick: (branchName: string) => Promise<void>
}

export function BranchPickModal({
  title,
  confirmVerb,
  description,
  branches,
  excludeCurrent = true,
  onClose,
  onPick
}: Props): React.JSX.Element {
  const options = useMemo(
    () => (excludeCurrent ? branches.filter((b) => !b.current) : branches),
    [branches, excludeCurrent]
  )
  const [selected, setSelected] = useState(options[0]?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!selected) {
      setError('Select a branch')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onPick(selected)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !selected || options.length === 0}
            onClick={() => void submit()}
          >
            {busy ? 'Working…' : confirmVerb}
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {description}
      </p>
      {error && <Banner>{error}</Banner>}
      {options.length === 0 ? (
        <p className="muted">No other branches available.</p>
      ) : (
        <Field label="Branch">
          <Select className="w-full" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {options.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  )
}
