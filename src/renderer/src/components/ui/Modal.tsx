import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { nextFocusIndex } from '../../logic/focus-trap'
import { createModalStack } from '../../logic/modal-stack'
import { Button } from './Button'

/** Every open dialog registers here; Escape and the focus trap apply to the top one only. */
const modalStack = createModalStack()

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
}

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
  bodyClassName?: string
  /** When false, Escape and clicks on the backdrop leave the dialog open; it closes via its own buttons. */
  dismissible?: boolean
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
  hideTitle,
  className = '',
  style,
  bodyClassName = '',
  dismissible = true
}: ModalProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [id] = useState(() => Symbol(title))
  // Read while rendering, before React focuses an autoFocus field inside the dialog.
  const [returnFocusTo] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  )
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible
  const pressStartedOnBackdrop = useRef(false)

  useEffect(() => {
    modalStack.push(id)
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) {
      ;(focusableIn(dialog)[0] ?? dialog).focus()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      // An editor widget inside the dialog (e.g. Monaco's find box) may have used Escape already.
      if (e.key !== 'Escape' || e.defaultPrevented || !modalStack.isTop(id) || !dismissibleRef.current) return
      e.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      modalStack.remove(id)
      // Hand focus back to what opened the dialog, if it is still on the page.
      if (returnFocusTo?.isConnected) returnFocusTo.focus()
    }
  }, [id, returnFocusTo])

  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Editors that use Tab themselves (Monaco inserting a tab) prevent the default first.
    if (e.key !== 'Tab' || e.defaultPrevented || !modalStack.isTop(id)) return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = focusableIn(dialog)
    const target = nextFocusIndex(
      focusable.length,
      focusable.indexOf(document.activeElement as HTMLElement),
      e.shiftKey
    )
    if (target === null) return
    e.preventDefault()
    ;(target < 0 ? dialog : focusable[target]).focus()
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      // Close only for a click that starts and ends on the backdrop, not a drag out of a text field.
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (dismissible && pressStartedOnBackdrop.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={['modal', className].filter(Boolean).join(' ')}
        style={{
          ...(wide ? { width: 'min(720px, 94vw)', maxHeight: '90vh', overflow: 'auto' } : null),
          ...style
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        {!hideTitle && <h3>{title}</h3>}
        <div className={['modal-body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
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
