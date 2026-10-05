import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { RemoteOpKind, RemoteOpRequest, RemoteOpResult, Repository, ResetMode, SequencerStep } from '@shared/ipc'
import { useLatestRef } from '../hooks/useLatestRef'
import { choosePullOrForcePush, chooseMergeOrRebase, confirmForceDeleteBranch, GIT_MISSING_MESSAGE } from '../lib/copy'
import { toErrorMessage } from '../lib/errors'
import { sameRepoPath } from '../lib/paths'
import { runWithBusy } from '../lib/useAsyncAction'
import { useAppStatus, useAppStatusActions } from './AppStatusProvider'
import { useChoose, useConfirm } from './ConfirmProvider'
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

type RemoteOpOptions = Pick<RemoteOpRequest, 'force' | 'remote' | 'targetBranch' | 'setUpstream' | 'expectedBranch'>

export interface GitActions {
  /** False, with the Git-missing banner shown, when the Git command-line tools are not installed. */
  requireGit: () => boolean
  addRepo: () => Promise<void>
  openClone: () => void
  openNewRepo: () => void
  selectRepo: (repo: Repository) => void
  requestRemoveRepo: (repo: Repository) => void
  /**
   * Fetch, pull or push, then refresh; errors go to the banner, a cancel shows none. A rejected push offers
   * a pull or a force push, and a diverged pull a merge or a rebase.
   */
  runSync: (kind: RemoteOpKind) => Promise<void>
  /** Review a first publication; otherwise push immediately. Throws so callers can show local errors. */
  pushCurrentBranch: () => Promise<RemoteOpResult | undefined>
  /** Offer the way forward after a rejected push or a diverged pull; does nothing for other outcomes. */
  resolveRemoteOutcome: (result: RemoteOpResult) => Promise<void>
  /** Merge, rebase, cherry-pick or revert, then refresh; conflicts open the merge editor. */
  runMergeOrRebase: (op: ConflictingOp, ref: string) => Promise<void>
  checkoutBranch: (name: string) => Promise<void>
  checkoutRemote: (remoteRef: string) => Promise<void>
  deleteBranch: (name: string) => Promise<void>
  /** Stop the running fetch, pull or push, if it can still be stopped. */
  cancelRemote: () => void
  // These throw, so the dialog or pane that started them can show the error in place.
  /** Fetch, pull or push with toolbar progress; resolves `cancelled` when stopped. */
  runRemote: (kind: RemoteOpKind, options?: RemoteOpOptions) => Promise<RemoteOpResult>
  /** At HEAD, or at `startPoint` (a commit picked in History). */
  createBranch: (name: string, checkout: boolean, startPoint?: string) => Promise<void>
  createTag: (name: string, sha: string, message?: string) => Promise<void>
  resetTo: (sha: string, mode: ResetMode) => Promise<void>
  /** Delete a tag here; errors go to the banner. */
  deleteTag: (name: string) => Promise<void>
  /** Push a tag, or delete it on the remote, with toolbar progress; errors go to the banner. */
  pushTag: (name: string, remove: boolean) => Promise<void>
  /** Continue, skip or abort the cherry-pick or revert in progress. */
  sequencerStep: (step: SequencerStep) => Promise<void>
  rebaseContinue: () => Promise<void>
  rebaseSkip: () => Promise<void>
  rebaseAbort: () => Promise<void>
  mergeAbort: () => Promise<void>
}

/** Operations that can stop on conflicts. */
export type ConflictingOp = 'merge' | 'rebase' | 'cherryPick' | 'revert'

const GitActionsContext = createContext<GitActions | null>(null)
/** Kept apart from the actions: it changes with every progress update. */
const RemoteOpContext = createContext<{ remoteOp: RemoteOpState | null } | null>(null)

/**
 * One fetch, pull or push at a time: the menu and the commit pane can start one while another runs, and a
 * push that starts before a pull has moved the branch pushes the wrong commits.
 */
