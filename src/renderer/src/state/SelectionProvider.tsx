import { createContext, useMemo } from 'react'
import type React from 'react'
import { useWorkingTreeState } from '../hooks/useWorkingTree'
import { useRequiredContext } from './context'

type SelectionBundle = ReturnType<typeof useWorkingTreeState>

export type SelectionState = Pick<
  SelectionBundle,
  | 'selection'
  | 'viewMode'
  | 'detail'
  | 'selectedFile'
  | 'focusedStatusPath'
  | 'diffSide'
  | 'diff'
  | 'diffLoading'
  | 'selectedSha'
  | 'workingCopySelected'
>

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

const SelectionContext = createContext<SelectionState | null>(null)
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

  const state = useMemo<SelectionState>(
    () => ({
      selection,
      viewMode,
      detail,
      selectedFile,
      focusedStatusPath,
      diffSide,
      diff,
      diffLoading,
      selectedSha,
      workingCopySelected
    }),
    [
      selection,
      viewMode,
      detail,
      selectedFile,
      focusedStatusPath,
      diffSide,
      diff,
      diffLoading,
      selectedSha,
      workingCopySelected
    ]
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
      <SelectionContext.Provider value={state}>{children}</SelectionContext.Provider>
    </SelectionActionsContext.Provider>
  )
}

export const useSelection = (): SelectionState => useRequiredContext(SelectionContext, 'useSelection')

export const useSelectionActions = (): SelectionActions =>
  useRequiredContext(SelectionActionsContext, 'useSelectionActions')
