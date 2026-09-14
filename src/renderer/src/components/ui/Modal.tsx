import { useEffect } from 'react'
import type React from 'react'
import { Button } from './Button'

interface ModalProps {
  title: string
  children: React.ReactNode
  onClose: () => void
  footer?: React.ReactNode
  wide?: boolean
  /** Hide the default title heading (e.g. when the body renders its own). */
  hideTitle?: boolean
  className?: string
  style?: React.CSSProperties
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
  hideTitle,
  className = '',
  style
}: ModalProps): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={['modal', className].filter(Boolean).join(' ')}
        style={{
          ...(wide ? { width: 'min(720px, 94vw)', maxHeight: '90vh', overflow: 'auto' } : null),
          ...style
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {!hideTitle && <h3>{title}</h3>}
        <div className="modal-body">{children}</div>
        {footer !== undefined ? (
          footer
        ) : (
          <div className="modal-actions">
            <Button onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </div>
  )
}
