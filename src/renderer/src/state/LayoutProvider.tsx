import { createContext, useMemo } from 'react'
import type React from 'react'
import { useLayoutPrefs } from '../hooks/useLayoutPrefs'
import { useRequiredContext } from './context'

type LayoutBundle = ReturnType<typeof useLayoutPrefs>

export type LayoutPrefs = Pick<
  LayoutBundle,
  | 'prefs'
  | 'setPrefs'
  | 'sidebarCollapsed'
  | 'branchesExpanded'
  | 'remoteBranchesExpanded'
  | 'detailDock'
  | 'diffView'
  | 'syntaxHighlighting'
  | 'toggleDock'
  | 'toggleDiffView'
  | 'toggleSidebar'
  | 'toggleBranches'
  | 'toggleRemoteBranches'
  | 'setThemePref'
  | 'setHistoryFilter'
  | 'setDiffView'
  | 'setSyntaxHighlighting'
>

export type LayoutActions = Pick<LayoutBundle, 'persistLayout' | 'hydrateFromPrefs'>

export type LayoutChromeDimensions = Pick<
  LayoutBundle,
  | 'sidebarWidth'
  | 'setSidebarWidth'
  | 'inspectorHeight'
  | 'setInspectorHeight'
  | 'detailWidth'
  | 'setDetailWidth'
>

export type LayoutHistoryColumns = Pick<
  LayoutBundle,
  | 'historyGraphColWidth'
  | 'setHistoryGraphColWidth'
  | 'historyDateColWidth'
  | 'setHistoryDateColWidth'
  | 'historyAuthorColWidth'
  | 'setHistoryAuthorColWidth'
>

export type LayoutPaneFiles = Pick<
  LayoutBundle,
  | 'inspectorFilesWidth'
  | 'setInspectorFilesWidth'
  | 'changesFilesWidth'
  | 'setChangesFilesWidth'
>

/** Aggregate of every layout slice — prefer a narrower hook when possible. */
export type Layout = LayoutPrefs &
  LayoutActions &
  LayoutChromeDimensions &
  LayoutHistoryColumns &
  LayoutPaneFiles

const LayoutPrefsContext = createContext<LayoutPrefs | null>(null)
const LayoutActionsContext = createContext<LayoutActions | null>(null)
const LayoutChromeContext = createContext<LayoutChromeDimensions | null>(null)
const LayoutHistoryColumnsContext = createContext<LayoutHistoryColumns | null>(null)
const LayoutPaneFilesContext = createContext<LayoutPaneFiles | null>(null)

