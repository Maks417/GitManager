import { useState } from 'react'
import type React from 'react'
import { Banner } from './Banner'
import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  /** Overrides confirmLabel while the optional checkbox is checked. */
  confirmLabelChecked?: string
  cancelLabel?: string
  /** Optional extra choice shown under the message. */
  checkboxLabel?: string
  /** Use danger styling for destructive confirms. */
  danger?: boolean
  /** A second action next to the confirming one. */
  alternative?: { label: string; danger?: boolean }
  onAlternative?: () => void
  busy?: boolean
  error?: string | null
  onConfirm: (options: { checked: boolean }) => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  confirmLabelChecked,
  cancelLabel = 'Cancel',
  checkboxLabel,
  danger = false,
  alternative,
  onAlternative,
  busy = false,
  error = null,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  const [checked, setChecked] = useState(false)
  const actionLabel = checked && confirmLabelChecked ? confirmLabelChecked : confirmLabel

  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onCancel}
      className="confirm-dialog"
      footer={
        <div className="modal-actions">
          <Button disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          {alternative && (
            <Button variant={alternative.danger ? 'danger' : 'default'} disabled={busy} onClick={onAlternative}>
              {alternative.label}
            </Button>
          )}
          <Button
            variant={danger || checked ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => onConfirm({ checked })}
          >
            {busy ? 'Working' : actionLabel}
          </Button>
        </div>
      }
    >
      <p className="confirm-dialog-message">{message}</p>
      {checkboxLabel && (
        <label className="confirm-dialog-check">
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>{checkboxLabel}</span>
        </label>
      )}
      {error && <Banner className="danger">{error}</Banner>}
    </Modal>
  )
}
