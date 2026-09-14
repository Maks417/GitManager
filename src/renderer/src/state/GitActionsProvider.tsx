import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { RemoteOpKind, RemoteOpResult, Repository } from '@shared/ipc'
import { confirmForceDeleteBranch, GIT_MISSING_MESSAGE } from '../lib/copy'
import { toErrorMessage } from '../lib/errors'
import { runWithBusy } from '../lib/useAsyncAction'
import { useAppStatus, useAppStatusActions } from './AppStatusProvider'
import { useConfirm } from './ConfirmProvider'
import { useRequiredContext } from './context'
import { useDialogActions } from './DialogsProvider'
import { useSession, useSessionActions } from './RepoSessionProvider'
import { useSelectionActions } from './SelectionProvider'

/** The fetch, pull or push that is running, as shown in the toolbar. */
export interface RemoteOpState {
  opId: string
  kind: RemoteOpKind
  repoName: string
  /** Git's current step; null until the first progress update. */
  phase: string | null
  percent: number | null
  /** False while a pull updates the work tree. */
  cancellable: boolean
  cancelling: boolean
}

export interface GitActions {
  /** False, with the Git-missing banner shown, when the Git command-line tools are not installed. */
  requireGit: () => boolean
  addRepo: () => Promise<void>
  openClone: () => void
  selectRepo: (repo: Repository) => void
  requestRemoveRepo: (repo: Repository) => void
  /** Fetch, pull or push, then refresh; errors go to the banner, a cancel shows none. */
  runSync: (kind: RemoteOpKind) => Promise<void>
  runMergeOrRebase: (op: 'merge' | 'rebase', ref: string) => Promise<void>
  checkoutBranch: (name: string) => Promise<void>
  checkoutRemote: (remoteRef: string) => Promise<void>
  deleteBranch: (name: string) => Promise<void>
  /** Stop the running fetch, pull or push, if it can still be stopped. */
  cancelRemote: () => void
  // These throw, so the dialog or pane that started them can show the error in place.
  /** Fetch, pull or push with toolbar progress; resolves `cancelled` when stopped. */
  runRemote: (kind: RemoteOpKind) => Promise<RemoteOpResult>
  createBranch: (name: string, checkout: boolean) => Promise<void>
  rebaseContinue: () => Promise<void>
  rebaseSkip: () => Promise<void>
  rebaseAbort: () => Promise<void>
  mergeAbort: () => Promise<void>
}

const GitActionsContext = createContext<GitActions | null>(null)
/** Kept apart from the actions: it changes with every progress update. */
const RemoteOpContext = createContext<{ remoteOp: RemoteOpState | null } | null>(null)

/**
 * Repository and Git actions shared by the toolbar, sidebar, panes, dialogs and menu. Each acts on the
 * repository that is active when it starts and refreshes whichever repository is active when it ends.
 */
