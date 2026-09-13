import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Commit,
  CommitDetail,
  DiffResult,
  FileChange,
  Repository,
  StatusEntry
} from '@shared/ipc'
import { isSha } from '@shared/sha'
import {
  defaultSideFor,
  type DiffSide
} from '../features/changes/WorkingTreeDetailPane'
import { toErrorMessage } from '../lib/errors'
import type { Selection, ViewMode } from './selection'

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
    if (
      !activeRepo ||
      selection?.kind !== 'commit' ||
      !selectedSha ||
      !isSha(selectedSha)
    ) {
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
    const repoPath = activeRepo.path
    const sha = selectedSha
    let cancelled = false
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
    return () => {
      cancelled = true
    }
  }, [
    activeRepo?.path,
    selection?.kind,
    selectedSha,
    selectedInHistory,
    setError,
    setDetail,
    setSelectedFile,
    setSelection
  ])

  useEffect(() => {
    if (!activeRepo || selection?.kind !== 'commit' || !selectedSha || !selectedFile) {
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
          repoPath: activeRepo.path,
          sha: selectedSha,
          path: selectedFile.path,
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
    activeRepo?.path,
    selection?.kind,
    selectedSha,
    selectedFile?.path,
    setError,
    setDiff,
    setDiffLoading
  ])

  useEffect(() => {
    if (!activeRepo || selection?.kind !== 'working-copy' || !focusedStatusPath) {
      if (selection?.kind === 'working-copy') {
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
        const d = await window.gitManager.history.workingTreeDiff({
          repoPath: activeRepo.path,
          path: focusedStatusPath,
          side: diffSide
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
    activeRepo?.path,
    selection?.kind,
    focusedStatusPath,
    diffSide,
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

  const selectCommit = useCallback(
    (sha: string): void => {
      setViewMode('history')
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