function remoteOpRunningMessage(op: RemoteOpState): string {
  return `A ${op.kind} of ${op.repoName} is still running. Wait for it to finish or cancel it, then try again.`
}

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
  const { openDialog, closeDialog, openBranchDialog } = useDialogActions()
  const confirm = useConfirm()
  const choose = useChoose()
  // Guards read the latest value without re-creating every action whenever `busy` toggles.
  const busyRef = useLatestRef(busy)
  const [remoteOp, setRemoteOp] = useState<RemoteOpState | null>(null)
  // Set the moment an operation starts, before any render, so a second one cannot start alongside it.
  const remoteOpRef = useRef<RemoteOpState | null>(null)

  const publishRemoteOp = useCallback((next: RemoteOpState | null): void => {
    remoteOpRef.current = next
    setRemoteOp(next)
  }, [])

  useEffect(() => {
    if (!window.gitManager?.git?.onProgress) return
    return window.gitManager.git.onProgress((progress) => {
      const current = remoteOpRef.current
      if (current?.opId !== progress.opId) return
      publishRemoteOp({ ...current, phase: progress.phase, percent: progress.percent, cancellable: progress.cancellable })
    })
  }, [publishRemoteOp])

  const requireGit = useCallback((): boolean => {
    if (!gitMissing) return true
    setError((prev) => prev || GIT_MISSING_MESSAGE)
    return false
  }, [gitMissing, setError])

  const selectRepo = useCallback(
    (repo: Repository): void => {
      setViewMode('history')
      // Choosing the open repository again keeps its selected commit.
      if (sameRepoPath(getActiveRepo()?.path, repo.path)) return
      setActiveRepo(repo)
      setSelection(null)
    },
    [getActiveRepo, setActiveRepo, setSelection, setViewMode]
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

  const openNewRepo = useCallback((): void => {
    if (requireGit()) openDialog('createRepo')
  }, [requireGit, openDialog])

  const requestRemoveRepo = useCallback(
    (repo: Repository): void => {
      setRepoRemoveError(null)
      setRepoPendingRemove(repo)
    },
    [setRepoPendingRemove, setRepoRemoveError]
  )

  const runRemote = useCallback(
    async (kind: RemoteOpKind, options: RemoteOpOptions = {}): Promise<RemoteOpResult> => {
      const repo = getActiveRepo()
      if (!repo) throw new Error('No repository is open.')
      const running = remoteOpRef.current
      if (running) throw new Error(remoteOpRunningMessage(running))
      const opId = crypto.randomUUID()
      publishRemoteOp({ opId, kind, repoName: repo.name, phase: null, percent: null, cancellable: true, cancelling: false })
      try {
        return await window.gitManager.git[kind]({ repoPath: repo.path, opId, ...options })
      } finally {
        if (remoteOpRef.current?.opId === opId) publishRemoteOp(null)
      }
    },
    [getActiveRepo, publishRemoteOp]
  )

  const cancelRemote = useCallback((): void => {
    const current = remoteOpRef.current
    if (!current || !current.cancellable || current.cancelling) return
    publishRemoteOp({ ...current, cancelling: true })
    void window.gitManager.git.cancelOperation(current.opId)
  }, [publishRemoteOp])

  const pushCurrentBranch = useCallback(async (): Promise<RemoteOpResult | undefined> => {
    const repo = getActiveRepo()
    if (!repo) throw new Error('No repository is open.')
    if (remoteOpRef.current) throw new Error(remoteOpRunningMessage(remoteOpRef.current))
    // Read from Git, including a commit just created by the commit-and-push form.
    const branch = (await window.gitManager.repo.branches(repo.path)).find((item) => item.current)
    if (!sameRepoPath(getActiveRepo()?.path, repo.path)) return undefined
    if (!branch) throw new Error('Check out a branch before pushing (HEAD is detached).')
    if (!branch.sha) throw new Error('Create a commit before publishing this branch.')
    if (!branch.upstream) {
      // Ensure the dialog can resolve a branch just created outside the app or by the commit form.
      await afterGitMutation({ history: 'tip' })
      if (!sameRepoPath(getActiveRepo()?.path, repo.path)) return undefined
      openBranchDialog({ kind: 'publish', repoPath: repo.path, branchName: branch.name })
      return undefined
    }
    return runRemote('push')
  }, [getActiveRepo, openBranchDialog, runRemote, afterGitMutation])

  /** One remote operation with the busy state and banner; resolves its result, or undefined after an error. */
  const syncOnce = useCallback(
    async (kind: RemoteOpKind, force = false): Promise<RemoteOpResult | undefined> => {
      if (!getActiveRepo()) return undefined
      const running = remoteOpRef.current
      if (running) {
        setError(remoteOpRunningMessage(running))
        return undefined
      }
      return runWithBusy(
        async () => {
          try {
            return kind === 'push' && !force ? await pushCurrentBranch() : await runRemote(kind, { force })
          } finally {
            // Also after a failure or cancel: a fetch stopped part way may still have updated some refs.
            // Refreshes whichever repository is active by now, never switching back.
            await afterGitMutation({ history: 'tip' }).catch(() => undefined)
          }
        },
        { setBusy, setError }
      )
    },
    [getActiveRepo, runRemote, pushCurrentBranch, afterGitMutation, setBusy, setError]
  )

  const runMergeOrRebase = useCallback(
    async (op: ConflictingOp, ref: string): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      await runWithBusy(
        async () => {
          try {
            const result = await window.gitManager.git[op](repo.path, ref)
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

  /** After a diverged pull: merge the upstream in, or rebase onto it. */
  const offerMergeOrRebase = useCallback(
    async (result: RemoteOpResult): Promise<void> => {
      if (!result.upstream) return
      const upstream = result.upstream.replace(/^refs\/(remotes|heads)\//, '')
      const answer = await choose(chooseMergeOrRebase(result.branch ?? 'This branch', upstream))
      if (answer === 'cancel') return
      await runMergeOrRebase(answer === 'confirm' ? 'merge' : 'rebase', result.upstream)
    },
    [choose, runMergeOrRebase]
  )

  // Runs after the busy state of the operation that led here has ended, so the follow-up can take it again.
  const resolveRemoteOutcome = useCallback(
    async (result: RemoteOpResult): Promise<void> => {
      if (result.outcome === 'diverged') {
        await offerMergeOrRebase(result)
        return
      }
      if (result.outcome !== 'rejected') return
      const answer = await choose(choosePullOrForcePush(result.branch ?? 'This branch'))
      if (answer === 'cancel') return
      if (answer === 'alternative') {
        await syncOnce('push', true)
        return
      }
      // Pull, then push what was asked for; a pull that finds the branches diverged asks how to combine them.
      const pulled = await syncOnce('pull')
      if (pulled?.outcome === 'diverged') await offerMergeOrRebase(pulled)
      else if (pulled?.outcome === 'done') await syncOnce('push')
    },
    [choose, syncOnce, offerMergeOrRebase]
  )

  const runSync = useCallback(
    async (kind: RemoteOpKind): Promise<void> => {
      const result = await syncOnce(kind)
      if (result) await resolveRemoteOutcome(result)
    },
    [syncOnce, resolveRemoteOutcome]
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
    [getActiveRepo, busyRef, afterGitMutation, setBusy, setError]
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
    [getActiveRepo, busyRef, afterGitMutation, setBusy, setError]
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
    async (name: string, checkout: boolean, startPoint?: string): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      await window.gitManager.git.createBranch(repo.path, name, checkout, startPoint)
      await afterGitMutation({ history: 'full' })
    },
    [getActiveRepo, afterGitMutation]
  )

  const createTag = useCallback(
    async (name: string, sha: string, message?: string): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      await window.gitManager.git.createTag(repo.path, name, sha, message)
      await afterGitMutation({ history: 'full' })
    },
    [getActiveRepo, afterGitMutation]
  )

  const resetTo = useCallback(
    async (sha: string, mode: ResetMode): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      try {
        await window.gitManager.git.reset(repo.path, sha, mode)
      } finally {
        await afterGitMutation({ history: 'full' }).catch(() => undefined)
      }
    },
    [getActiveRepo, afterGitMutation]
  )

  const deleteTag = useCallback(
    async (name: string): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      await runWithBusy(
        async () => {
          await window.gitManager.git.deleteTag(repo.path, name)
          await afterGitMutation({ history: 'full' })
        },
        { setBusy, setError }
      )
    },
    [getActiveRepo, afterGitMutation, setBusy, setError]
  )

  const pushTag = useCallback(
    async (name: string, remove: boolean): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      const running = remoteOpRef.current
      if (running) {
        setError(remoteOpRunningMessage(running))
        return
      }
      await runWithBusy(
        async () => {
          const opId = crypto.randomUUID()
          publishRemoteOp({ opId, kind: 'push', repoName: repo.name, phase: null, percent: null, cancellable: true, cancelling: false })
          try {
            await window.gitManager.git.pushTag({ repoPath: repo.path, opId, tag: name, remove })
          } finally {
            if (remoteOpRef.current?.opId === opId) publishRemoteOp(null)
            await afterGitMutation({ history: 'none' }).catch(() => undefined)
          }
        },
        { setBusy, setError }
      )
    },
    [getActiveRepo, publishRemoteOp, afterGitMutation, setBusy, setError]
  )

  const sequencerStep = useCallback(
    async (step: SequencerStep): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      try {
        const result = await window.gitManager.git.sequencerStep(repo.path, step)
        // Continuing may stop on the next commit's conflicts; past them the merge editor is not needed.
        if (result.conflicts.length > 0) openDialog('mergeEditor')
        else closeDialog('mergeEditor')
      } finally {
        await afterGitMutation({ history: 'full' }).catch(() => undefined)
      }
    },
    [getActiveRepo, afterGitMutation, openDialog, closeDialog]
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
      openNewRepo,
      selectRepo,
      requestRemoveRepo,
      runSync,
      pushCurrentBranch,
      resolveRemoteOutcome,
      runMergeOrRebase,
      checkoutBranch,
      checkoutRemote,
      deleteBranch,
      cancelRemote,
      runRemote,
      createBranch,
      createTag,
      resetTo,
      deleteTag,
      pushTag,
      sequencerStep,
      rebaseContinue: () => rebaseStep('rebaseContinue'),
      rebaseSkip: () => rebaseStep('rebaseSkip'),
      rebaseAbort: () => abortOperation('rebaseAbort'),
      mergeAbort: () => abortOperation('mergeAbort')
    }),
    [
      requireGit,
      addRepo,
      openClone,
      openNewRepo,
      selectRepo,
      requestRemoveRepo,
      runSync,
      pushCurrentBranch,
      resolveRemoteOutcome,
      runMergeOrRebase,
      checkoutBranch,
      checkoutRemote,
      deleteBranch,
      cancelRemote,
      runRemote,
      createBranch,
      createTag,
      resetTo,
      deleteTag,
      pushTag,
      sequencerStep,
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
