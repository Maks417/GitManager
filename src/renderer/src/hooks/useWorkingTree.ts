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
import { defaultSideFor, type DiffSide, type Selection, type ViewMode } from './selection'

/**
 * Commit detail loads this long after the selection stops changing, so holding an arrow key in the
 * commit list does not run Git for every commit it passes.
 */
const DETAIL_DELAY_MS = 120

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

type UseWorkingTreeArgs = ReturnType<typeof useWorkingTreeState> & {
  activeRepo: Repository | null
  status: StatusEntry[]
  commits: Commit[]
  headSha: string | null
  setError: (msg: string | null) => void
  setDiffLoading: React.Dispatch<React.SetStateAction<boolean>>
}

/**
 * Status-driven selection helpers + detail/diff loaders.
 * Call after session + history so commits/status are available.
 */
export function useWorkingTree({
  activeRepo,
  status,
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
  const selectedPath = selectedFile?.path
  const selectedOldPath = selectedFile?.oldPath
  // Until the selected commit's detail arrives, `selectedFile` still belongs to the previous commit.
  const detailSha = detail?.commit.sha ?? null
  // Read when a detail load finishes, to tell a reload of the shown commit from a newly selected one.
  const shownDetailShaRef = useRef(detailSha)
  shownDetailShaRef.current = detailSha

  const selectedInHistory = useMemo(
    () => Boolean(selectedSha && commits.some((c) => c.sha === selectedSha)),
    [commits, selectedSha]
  )

  useEffect(() => {
    if (!workingCopySelected) return
    if (focusedStatusPath && status.some((s) => s.path === focusedStatusPath)) return
    const first = status[0]
    setFocusedStatusPath(first?.path ?? null)
    if (first) setDiffSide(defaultSideFor(first))
  }, [status, workingCopySelected, focusedStatusPath, setFocusedStatusPath, setDiffSide])

  useEffect(() => {
    if (!repoPath || selection?.kind !== 'commit' || !selectedSha || !isSha(selectedSha)) {
      if (selection?.kind !== 'commit') {
        setDetail(null)
        setSelectedFile(null)
      }
      return
    }
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
          const reloadOfShownCommit = shownDetailShaRef.current === d.commit.sha
          setDetail(d)
          // A reload of the commit already shown keeps the file the user picked (and so its diff editor);
          // a newly selected commit starts at its first file.
          setSelectedFile((current) =>
            reloadOfShownCommit && current && d.files.some((f) => f.path === current.path)
              ? current
              : d.files[0] || null
          )
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
    selection?.kind,
    selectedSha,
    selectedInHistory,
    setError,
    setDetail,
    setSelectedFile,
    setSelection
  ])

  useEffect(() => {
    if (
      !repoPath ||
      selection?.kind !== 'commit' ||
      !selectedSha ||
      !selectedPath ||
      detailSha !== selectedSha
    ) {
      if (selection?.kind === 'commit') {
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
    selection?.kind,
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
    if (!repoPath || selection?.kind !== 'working-copy' || !focusedStatusPath) {
      if (selection?.kind === 'working-copy') {
        shownDiffKeyRef.current = null
        setDiff(null)
        setDiffLoading(false)
      }
      return
    }
    const key = `${repoPath}\0${focusedStatusPath}\0${diffSide}`
    let cancelled = false
    if (shownDiffKeyRef.current !== key) {
      setDiffLoading(true)
      setDiff(null)
    }
    void (async () => {
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
    })()
    return () => {
      cancelled = true
    }
    // `status` is a dependency on purpose: every status refresh reloads the focused file's diff.
  }, [
    repoPath,
    selection?.kind,
    focusedStatusPath,
    diffSide,
    status,
    setError,
    setDiff,
    setDiffLoading
  ])

  const selectWorkingCopy = useCallback((): void => {
    setViewMode('changes')
    setSelection({ kind: 'working-copy' })
    setDetail(null)
    setSelectedFile(null)
    setDiff(null)
    const first = status[0]
    setFocusedStatusPath(first?.path ?? null)
    if (first) setDiffSide(defaultSideFor(first))
  }, [
    status,
    setViewMode,
    setSelection,
    setDetail,
    setSelectedFile,
    setDiff,
    setFocusedStatusPath,
    setDiffSide
  ])

  // Read by selectCommit without re-creating it whenever the selection changes.
  const selectionRef = useRef(selection)
  selectionRef.current = selection

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
    [setViewMode, setSelection, setFocusedStatusPath, setDiff]
  )

  const goHistory = useCallback((): void => {
    setViewMode('history')
    if (commits[0]) selectCommit(commits[0].sha)
    else if (headSha && isSha(headSha)) selectCommit(headSha)
    else {
      setSelection(null)
      setDetail(null)
      setSelectedFile(null)
      setDiff(null)
    }
  }, [commits, headSha, selectCommit, setViewMode, setSelection, setDetail, setSelectedFile, setDiff])

  return { selectWorkingCopy, selectCommit, goHistory }
}