/** Preferences plus pane and column sizes. Changes while a splitter is dragged, so keep consumers light. */
export function LayoutProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const layout = useLayoutPrefs()

  const prefs = useMemo<LayoutPrefs>(
    () => ({
      prefs: layout.prefs,
      setPrefs: layout.setPrefs,
      sidebarCollapsed: layout.sidebarCollapsed,
      branchesExpanded: layout.branchesExpanded,
      remoteBranchesExpanded: layout.remoteBranchesExpanded,
      detailDock: layout.detailDock,
      diffView: layout.diffView,
      syntaxHighlighting: layout.syntaxHighlighting,
      toggleDock: layout.toggleDock,
      toggleDiffView: layout.toggleDiffView,
      toggleSidebar: layout.toggleSidebar,
      toggleBranches: layout.toggleBranches,
      toggleRemoteBranches: layout.toggleRemoteBranches,
      setThemePref: layout.setThemePref,
      setHistoryFilter: layout.setHistoryFilter,
      setDiffView: layout.setDiffView,
      setSyntaxHighlighting: layout.setSyntaxHighlighting
    }),
    [
      layout.prefs,
      layout.setPrefs,
      layout.sidebarCollapsed,
      layout.branchesExpanded,
      layout.remoteBranchesExpanded,
      layout.detailDock,
      layout.diffView,
      layout.syntaxHighlighting,
      layout.toggleDock,
      layout.toggleDiffView,
      layout.toggleSidebar,
      layout.toggleBranches,
      layout.toggleRemoteBranches,
      layout.setThemePref,
      layout.setHistoryFilter,
      layout.setDiffView,
      layout.setSyntaxHighlighting
    ]
  )

  const actions = useMemo<LayoutActions>(
    () => ({
      persistLayout: layout.persistLayout,
      hydrateFromPrefs: layout.hydrateFromPrefs
    }),
    [layout.persistLayout, layout.hydrateFromPrefs]
  )

  const chrome = useMemo<LayoutChromeDimensions>(
    () => ({
      sidebarWidth: layout.sidebarWidth,
      setSidebarWidth: layout.setSidebarWidth,
      inspectorHeight: layout.inspectorHeight,
      setInspectorHeight: layout.setInspectorHeight,
      detailWidth: layout.detailWidth,
      setDetailWidth: layout.setDetailWidth
    }),
    [
      layout.sidebarWidth,
      layout.setSidebarWidth,
      layout.inspectorHeight,
      layout.setInspectorHeight,
      layout.detailWidth,
      layout.setDetailWidth
    ]
  )

  const historyColumns = useMemo<LayoutHistoryColumns>(
    () => ({
      historyGraphColWidth: layout.historyGraphColWidth,
      setHistoryGraphColWidth: layout.setHistoryGraphColWidth,
      historyDateColWidth: layout.historyDateColWidth,
      setHistoryDateColWidth: layout.setHistoryDateColWidth,
      historyAuthorColWidth: layout.historyAuthorColWidth,
      setHistoryAuthorColWidth: layout.setHistoryAuthorColWidth
    }),
    [
      layout.historyGraphColWidth,
      layout.setHistoryGraphColWidth,
      layout.historyDateColWidth,
      layout.setHistoryDateColWidth,
      layout.historyAuthorColWidth,
      layout.setHistoryAuthorColWidth
    ]
  )

  const paneFiles = useMemo<LayoutPaneFiles>(
    () => ({
      inspectorFilesWidth: layout.inspectorFilesWidth,
      setInspectorFilesWidth: layout.setInspectorFilesWidth,
      changesFilesWidth: layout.changesFilesWidth,
      setChangesFilesWidth: layout.setChangesFilesWidth
    }),
    [
      layout.inspectorFilesWidth,
      layout.setInspectorFilesWidth,
      layout.changesFilesWidth,
      layout.setChangesFilesWidth
    ]
  )

  return (
    <LayoutActionsContext.Provider value={actions}>
      <LayoutPrefsContext.Provider value={prefs}>
        <LayoutChromeContext.Provider value={chrome}>
          <LayoutHistoryColumnsContext.Provider value={historyColumns}>
            <LayoutPaneFilesContext.Provider value={paneFiles}>{children}</LayoutPaneFilesContext.Provider>
          </LayoutHistoryColumnsContext.Provider>
        </LayoutChromeContext.Provider>
      </LayoutPrefsContext.Provider>
    </LayoutActionsContext.Provider>
  )
}

export const useLayoutPrefsState = (): LayoutPrefs =>
  useRequiredContext(LayoutPrefsContext, 'useLayoutPrefsState')

export const useLayoutActions = (): LayoutActions =>
  useRequiredContext(LayoutActionsContext, 'useLayoutActions')

export const useLayoutChrome = (): LayoutChromeDimensions =>
  useRequiredContext(LayoutChromeContext, 'useLayoutChrome')

export const useLayoutHistoryColumns = (): LayoutHistoryColumns =>
  useRequiredContext(LayoutHistoryColumnsContext, 'useLayoutHistoryColumns')

export const useLayoutPaneFiles = (): LayoutPaneFiles =>
  useRequiredContext(LayoutPaneFilesContext, 'useLayoutPaneFiles')

/** Every layout slice. Prefer a narrower layout hook when possible. */
export function useLayout(): Layout {
  const prefs = useLayoutPrefsState()
  const actions = useLayoutActions()
  const chrome = useLayoutChrome()
  const historyColumns = useLayoutHistoryColumns()
  const paneFiles = useLayoutPaneFiles()
  return useMemo(
    () => ({ ...prefs, ...actions, ...chrome, ...historyColumns, ...paneFiles }),
    [prefs, actions, chrome, historyColumns, paneFiles]
  )
}
