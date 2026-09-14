import type React from 'react'
import { PanelBottom, PanelRight } from 'lucide-react'
import type {
  AppPreferences,
  BranchInfo,
  Commit,
  CommitDetail,
  DiffResult,
  FileChange,
  GitIdentity,
  GraphNode,
  RemoteBranchInfo,
  Repository,
  StatusEntry
} from '@shared/ipc'

import { Splitter } from '../components/Splitter'
import { Banner, IconButton } from '../components/ui'
import { CONFIRM_MERGE, CONFIRM_REBASE } from '../lib/copy'
import { HistoryGraph } from '../features/history-graph/HistoryGraph'
import { CommitDetailPane } from '../features/commit-detail/CommitDetailPane'
import {
  type DiffSide,
  WorkingTreeDetailPane
} from '../features/changes/WorkingTreeDetailPane'
import type { Selection, ViewMode } from '../hooks/selection'
import { RepoSidebar } from './RepoSidebar'

type WorkspaceShellProps = {
  activeRepo: Repository
  repos: Repository[]
  branches: BranchInfo[]
  remoteBranches: RemoteBranchInfo[]
  currentBranch: BranchInfo | null
  localBranchNames: Set<string>
  sidebarCollapsed: boolean
  branchesExpanded: boolean
  remoteBranchesExpanded: boolean
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
  persistLayout: (partial: Partial<AppPreferences>) => void
  detailDock: 'right' | 'bottom'
  viewMode: ViewMode
  selection: Selection | null
  selectedSha: string | null
  commits: Commit[]
  graphBySha: Map<string, GraphNode>
  headSha: string | null
  busy: boolean
  historyLoadingMore: boolean
  nextCursor: string | null
  historyFilter: AppPreferences['historyFilter']
  onHistoryFilterChange: (filter: AppPreferences['historyFilter']) => void
  onLoadMoreHistory: () => void
  onSelectCommit: (sha: string) => void
  detail: CommitDetail | null
  selectedFile: FileChange | null
  setSelectedFile: (file: FileChange | null) => void
  diff: DiffResult | null
  diffLoading: boolean
  status: StatusEntry[]
  focusedStatusPath: string | null
  setFocusedStatusPath: (path: string | null) => void
  diffSide: DiffSide
  setDiffSide: (side: DiffSide) => void
  identity: GitIdentity | null
  rebaseInProgress: boolean
  mergeInProgress: boolean
  error: string | null
  onToggleSidebar: () => void
  onToggleBranches: () => void
  onToggleRemoteBranches: () => void
  onToggleDock: () => void
  onSelectRepo: (repo: Repository) => void
  onRequestRemove: (repo: Repository) => void
  onCreateBranch: () => void
  onCheckoutBranch: (name: string) => void
  onMergeBranch: (name: string) => void
  onRebaseOnto: (name: string) => void
  onDeleteBranch: (name: string) => void
  onCheckoutRemote: (remoteRef: string) => void
  onMergeCommit: (sha: string) => void
  onRebaseOntoCommit: (sha: string) => void
  onRefreshWorkingTree: () => Promise<void>
  onError: (msg: string | null) => void
  onBrowseHistory: () => void
  onEditIdentity: () => void
  onRebaseContinue: () => Promise<void>
  onRebaseSkip: () => Promise<void>
  onRebaseAbort: () => Promise<void>
  onMergeAbort: () => Promise<void>
}

