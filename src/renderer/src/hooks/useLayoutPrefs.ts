import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { AppPreferences } from '@shared/ipc'
import { LAYOUT_DEFAULTS } from '@shared/layout-defaults'
import type { ThemePreference } from '@shared/theme'
import { resolveAndApplyTheme } from '../lib/theme'

export function useLayoutPrefs(): {
  prefs: AppPreferences | null
  setPrefs: Dispatch<SetStateAction<AppPreferences | null>>
  sidebarWidth: number
  setSidebarWidth: (w: number) => void
  inspectorHeight: number
  setInspectorHeight: (h: number) => void
  detailWidth: number
  setDetailWidth: (w: number) => void
  inspectorFilesWidth: number
  setInspectorFilesWidth: (w: number) => void
  changesFilesWidth: number
  setChangesFilesWidth: (w: number) => void
  historyGraphColWidth: number
  setHistoryGraphColWidth: (w: number) => void
  historyDateColWidth: number
  setHistoryDateColWidth: (w: number) => void
  historyAuthorColWidth: number
  setHistoryAuthorColWidth: (w: number) => void
  sidebarCollapsed: boolean
  branchesExpanded: boolean
  remoteBranchesExpanded: boolean
  detailDock: 'right' | 'bottom'
  diffView: AppPreferences['diffView']
  syntaxHighlighting: boolean
  persistLayout: (partial: Partial<AppPreferences>) => void
  hydrateFromPrefs: (p: AppPreferences) => void
  toggleDock: () => void
  toggleDiffView: () => void
  toggleSidebar: () => void
  toggleBranches: () => void
  toggleRemoteBranches: () => void
  setThemePref: (theme: ThemePreference) => void
  setHistoryFilter: (historyFilter: AppPreferences['historyFilter']) => void
  setDiffView: (diffView: AppPreferences['diffView']) => void
  setSyntaxHighlighting: (enabled: boolean) => void
} {
  const [prefs, setPrefs] = useState<AppPreferences | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState<number>(LAYOUT_DEFAULTS.sidebarWidth)
  const [inspectorHeight, setInspectorHeight] = useState<number>(LAYOUT_DEFAULTS.inspectorHeight)
  const [detailWidth, setDetailWidth] = useState<number>(LAYOUT_DEFAULTS.detailWidth)
  const [inspectorFilesWidth, setInspectorFilesWidth] = useState<number>(
    LAYOUT_DEFAULTS.inspectorFilesWidth
  )
  const [changesFilesWidth, setChangesFilesWidth] = useState<number>(
    LAYOUT_DEFAULTS.changesFilesWidth
  )
  const [historyGraphColWidth, setHistoryGraphColWidth] = useState<number>(
    LAYOUT_DEFAULTS.historyGraphColWidth
  )
  const [historyDateColWidth, setHistoryDateColWidth] = useState<number>(
    LAYOUT_DEFAULTS.historyDateColWidth
  )
  const [historyAuthorColWidth, setHistoryAuthorColWidth] = useState<number>(
    LAYOUT_DEFAULTS.historyAuthorColWidth
  )

  const sidebarCollapsed = Boolean(prefs?.sidebarCollapsed)
  const branchesExpanded = Boolean(prefs?.branchesExpanded)
  const remoteBranchesExpanded = Boolean(prefs?.remoteBranchesExpanded)
  const detailDock = prefs?.detailDock === 'right' ? 'right' : 'bottom'
  const diffView = prefs?.diffView === 'side-by-side' ? 'side-by-side' : 'inline'
  const syntaxHighlighting = prefs?.syntaxHighlighting !== false

  const persistLayout = useCallback((partial: Partial<AppPreferences>): void => {
    void window.gitManager.prefs.set(partial).then(setPrefs)
  }, [])

  const hydrateFromPrefs = useCallback((p: AppPreferences): void => {
    setPrefs(p)
    setSidebarWidth(p.sidebarWidth)
    setInspectorHeight(p.inspectorHeight)
    setDetailWidth(p.detailWidth)
    setInspectorFilesWidth(p.inspectorFilesWidth)
    setChangesFilesWidth(p.changesFilesWidth)
    setHistoryGraphColWidth(p.historyGraphColWidth)
    setHistoryDateColWidth(p.historyDateColWidth)
    setHistoryAuthorColWidth(p.historyAuthorColWidth)
    resolveAndApplyTheme(p.theme)
  }, [])

  const themePref = prefs?.theme
  useEffect(() => {
    if (!themePref) return
    resolveAndApplyTheme(themePref)
    if (themePref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      resolveAndApplyTheme('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [themePref])

  const toggleDock = useCallback((): void => {
    void window.gitManager.prefs
      .set({ detailDock: detailDock === 'right' ? 'bottom' : 'right' })
      .then(setPrefs)
  }, [detailDock])

  const toggleDiffView = useCallback((): void => {
    void window.gitManager.prefs
      .set({ diffView: diffView === 'side-by-side' ? 'inline' : 'side-by-side' })
      .then(setPrefs)
  }, [diffView])

  const toggleSidebar = useCallback((): void => {
    void window.gitManager.prefs.set({ sidebarCollapsed: !sidebarCollapsed }).then(setPrefs)
  }, [sidebarCollapsed])

  const toggleBranches = useCallback((): void => {
    void window.gitManager.prefs.set({ branchesExpanded: !branchesExpanded }).then(setPrefs)
  }, [branchesExpanded])

  const toggleRemoteBranches = useCallback((): void => {
    void window.gitManager.prefs
      .set({ remoteBranchesExpanded: !remoteBranchesExpanded })
      .then(setPrefs)
  }, [remoteBranchesExpanded])

  const setThemePref = useCallback((theme: ThemePreference): void => {
    void window.gitManager.prefs.set({ theme }).then((p) => {
      setPrefs(p)
      resolveAndApplyTheme(p.theme)
    })
  }, [])

  const setHistoryFilter = useCallback((historyFilter: AppPreferences['historyFilter']): void => {
    void window.gitManager.prefs.set({ historyFilter }).then(setPrefs)
  }, [])

  const setDiffView = useCallback((view: AppPreferences['diffView']): void => {
    void window.gitManager.prefs.set({ diffView: view }).then(setPrefs)
  }, [])

  const setSyntaxHighlighting = useCallback((enabled: boolean): void => {
    void window.gitManager.prefs.set({ syntaxHighlighting: enabled }).then(setPrefs)
  }, [])

  return {
    prefs,
    setPrefs,
    sidebarWidth,
    setSidebarWidth,
    inspectorHeight,
    setInspectorHeight,
    detailWidth,
    setDetailWidth,
    inspectorFilesWidth,
    setInspectorFilesWidth,
    changesFilesWidth,
    setChangesFilesWidth,
    historyGraphColWidth,
    setHistoryGraphColWidth,
    historyDateColWidth,
    setHistoryDateColWidth,
    historyAuthorColWidth,
    setHistoryAuthorColWidth,
    sidebarCollapsed,
    branchesExpanded,
    remoteBranchesExpanded,
    detailDock,
    diffView,
    syntaxHighlighting,
    persistLayout,
    hydrateFromPrefs,
    toggleDock,
    toggleDiffView,
    toggleSidebar,
    toggleBranches,
    toggleRemoteBranches,
    setThemePref,
    setHistoryFilter,
    setDiffView,
    setSyntaxHighlighting
  }
}
