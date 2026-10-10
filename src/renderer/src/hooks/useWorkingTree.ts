import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Commit,
  CommitDetail,
  DiffResult,
  FileChange,
  Repository,
  StatusEntry
} from '@shared/ipc'
import { isSha } from '@shared/sha'
import { toErrorMessage } from '../lib/errors'
import { workingTreeDiffDelayMs } from '../logic/working-tree-diff-refresh'
import { defaultSideFor, type DiffSide, type Selection, type ViewMode } from './selection'
import { useLatestRef } from './useLatestRef'

/**
 * Commit detail loads this long after the selection stops changing, so holding an arrow key in the
 * commit list does not run Git for every commit it passes.
 */
const DETAIL_DELAY_MS = 120

/** Status-driven reloads of the same focused file coalesce into one working-tree diff request. */
const WORKING_TREE_DIFF_REFRESH_MS = 150

/** Selection / detail / diff state (call before session + history). */
export function useWorkingTreeState(): {
  selection: Selection | null
  setSelection: React.Dispatch<React.SetStateAction<Selection | null>>
  viewMode: ViewMode
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>
  detail: CommitDetail | null
  setDetail: React.Dispatch<React.SetStateAction<CommitDetail | null>>
  selectedFile: FileChange | null
  setSelectedFile: React.Dispatch<React.SetStateAction<FileChange | null>>
  focusedStatusPath: string | null
  setFocusedStatusPath: React.Dispatch<React.SetStateAction<string | null>>
  diffSide: DiffSide
  setDiffSide: React.Dispatch<React.SetStateAction<DiffSide>>
  diff: DiffResult | null
  setDiff: React.Dispatch<React.SetStateAction<DiffResult | null>>
  diffLoading: boolean
  setDiffLoading: React.Dispatch<React.SetStateAction<boolean>>
  selectedSha: string | null
  workingCopySelected: boolean
} {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('history')
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null)
  const [focusedStatusPath, setFocusedStatusPath] = useState<string | null>(null)
  const [diffSide, setDiffSide] = useState<DiffSide>('unstaged')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  return {
    selection,
    setSelection,
    viewMode,
    setViewMode,
    detail,
    setDetail,
    selectedFile,
    setSelectedFile,
    focusedStatusPath,
    setFocusedStatusPath,
    diffSide,
    setDiffSide,
    diff,
    setDiff,
    diffLoading,
    setDiffLoading,
    selectedSha: selection?.kind === 'commit' ? selection.sha : null,
    workingCopySelected: selection?.kind === 'working-copy'
  }
}

type UseWorkingTreeArgs = Omit<ReturnType<typeof useWorkingTreeState>, 'diff' | 'diffLoading'> & {
  activeRepo: Repository | null
  status: StatusEntry[]
  /** Grows with every status refresh, also one that found the same status. */
  statusRevision: number
  commits: Commit[]
  headSha: string | null
  setError: (msg: string | null) => void
}

/**
 * Status-driven selection helpers + detail/diff loaders.
 * Call after session + history so commits/status are available.
 */
