import type React from 'react'
import { PanelBottom, PanelRight } from 'lucide-react'
import { Splitter } from '../components/Splitter'
import { Banner, IconButton } from '../components/ui'
import { WorkingTreeDetailPane } from '../features/changes/WorkingTreeDetailPane'
import { CommitDetailPane } from '../features/commit-detail/CommitDetailPane'
import { HistoryGraph } from '../features/history-graph/HistoryGraph'
import { useAppStatus } from '../state/AppStatusProvider'
import { useLayout } from '../state/LayoutProvider'
import { useActiveRepo } from '../state/RepoSessionProvider'
import { useSelection } from '../state/SelectionProvider'
import { RepoSidebar } from './RepoSidebar'
import { WatchNotice } from './WatchNotice'

/** Sidebar, history or changes, and the commit inspector of the active repository. */
export function WorkspaceShell(): React.JSX.Element {
  const { error } = useAppStatus()
  const activeRepo = useActiveRepo()
  const { viewMode, selection } = useSelection()
  const {
    detailDock,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    inspectorHeight,
    setInspectorHeight,
    detailWidth,
    setDetailWidth,
    persistLayout,
    toggleDock
  } = useLayout()

  const showInspector = viewMode === 'history' && selection?.kind === 'commit'

  const workspaceClass = [
    'workspace',
    viewMode === 'history' ? 'mode-history' : 'mode-changes',
    viewMode === 'history' && detailDock === 'bottom' ? 'dock-bottom' : '',
    viewMode === 'history' && detailDock === 'right' ? 'dock-right' : '',
    !showInspector && viewMode === 'history' ? 'no-inspector' : '',
    sidebarCollapsed ? 'nav-collapsed' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={workspaceClass}
      style={
        {
          '--sidebar-width': `${sidebarCollapsed ? 52 : sidebarWidth}px`,
          '--inspector-height': `${inspectorHeight}px`,
          '--detail-width': `${detailWidth}px`
        } as React.CSSProperties
      }
    >
      <RepoSidebar />

      <Splitter
        axis="x"
        className="splitter-sidebar"
        value={sidebarWidth}
        min={140}
        max={480}
        disabled={sidebarCollapsed}
        onChange={setSidebarWidth}
        onChangeEnd={(w) => persistLayout({ sidebarWidth: w })}
        title="Resize sidebar"
      />

      {viewMode === 'history' ? (
        <>
          <section className="history-pane" data-pane="main">
            {error && <Banner>{error}</Banner>}
            <WatchNotice />
            <HistoryGraph />
          </section>
          {showInspector && (
            <section className="detail-pane" data-pane="inspector">
              <div className="inspector-chrome">
                <span className="muted">Inspector</span>
                <IconButton
                  label={detailDock === 'right' ? 'Dock inspector bottom' : 'Dock inspector right'}
                  onClick={toggleDock}
                >
                  {detailDock === 'right' ? (
                    <PanelBottom size={16} strokeWidth={1.75} />
                  ) : (
                    <PanelRight size={16} strokeWidth={1.75} />
                  )}
                </IconButton>
              </div>
              <CommitDetailPane />
            </section>
          )}
          {showInspector && detailDock === 'bottom' && (
            <Splitter
              axis="y"
              className="splitter-inspector-y"
              value={inspectorHeight}
              min={180}
              // Capped at the AppPreferencesSchema maximum so the size can be saved as dragged.
              max={Math.min(900, Math.max(220, Math.floor(window.innerHeight * 0.7)))}
              reverse
              onChange={setInspectorHeight}
              onChangeEnd={(h) => persistLayout({ inspectorHeight: h })}
              title="Resize inspector"
            />
          )}
          {showInspector && detailDock === 'right' && (
            <Splitter
              axis="x"
              className="splitter-detail-x"
              value={detailWidth}
              min={280}
              max={Math.min(900, Math.max(360, Math.floor(window.innerWidth * 0.6)))}
              reverse
              onChange={setDetailWidth}
              onChangeEnd={(w) => persistLayout({ detailWidth: w })}
              title="Resize inspector"
            />
          )}
        </>
      ) : (
        <section className="changes-pane" data-pane="main">
          {error && <Banner>{error}</Banner>}
          <WatchNotice />
          {/* Keyed by repository: a commit message or checked files never carry over to another one. */}
          <WorkingTreeDetailPane key={activeRepo.path} />
        </section>
      )}
    </div>
  )
}
