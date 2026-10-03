import type React from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  ListFilter,
  Locate,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { confirmDeleteBranch, confirmMerge, confirmRebase } from '../lib/copy'
import { IconButton } from '../components/ui'
import { useRovingList } from '../hooks/useRovingList'
import { useAppStatus } from '../state/AppStatusProvider'
import { useConfirm } from '../state/ConfirmProvider'
import { useDialogActions } from '../state/DialogsProvider'
import { useGitActions, useRemoteOp } from '../state/GitActionsProvider'
import { useHistoryActions } from '../state/HistoryProvider'
import { useLayoutPrefsState } from '../state/LayoutProvider'
import { useActiveRepo, useSession } from '../state/RepoSessionProvider'

// Double-clicking a row checks the branch out; clicks on its buttons must not.
const stopRowEvents = {
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation()
}

export function RepoSidebar(): React.JSX.Element {
  const { busy } = useAppStatus()
  const activeRepo = useActiveRepo()
  const { repos, branches, remoteBranches, currentBranch, localBranchNames } = useSession()
  const {
    sidebarCollapsed,
    branchesExpanded,
    remoteBranchesExpanded,
    toggleSidebar,
    toggleBranches,
    toggleRemoteBranches
  } = useLayoutPrefsState()
  const { openDialog } = useDialogActions()
  const confirm = useConfirm()
  const {
    selectRepo,
    requestRemoveRepo,
    checkoutBranch,
    runMergeOrRebase,
    deleteBranch,
    checkoutRemote,
    runSync
  } = useGitActions()
  const remoteOp = useRemoteOp()
  const fetching = remoteOp?.kind === 'fetch'
  const { showBranchHistory, revealCommit } = useHistoryActions()

  // Each list is one Tab stop: arrows move between rows, Enter opens the repository or checks out the branch.
  const repoRows = useRovingList(
    repos.length,
    repos.findIndex((r) => r.id === activeRepo.id),
    (index) => {
      const repo = repos[index]
      if (repo) selectRepo(repo)
    }
  )
  const branchRows = useRovingList(
    branches.length,
    branches.findIndex((b) => b.current),
    (index) => {
      const branch = branches[index]
      if (branch) void checkoutBranch(branch.name)
    }
  )
  const remoteRows = useRovingList(remoteBranches.length, 0, (index) => {
    const branch = remoteBranches[index]
    if (branch) void checkoutRemote(branch.name)
  })

  const historyButtons = (name: string, sha: string | null): React.JSX.Element => (
    <>
      <IconButton
        label={`Show only ${name} in history`}
        hint="Show only this branch"
        disabled={busy}
        onClick={() => void showBranchHistory(name, sha)}
      >
        <ListFilter size={14} strokeWidth={1.75} />
      </IconButton>
      <IconButton
        label={`Jump to the tip of ${name}`}
        hint="Jump to tip"
        disabled={busy || !sha}
        onClick={() => {
          if (sha) void revealCommit(sha, name)
        }}
      >
        <Locate size={14} strokeWidth={1.75} />
      </IconButton>
    </>
  )

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} data-pane="sidebar">
      <div className="sidebar-top">
        <IconButton
          label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="sidebar-toggle"
          onClick={toggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </IconButton>
        {!sidebarCollapsed && <div className="panel-title sidebar-heading">Repositories</div>}
      </div>
      <ul className="repo-list" aria-label="Repositories" onKeyDown={repoRows.onKeyDown}>
        {repos.map((r, index) => (
          <li
            key={r.id}
            {...repoRows.rowProps(index)}
            className={r.id === activeRepo.id ? 'active' : ''}
            onClick={() => selectRepo(r)}
            title={
              sidebarCollapsed
                ? `${r.name}${r.currentBranch ? ` (${r.currentBranch})` : ''}`
                : r.path
            }
          >
            <div className="repo-row-main">
              <div className="cell-ellipsis repo-name">
                {sidebarCollapsed ? r.name.slice(0, 1).toUpperCase() : r.name}
              </div>
              {!sidebarCollapsed && r.id !== activeRepo.id && (
                <div className="muted cell-ellipsis repo-branch-sub">
                  {r.currentBranch || 'detached'}
                </div>
              )}
            </div>
            {!sidebarCollapsed && (
              <div className="repo-row-actions" onClick={(e) => e.stopPropagation()}>
                <IconButton
                  label={`Remove ${r.name} from list`}
                  hint="Remove from list"
                  disabled={busy}
                  onClick={() => requestRemoveRepo(r)}
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                </IconButton>
              </div>
            )}
          </li>
        ))}
      </ul>

      {!sidebarCollapsed && (
        <div className="branch-summary">
          <div className="branch-summary-label muted">Current branch</div>
          <div
            className="cell-ellipsis branch-summary-name"
            title={currentBranch?.name || activeRepo.currentBranch || 'detached'}
          >
            {currentBranch?.name || activeRepo.currentBranch || 'detached'}
          </div>
          {currentBranch && (currentBranch.ahead > 0 || currentBranch.behind > 0) && (
            <div className="muted ahead-behind text-xs">
              <ArrowUp size={12} strokeWidth={2} />
              {currentBranch.ahead}
              <ArrowDown size={12} strokeWidth={2} />
              {currentBranch.behind}
              {currentBranch.upstream ? ` · ${currentBranch.upstream}` : ''}
            </div>
          )}
        </div>
      )}

      {!sidebarCollapsed && (
        <>
          <div className="panel-disclosure-row">
            <button type="button" className="panel-title panel-disclosure" onClick={toggleBranches}>
              <span>Branches</span>
              <span className="muted">
                {branchesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>
            <IconButton label="New branch" onClick={() => openDialog('createBranch')}>
              <Plus size={16} />
            </IconButton>
          </div>
          {branchesExpanded && (
            <ul className="branch-list" aria-label="Branches" onKeyDown={branchRows.onKeyDown}>
              {branches.map((b, index) => (
                <li
                  key={b.name}
                  {...branchRows.rowProps(index)}
                  className={b.current ? 'active' : ''}
                  onDoubleClick={() => void checkoutBranch(b.name)}
                  title="Double-click or press Enter to check out"
                >
                  <div className="branch-row-main">
                    <div className="cell-ellipsis">{b.name}</div>
                    {(b.ahead > 0 || b.behind > 0) && (
                      <div className="muted ahead-behind text-xs">
                        <ArrowUp size={12} strokeWidth={2} />
                        {b.ahead}
                        <ArrowDown size={12} strokeWidth={2} />
                        {b.behind}
                      </div>
                    )}
                  </div>
                  <div className="branch-row-actions" {...stopRowEvents}>
                    {historyButtons(b.name, b.sha)}
                    {!b.current && (
                      <>
                        <IconButton
                          label={`Merge ${b.name} into current`}
                          disabled={busy}
                          onClick={() =>
                            void confirm(confirmMerge(b.name)).then((ok) => {
                              if (ok) void runMergeOrRebase('merge', b.name)
                            })
                          }
                        >
                          <GitMerge size={14} strokeWidth={1.75} />
                        </IconButton>
                        <IconButton
                          label={`Rebase current onto ${b.name}`}
                          disabled={busy}
                          onClick={() =>
                            void confirm(confirmRebase(b.name)).then((ok) => {
                              if (ok) void runMergeOrRebase('rebase', b.name)
                            })
                          }
                        >
                          <GitBranchPlus size={14} strokeWidth={1.75} />
                        </IconButton>
                        <IconButton
                          label={`Delete branch ${b.name}`}
                          hint={`Delete ${b.name}`}
                          disabled={busy}
                          onClick={() =>
                            void confirm(confirmDeleteBranch(b.name)).then((ok) => {
                              if (ok) void deleteBranch(b.name)
                            })
                          }
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {activeRepo.remotes.length > 0 && (
            <>
              <div className="panel-disclosure-row">
                <button
                  type="button"
                  className="panel-title panel-disclosure"
                  onClick={toggleRemoteBranches}
                >
                  <span>Remote branches</span>
                  <span className="muted">
                    {remoteBranchesExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>
                </button>
                {/* The list shows what the last fetch saw; this updates it, like Sync → Fetch. */}
                <IconButton
                  label={fetching ? 'Fetching remote branches…' : 'Fetch remote branches'}
                  disabled={busy || remoteOp !== null}
                  onClick={() => void runSync('fetch')}
                >
                  <RefreshCw size={14} strokeWidth={1.75} className={fetching ? 'spin' : undefined} />
                </IconButton>
              </div>
              {remoteBranchesExpanded && (
                <ul className="branch-list" aria-label="Remote branches" onKeyDown={remoteRows.onKeyDown}>
                  {remoteBranches.map((b, index) => {
                    const hasLocal = localBranchNames.has(b.shortName)
                    return (
                      <li
                        key={b.name}
                        {...remoteRows.rowProps(index)}
                        onDoubleClick={() => void checkoutRemote(b.name)}
                        title={
                          hasLocal
                            ? `Double-click or press Enter to check out local "${b.shortName}"`
                            : 'Double-click or press Enter to create a local tracking branch and check it out'
                        }
                      >
                        <div className="branch-row-main">
                          <div className="cell-ellipsis">{b.name}</div>
                          {hasLocal && <div className="muted text-xs">local</div>}
                        </div>
                        <div className="branch-row-actions" {...stopRowEvents}>
                          {historyButtons(b.name, b.sha)}
                          <IconButton
                            label={
                              hasLocal
                                ? `Checkout local ${b.shortName}`
                                : `Checkout and track ${b.name}`
                            }
                            disabled={busy}
                            onClick={() => void checkoutRemote(b.name)}
                          >
                            <GitBranch size={14} strokeWidth={1.75} />
                          </IconButton>
                        </div>
                      </li>
                    )
                  })}
                  {remoteBranches.length === 0 && (
                    <li className="muted text-xs" style={{ pointerEvents: 'none' }}>
                      No remote branches — fetch to refresh
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </aside>
  )
}
