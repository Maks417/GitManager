import { createContext, useMemo } from 'react'
import type React from 'react'
import { useWorkingTreeState } from '../hooks/useWorkingTree'
import { useRequiredContext } from './context'

type SelectionBundle = ReturnType<typeof useWorkingTreeState>

export type SelectionCore = Pick<
  SelectionBundle,
  'selection' | 'viewMode' | 'selectedSha' | 'workingCopySelected'
>

export type SelectionDetail = Pick<SelectionBundle, 'detail' | 'selectedFile'>

export type SelectionFocus = Pick<SelectionBundle, 'focusedStatusPath' | 'diffSide'>

export type SelectionDiffContent = Pick<SelectionBundle, 'diff' | 'diffLoading'>

export type SelectionDiff = SelectionFocus & SelectionDiffContent

export type SelectionActions = Pick<
  SelectionBundle,
  | 'setSelection'
  | 'setViewMode'
  | 'setDetail'
  | 'setSelectedFile'
  | 'setFocusedStatusPath'
  | 'setDiffSide'
  | 'setDiff'
  | 'setDiffLoading'
>

/** Aggregate of every selection slice — prefer a narrower hook when possible. */
export type SelectionState = SelectionCore & SelectionDetail & SelectionDiff

const SelectionCoreContext = createContext<SelectionCore | null>(null)
const SelectionDetailContext = createContext<SelectionDetail | null>(null)
const SelectionFocusContext = createContext<SelectionFocus | null>(null)
const SelectionDiffContentContext = createContext<SelectionDiffContent | null>(null)
const SelectionActionsContext = createContext<SelectionActions | null>(null)

/** The selected commit or working copy, the view mode, and the detail and diff loaded for them. */
export function SelectionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const {
    selection,
    viewMode,
    detail,
    selectedFile,
    focusedStatusPath,
    diffSide,
    diff,
    diffLoading,
    selectedSha,
    workingCopySelected,
    setSelection,
    setViewMode,
    setDetail,
    setSelectedFile,
    setFocusedStatusPath,
    setDiffSide,
    setDiff,
    setDiffLoading
  } = useWorkingTreeState()

  const core = useMemo<SelectionCore>(
    () => ({ selection, viewMode, selectedSha, workingCopySelected }),
    [selection, viewMode, selectedSha, workingCopySelected]
  )

  const detailState = useMemo<SelectionDetail>(
    () => ({ detail, selectedFile }),
    [detail, selectedFile]
  )

  const focus = useMemo<SelectionFocus>(
    () => ({ focusedStatusPath, diffSide }),
    [focusedStatusPath, diffSide]
  )

  const diffContent = useMemo<SelectionDiffContent>(
    () => ({ diff, diffLoading }),
    [diff, diffLoading]
  )

  const actions = useMemo<SelectionActions>(
    () => ({
      setSelection,
      setViewMode,
      setDetail,
      setSelectedFile,
      setFocusedStatusPath,
      setDiffSide,
      setDiff,
      setDiffLoading
    }),
    [
      setSelection,
      setViewMode,
      setDetail,
      setSelectedFile,
      setFocusedStatusPath,
      setDiffSide,
      setDiff,
      setDiffLoading
    ]
  )

  return (
    <SelectionActionsContext.Provider value={actions}>
      <SelectionCoreContext.Provider value={core}>
        <SelectionDetailContext.Provider value={detailState}>
          <SelectionFocusContext.Provider value={focus}>
            <SelectionDiffContentContext.Provider value={diffContent}>
              {children}
            </SelectionDiffContentContext.Provider>
          </SelectionFocusContext.Provider>
        </SelectionDetailContext.Provider>
      </SelectionCoreContext.Provider>
    </SelectionActionsContext.Provider>
  )
}

export const useSelectionCore = (): SelectionCore =>
  useRequiredContext(SelectionCoreContext, 'useSelectionCore')

export const useSelectionDetail = (): SelectionDetail =>
  useRequiredContext(SelectionDetailContext, 'useSelectionDetail')

export const useSelectionFocus = (): SelectionFocus =>
  useRequiredContext(SelectionFocusContext, 'useSelectionFocus')

export const useSelectionDiffContent = (): SelectionDiffContent =>
  useRequiredContext(SelectionDiffContentContext, 'useSelectionDiffContent')

export const useSelectionActions = (): SelectionActions =>
  useRequiredContext(SelectionActionsContext, 'useSelectionActions')

/** Focused path/side plus the loaded diff. Prefer this only in detail panes. */
export function useSelectionDiff(): SelectionDiff {
  const focus = useSelectionFocus()
  const content = useSelectionDiffContent()
  return useMemo(() => ({ ...focus, ...content }), [focus, content])
}

/** Every selection slice. Prefer a narrower selection hook when possible. */
export function useSelection(): SelectionState {
  const core = useSelectionCore()
  const detail = useSelectionDetail()
  const diff = useSelectionDiff()
  return useMemo(() => ({ ...core, ...detail, ...diff }), [core, detail, diff])
}
