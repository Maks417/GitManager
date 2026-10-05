import { useMemo, useState } from 'react'
import type React from 'react'
import type { BranchInfo } from '@shared/ipc'
import { Banner, Button, Field, Modal, Select } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'

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
  const { busy, error, setError, run } = useAsyncAction()

  const submit = (): void => {
    if (!selected) {
      setError('Select a branch')
      return
    }
    void run(async () => {
      await onPick(selected)
      onClose()
    })
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
            onClick={submit}
          >
            {busy ? 'Working' : confirmVerb}
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
