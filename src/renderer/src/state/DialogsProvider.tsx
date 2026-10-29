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
  | 'remotes'
  | 'compare'
  | 'recovery'
  | 'createBranch'
  | 'mergePick'
  | 'rebasePick'
  | 'mergeEditor'

export interface BranchDialogTarget {
  kind: 'tracking' | 'publish'
  repoPath: string
  branchName: string
}

/** What a new worktree starts from: picked in the dialog, or a branch or commit it was opened for. */
export type WorktreeSource =
  | { kind: 'new' }
  | { kind: 'branch'; name: string }
  | { kind: 'remote'; name: string }
  | { kind: 'commit'; sha: string; label: string }

export interface WorktreeDialogTarget {
  repoPath: string
  source: WorktreeSource
}

export type DialogState = Record<DialogName, boolean> & {
  branchDialog: BranchDialogTarget | null
  worktreeDialog: WorktreeDialogTarget | null
}

export interface DialogActions {
  openDialog: (name: DialogName) => void
  closeDialog: (name: DialogName) => void
  openBranchDialog: (target: BranchDialogTarget) => void
  closeBranchDialog: () => void
  openWorktreeDialog: (target: WorktreeDialogTarget) => void
  closeWorktreeDialog: () => void
}

const ALL_CLOSED: DialogState = {
  accounts: false,
  createRepo: false,
  clone: false,
  updates: false,
  about: false,
  identity: false,
  remotes: false,
  compare: false,
  recovery: false,
  createBranch: false,
  mergePick: false,
  rebasePick: false,
  mergeEditor: false,
  branchDialog: null,
  worktreeDialog: null
}

const DialogStateContext = createContext<DialogState | null>(null)
const DialogActionsContext = createContext<DialogActions | null>(null)

export function DialogsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState<DialogState>(ALL_CLOSED)

  const actions = useMemo<DialogActions>(
    () => ({
      openDialog: (name) => setOpen((prev) => (prev[name] ? prev : { ...prev, [name]: true })),
      closeDialog: (name) => setOpen((prev) => (prev[name] ? { ...prev, [name]: false } : prev)),
      openBranchDialog: (target) => setOpen((prev) => ({ ...prev, branchDialog: target })),
      closeBranchDialog: () => setOpen((prev) => prev.branchDialog ? { ...prev, branchDialog: null } : prev),
      openWorktreeDialog: (target) => setOpen((prev) => ({ ...prev, worktreeDialog: target })),
      closeWorktreeDialog: () => setOpen((prev) => (prev.worktreeDialog ? { ...prev, worktreeDialog: null } : prev))
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