export function GitActionsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { busy } = useAppStatus()
  const { setBusy, setError } = useAppStatusActions()
  const { gitMissing } = useSession()
  const {
    setActiveRepo,
    getActiveRepo,
    setRepoPendingRemove,
    setRepoRemoveError,
    refreshRepos,
    afterGitMutation
  } = useSessionActions()
  const { setSelection, setViewMode } = useSelectionActions()
  const { openDialog, closeDialog } = useDialogActions()
  const confirm = useConfirm()
  // Guards read the latest value without re-creating every action whenever `busy` toggles.
  const busyRef = useRef(busy)
  busyRef.current = busy
  const [remoteOp, setRemoteOp] = useState<RemoteOpState | null>(null)
  const remoteOpRef = useRef(remoteOp)
  remoteOpRef.current = remoteOp

  useEffect(() => {
    if (!window.gitManager?.git?.onProgress) return
    return window.gitManager.git.onProgress((progress) => {
      setRemoteOp((current) =>
        current && current.opId === progress.opId
          ? { ...current, phase: progress.phase, percent: progress.percent, cancellable: progress.cancellable }
          : current
      )
    })
  }, [])

  const requireGit = useCallback((): boolean => {
    if (!gitMissing) return true
    setError((prev) => prev || GIT_MISSING_MESSAGE)
    return false
  }, [gitMissing, setError])

  const selectRepo = useCallback(
    (repo: Repository): void => {
      setActiveRepo(repo)
      setSelection(null)
      setViewMode('history')
    },
    [setActiveRepo, setSelection, setViewMode]
  )

  const addRepo = useCallback(async (): Promise<void> => {
    if (!requireGit()) return
    await runWithBusy(
      async () => {
        const repo = await window.gitManager.repo.openDialog()
        if (!repo) return
        await refreshRepos()
        selectRepo(repo)
      },
      { setError }
    )
  }, [requireGit, refreshRepos, selectRepo, setError])

  const openClone = useCallback((): void => {
    if (requireGit()) openDialog('clone')
  }, [requireGit, openDialog])

  const requestRemoveRepo = useCallback(
    (repo: Repository): void => {
      setRepoRemoveError(null)
      setRepoPendingRemove(repo)
    },
    [setRepoPendingRemove, setRepoRemoveError]
  )

  const runRemote = useCallback(
    async (kind: RemoteOpKind): Promise<RemoteOpResult> => {
      const repo = getActiveRepo()
      if (!repo) throw new Error('No repository is open.')
      const opId = crypto.randomUUID()
      setRemoteOp({ opId, kind, repoName: repo.name, phase: null, percent: null, cancellable: true, cancelling: false })
      try {
        return await window.gitManager.git[kind]({ repoPath: repo.path, opId })
      } finally {
        setRemoteOp((current) => (current?.opId === opId ? null : current))
      }
    },
    [getActiveRepo]
  )

  const cancelRemote = useCallback((): void => {
    const current = remoteOpRef.current
    if (!current || !current.cancellable || current.cancelling) return
    setRemoteOp({ ...current, cancelling: true })
    void window.gitManager.git.cancelOperation(current.opId)
  }, [])

  const runSync = useCallback(
    async (kind: RemoteOpKind): Promise<void> => {
      if (!getActiveRepo()) return
      await runWithBusy(
        async () => {
          try {
            await runRemote(kind)
          } finally {
            // Also after a failure or cancel: a fetch stopped part way may still have updated some refs.
            // Refreshes whichever repository is active by now, never switching back.
            await afterGitMutation({ history: 'tip' }).catch(() => undefined)
          }
        },
        { setBusy, setError }
      )
    },
    [getActiveRepo, runRemote, afterGitMutation, setBusy, setError]
  )

  const runMergeOrRebase = useCallback(
    async (op: 'merge' | 'rebase', ref: string): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      await runWithBusy(
        async () => {
          try {
            const result =
              op === 'merge'
                ? await window.gitManager.git.merge(repo.path, ref)
                : await window.gitManager.git.rebase(repo.path, ref)
            await afterGitMutation({ history: 'full' })
            if (result.conflicts.length > 0) openDialog('mergeEditor')
          } catch (err) {
            await afterGitMutation({ history: 'full' }).catch(() => undefined)
            throw err
          }
        },
        { setBusy, setError }
      )
    },
    [getActiveRepo, afterGitMutation, openDialog, setBusy, setError]
  )

  const checkoutBranch = useCallback(
    async (name: string): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo || busyRef.current) return
      await runWithBusy(
        async () => {
          await window.gitManager.git.checkout(repo.path, name)
          await afterGitMutation({ history: 'full' })
        },
        { setBusy, setError }
      )
    },
    [getActiveRepo, afterGitMutation, setBusy, setError]
  )

  const checkoutRemote = useCallback(
    async (remoteRef: string): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo || busyRef.current) return
      await runWithBusy(
        async () => {
          await window.gitManager.git.checkoutRemoteBranch(repo.path, remoteRef)
          await afterGitMutation({ history: 'full' })
        },
        { setBusy, setError }
      )
    },
    [getActiveRepo, afterGitMutation, setBusy, setError]
  )

  const deleteBranch = useCallback(
    async (name: string): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      await runWithBusy(
        async () => {
          try {
            await window.gitManager.git.deleteBranch(repo.path, name, false)
          } catch (err) {
            // Git refuses to delete a branch whose commits are not merged; offer to force it.
            if (!(await confirm(confirmForceDeleteBranch(name, toErrorMessage(err))))) throw err
            await window.gitManager.git.deleteBranch(repo.path, name, true)
          }
          await afterGitMutation({ history: 'full' })
        },
        { setBusy, setError }
      )
    },
    [getActiveRepo, afterGitMutation, confirm, setBusy, setError]
  )

  const createBranch = useCallback(
    async (name: string, checkout: boolean): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      await window.gitManager.git.createBranch(repo.path, name, checkout)
      await afterGitMutation({ history: 'full' })
    },
    [getActiveRepo, afterGitMutation]
  )

  const rebaseStep = useCallback(
    async (step: 'rebaseContinue' | 'rebaseSkip'): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      const result = await window.gitManager.git[step](repo.path)
      await afterGitMutation({ history: 'full' })
      // The next commit may stop on conflicts again; once past them the merge editor is not needed.
      if (result.conflicts.length > 0) openDialog('mergeEditor')
      else closeDialog('mergeEditor')
    },
    [getActiveRepo, afterGitMutation, openDialog, closeDialog]
  )

  const abortOperation = useCallback(
    async (op: 'rebaseAbort' | 'mergeAbort'): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      await window.gitManager.git[op](repo.path)
      await afterGitMutation({ history: 'full' })
    },
    [getActiveRepo, afterGitMutation]
  )

  const actions = useMemo<GitActions>(
    () => ({
      requireGit,
      addRepo,
      openClone,
      selectRepo,
      requestRemoveRepo,
      runSync,
      runMergeOrRebase,
      checkoutBranch,
      checkoutRemote,
      deleteBranch,
      cancelRemote,
      runRemote,
      createBranch,
      rebaseContinue: () => rebaseStep('rebaseContinue'),
      rebaseSkip: () => rebaseStep('rebaseSkip'),
      rebaseAbort: () => abortOperation('rebaseAbort'),
      mergeAbort: () => abortOperation('mergeAbort')
    }),
    [
      requireGit,
      addRepo,
      openClone,
      selectRepo,
      requestRemoveRepo,
      runSync,
      runMergeOrRebase,
      checkoutBranch,
      checkoutRemote,
      deleteBranch,
      cancelRemote,
      runRemote,
      createBranch,
      rebaseStep,
      abortOperation
    ]
  )

  const remoteOpValue = useMemo(() => ({ remoteOp }), [remoteOp])

  return (
    <GitActionsContext.Provider value={actions}>
      <RemoteOpContext.Provider value={remoteOpValue}>{children}</RemoteOpContext.Provider>
    </GitActionsContext.Provider>
  )
}

export const useGitActions = (): GitActions => useRequiredContext(GitActionsContext, 'useGitActions')

/** The running fetch, pull or push, or null. */
export const useRemoteOp = (): RemoteOpState | null => useRequiredContext(RemoteOpContext, 'useRemoteOp').remoteOp
