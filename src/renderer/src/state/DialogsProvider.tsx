import { createContext, useMemo, useState } from 'react'
import type React from 'react'
import { useRequiredContext } from './context'

/** Modals opened from the toolbar, sidebar, panes and menu. Repository removal is session state. */
export type DialogName =
  | 'accounts'
  | 'createRepo'
  | 'clone'
  | 'updates'
  | 'about'
  | 'identity'
  | 'createBranch'
  | 'mergePick'
  | 'rebasePick'
  | 'mergeEditor'

export type DialogState = Record<DialogName, boolean>

export interface DialogActions {
  openDialog: (name: DialogName) => void
  closeDialog: (name: DialogName) => void
}

const ALL_CLOSED: DialogState = {
  accounts: false,
  createRepo: false,
  clone: false,
  updates: false,
  about: false,
  identity: false,
  createBranch: false,
  mergePick: false,
  rebasePick: false,
  mergeEditor: false
}

const DialogStateContext = createContext<DialogState | null>(null)
const DialogActionsContext = createContext<DialogActions | null>(null)

export function DialogsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState<DialogState>(ALL_CLOSED)

  const actions = useMemo<DialogActions>(
    () => ({
      openDialog: (name) => setOpen((prev) => (prev[name] ? prev : { ...prev, [name]: true })),
      closeDialog: (name) => setOpen((prev) => (prev[name] ? { ...prev, [name]: false } : prev))
    }),
    []
  )

  return (
    <DialogActionsContext.Provider value={actions}>
      <DialogStateContext.Provider value={open}>{children}</DialogStateContext.Provider>
    </DialogActionsContext.Provider>
  )
}

export const useDialogState = (): DialogState => useRequiredContext(DialogStateContext, 'useDialogState')

export const useDialogActions = (): DialogActions =>
  useRequiredContext(DialogActionsContext, 'useDialogActions')