export function useWorkingTree({
  activeRepo,
  status,
  statusRevision,
  commits,
  headSha,
  setError,
  selection,
  setSelection,
  setViewMode,
  detail,
  setDetail,
  selectedFile,
  setSelectedFile,
  focusedStatusPath,
  setFocusedStatusPath,
  diffSide,
  setDiffSide,
  setDiff,
  setDiffLoading,
  selectedSha,
  workingCopySelected
}: UseWorkingTreeArgs): {
  selectWorkingCopy: () => void
  selectCommit: (sha: string) => void
  goHistory: () => void
} {
  // Loaders depend on these values, not on object identity: a refreshed repository or file entry
  // with the same path must not reload.
  const repoPath = activeRepo?.path
  const selectionKind = selection?.kind ?? null
  const selectedPath = selectedFile?.path
  const selectedOldPath = selectedFile?.oldPath
  // Until the selected commit's detail arrives, `selectedFile` still belongs to the previous commit.
  const detailSha = detail?.commit.sha ?? null

  const selectedInHistory = useMemo(
    () => Boolean(selectedSha && commits.some((c) => c.sha === selectedSha)),
    [commits, selectedSha]
  )

  useEffect(() => {
    if (!workingCopySelected) return
    const focused = focusedStatusPath ? status.find((s) => s.path === focusedStatusPath) : undefined
    if (focused) {
      // Staging or unstaging the last hunk on the side shown leaves only the other side with changes.
      const hasSide = diffSide === 'staged' ? focused.staged : focused.unstaged || focused.untracked
      if (!hasSide) setDiffSide(defaultSideFor(focused))
      return
    }
    const first = status[0]
    setFocusedStatusPath(first?.path ?? null)
    if (first) setDiffSide(defaultSideFor(first))
  }, [status, workingCopySelected, focusedStatusPath, diffSide, setFocusedStatusPath, setDiffSide])

  useEffect(() => {
    if (!repoPath || selectionKind !== 'commit' || !selectedSha || !isSha(selectedSha)) {
      // The working copy keeps the last commit's detail, so going back to History shows it without Git.
      if (selectionKind === null) {
        setDetail(null)
        setSelectedFile(null)
      }
      return
    }
    // A commit's files never change: the detail already shown for this commit needs no reload. Without
    // this, a refresh that briefly empties the list (a checkout with "Current branch") reloaded it.
    if (detailSha === selectedSha) return
    if (!selectedInHistory) {
      setDetail(null)
      setSelectedFile(null)
      return
    }
    const sha = selectedSha
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const d = await window.gitManager.history.commitDetail(repoPath, sha)
          if (cancelled) return
          setDetail(d)
          setSelectedFile(d.files[0] || null)
        } catch (err) {
          if (cancelled) return
          const message = toErrorMessage(err)
          setDetail(null)
          setSelectedFile(null)
          // Drop dead selection so we do not retry the same missing SHA forever.
          setSelection((prev) => (prev?.kind === 'commit' && prev.sha === sha ? null : prev))
          if (/bad object|invalid commit|unknown revision|commit not found/i.test(message)) {
            return
          }
          setError(message)
        }
      })()
    }, DETAIL_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    repoPath,
    selectionKind,
    selectedSha,
    selectedInHistory,
    detailSha,
    setError,
    setDetail,
    setSelectedFile,
    setSelection
  ])

  useEffect(() => {
    if (
      !repoPath ||
      selectionKind !== 'commit' ||
      !selectedSha ||
      !selectedPath ||
      detailSha !== selectedSha
    ) {
      if (selectionKind === 'commit') {
        setDiff(null)
        setDiffLoading(false)
      }
      return
    }
    let cancelled = false
    setDiffLoading(true)
    setDiff(null)
    void (async () => {
      try {
        const d = await window.gitManager.history.fileDiff({
          repoPath,
          sha: selectedSha,
          path: selectedPath,
          oldPath: selectedOldPath,
          parentIndex: 0
        })
        if (!cancelled) setDiff(d)
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err))
      } finally {
        if (!cancelled) setDiffLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    repoPath,
    selectionKind,
    selectedSha,
    selectedPath,
    selectedOldPath,
    detailSha,
    setError,
    setDiff,
    setDiffLoading
  ])

  /** Work-tree diff currently shown; a status refresh reloads it without flashing "Loading diff…". */
  const shownDiffKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!repoPath || selectionKind !== 'working-copy' || !focusedStatusPath) {
      if (selectionKind === 'working-copy') {
        shownDiffKeyRef.current = null
        setDiff(null)
        setDiffLoading(false)
      }
      return
    }
    const key = `${repoPath}\0${focusedStatusPath}\0${diffSide}`
    const delayMs = workingTreeDiffDelayMs(shownDiffKeyRef.current, key, WORKING_TREE_DIFF_REFRESH_MS)
    let cancelled = false
    // New file/side: clear immediately. Same key: keep the last diff while the debounced reload runs.
    if (delayMs === 0) {
      setDiffLoading(true)
      setDiff(null)
    }
    const load = async (): Promise<void> => {
      try {
        const d = await window.gitManager.history.workingTreeDiff({
          repoPath,
          path: focusedStatusPath,
          side: diffSide
        })
        if (cancelled) return
        shownDiffKeyRef.current = key
        setDiff(d)
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err))
      } finally {
        if (!cancelled) setDiffLoading(false)
      }
    }
    // `statusRevision` is a dependency on purpose: every status refresh reloads the focused file's diff
    // (debounced above when the key is unchanged), also when the status itself did not change: editing a
    // file that is already modified changes only its diff.
    const timer = setTimeout(() => {
      void load()
    }, delayMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    repoPath,
    selectionKind,
    focusedStatusPath,
    diffSide,
    statusRevision,
    setError,
    setDiff,
    setDiffLoading
  ])

  const selectWorkingCopy = useCallback((): void => {
    setViewMode('changes')
    setSelection({ kind: 'working-copy' })
    // The commit detail and file stay: going back to History shows them again without reloading.
    setDiff(null)
    const first = status[0]
    setFocusedStatusPath(first?.path ?? null)
    if (first) setDiffSide(defaultSideFor(first))
  }, [status, setViewMode, setSelection, setDiff, setFocusedStatusPath, setDiffSide])

  // Read by selectCommit without re-creating it whenever the selection changes.
  const selectionRef = useLatestRef(selection)

  const selectCommit = useCallback(
    (sha: string): void => {
      setViewMode('history')
      const current = selectionRef.current
      // Selecting the selected commit again keeps its diff: nothing would load it again.
      if (current?.kind === 'commit' && current.sha === sha) return
      setSelection({ kind: 'commit', sha })
      setFocusedStatusPath(null)
      setDiff(null)
    },
    [selectionRef, setViewMode, setSelection, setFocusedStatusPath, setDiff]
  )

  const goHistory = useCallback((): void => {
    setViewMode('history')
    // Back from the working copy, the commit shown before stays selected while the list still has it.
    const current = selectionRef.current
    const remembered = current?.kind === 'commit' ? current.sha : detail?.commit.sha
    const target = remembered && commits.some((c) => c.sha === remembered) ? remembered : commits[0]?.sha
    if (target) selectCommit(target)
    else if (headSha && isSha(headSha)) selectCommit(headSha)
    else {
      setSelection(null)
      setDetail(null)
      setSelectedFile(null)
      setDiff(null)
    }
  }, [
    commits,
    detail,
    headSha,
    selectionRef,
    selectCommit,
    setViewMode,
    setSelection,
    setDetail,
    setSelectedFile,
    setDiff
  ])

  return { selectWorkingCopy, selectCommit, goHistory }
}