export function WorkspaceShell(props: WorkspaceShellProps): React.JSX.Element {
  const {
    activeRepo,
    viewMode,
    selection,
    detailDock,
    sidebarCollapsed,
    sidebarWidth,
    inspectorHeight,
    detailWidth,
    error
  } = props

  const showInspector = viewMode === 'history' && selection?.kind === 'commit'
  const sideBySideDiff = detailDock === 'right'

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
      <RepoSidebar
        repos={props.repos}
        activeRepo={activeRepo}
        branches={props.branches}
        remoteBranches={props.remoteBranches}
        currentBranch={props.currentBranch}
        localBranchNames={props.localBranchNames}
        sidebarCollapsed={sidebarCollapsed}
        branchesExpanded={props.branchesExpanded}
        remoteBranchesExpanded={props.remoteBranchesExpanded}
        busy={props.busy}
        onToggleSidebar={props.onToggleSidebar}
        onToggleBranches={props.onToggleBranches}
        onToggleRemoteBranches={props.onToggleRemoteBranches}
        onSelectRepo={props.onSelectRepo}
        onRequestRemove={props.onRequestRemove}
        onCreateBranch={props.onCreateBranch}
        onCheckoutBranch={props.onCheckoutBranch}
        onMergeBranch={props.onMergeBranch}
        onRebaseOnto={props.onRebaseOnto}
        onDeleteBranch={props.onDeleteBranch}
        onCheckoutRemote={props.onCheckoutRemote}
      />

      <Splitter
        axis="x"
        className="splitter-sidebar"
        value={sidebarWidth}
        min={140}
        max={480}
        disabled={sidebarCollapsed}
        onChange={props.setSidebarWidth}
        onChangeEnd={(w) => props.persistLayout({ sidebarWidth: w })}
        title="Resize sidebar"
      />

      {viewMode === 'history' ? (
        <>
          <section className="history-pane">
            {error && <Banner>{error}</Banner>}
            <HistoryGraph
              commits={props.commits}
              graphBySha={props.graphBySha}
              headSha={props.headSha}
              selectedSha={props.selectedSha}
              busy={props.busy}
              loadingMore={props.historyLoadingMore}
              hasMore={Boolean(props.nextCursor)}
              onLoadMore={props.onLoadMoreHistory}
              onSelect={props.onSelectCommit}
              filter={props.historyFilter || 'all'}
              onFilterChange={props.onHistoryFilterChange}
              graphColWidth={props.historyGraphColWidth}
              dateColWidth={props.historyDateColWidth}
              authorColWidth={props.historyAuthorColWidth}
              onGraphColWidthChange={props.setHistoryGraphColWidth}
              onDateColWidthChange={props.setHistoryDateColWidth}
              onAuthorColWidthChange={props.setHistoryAuthorColWidth}
              onColumnWidthsCommit={(next) => props.persistLayout(next)}
            />
          </section>
          {showInspector && (
            <section className="detail-pane">
              <div className="inspector-chrome">
                <span className="muted">Inspector</span>
                <IconButton
                  label={detailDock === 'right' ? 'Dock inspector bottom' : 'Dock inspector right'}
                  onClick={props.onToggleDock}
                >
                  {detailDock === 'right' ? (
                    <PanelBottom size={16} strokeWidth={1.75} />
                  ) : (
                    <PanelRight size={16} strokeWidth={1.75} />
                  )}
                </IconButton>
              </div>
              <CommitDetailPane
                detail={props.detail}
                selectedFile={props.selectedFile}
                diff={props.diff}
                diffLoading={props.diffLoading}
                onSelectFile={props.setSelectedFile}
                sideBySide={sideBySideDiff}
                busy={props.busy}
                filesWidth={props.inspectorFilesWidth}
                onFilesWidthChange={props.setInspectorFilesWidth}
                onFilesWidthCommit={(w) => props.persistLayout({ inspectorFilesWidth: w })}
                onMergeIntoCurrent={async (sha) => {
                  if (!confirm(CONFIRM_MERGE(sha.slice(0, 7)))) return
                  props.onMergeCommit(sha)
                }}
                onRebaseOnto={async (sha) => {
                  if (!confirm(CONFIRM_REBASE(sha.slice(0, 7)))) return
                  props.onRebaseOntoCommit(sha)
                }}
              />
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
              onChange={props.setInspectorHeight}
              onChangeEnd={(h) => props.persistLayout({ inspectorHeight: h })}
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
              onChange={props.setDetailWidth}
              onChangeEnd={(w) => props.persistLayout({ detailWidth: w })}
              title="Resize inspector"
            />
          )}
        </>
      ) : (
        <section className="changes-pane">
          {error && <Banner>{error}</Banner>}
          <WorkingTreeDetailPane
            repoPath={activeRepo.path}
            status={props.status}
            focusedPath={props.focusedStatusPath}
            diffSide={props.diffSide}
            diff={props.diff}
            diffLoading={props.diffLoading}
            identity={props.identity}
            canAmend={Boolean(props.headSha)}
            rebaseInProgress={props.rebaseInProgress}
            mergeInProgress={props.mergeInProgress}
            filesWidth={props.changesFilesWidth}
            onFilesWidthChange={props.setChangesFilesWidth}
            onFilesWidthCommit={(w) => props.persistLayout({ changesFilesWidth: w })}
            onFocusFile={props.setFocusedStatusPath}
            onDiffSideChange={props.setDiffSide}
            onRefresh={props.onRefreshWorkingTree}
            onError={props.onError}
            onBrowseHistory={props.onBrowseHistory}
            onEditIdentity={props.onEditIdentity}
            onRebaseContinue={props.onRebaseContinue}
            onRebaseSkip={props.onRebaseSkip}
            onRebaseAbort={props.onRebaseAbort}
            onMergeAbort={props.onMergeAbort}
          />
        </section>
      )}
    </div>
  )
}
