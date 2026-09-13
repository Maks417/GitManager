import type React from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2
} from 'lucide-react'
import type { BranchInfo, RemoteBranchInfo, Repository } from '@shared/ipc'
import { CONFIRM_MERGE, CONFIRM_REBASE } from '../lib/copy'
import { IconButton } from '../components/ui'

type RepoSidebarProps = {
  repos: Repository[]
  activeRepo: Repository
  branches: BranchInfo[]
  remoteBranches: RemoteBranchInfo[]
  currentBranch: BranchInfo | null
  localBranchNames: Set<string>
  sidebarCollapsed: boolean
  branchesExpanded: boolean
  remoteBranchesExpanded: boolean
  busy: boolean
  onToggleSidebar: () => void
  onToggleBranches: () => void
  onToggleRemoteBranches: () => void
  onSelectRepo: (repo: Repository) => void
  onRequestRemove: (repo: Repository) => void
  onCreateBranch: () => void
  onCheckoutBranch: (name: string) => void
  onMergeBranch: (name: string) => void
  onRebaseOnto: (name: string) => void
  onDeleteBranch: (name: string) => void
  onCheckoutRemote: (remoteRef: string) => void
}

export function RepoSidebar({
  repos,
  activeRepo,
  branches,
  remoteBranches,
  currentBranch,
  localBranchNames,
  sidebarCollapsed,
  branchesExpanded,
  remoteBranchesExpanded,
  busy,
  onToggleSidebar,
  onToggleBranches,
  onToggleRemoteBranches,
  onSelectRepo,
  onRequestRemove,
  onCreateBranch,
  onCheckoutBranch,
  onMergeBranch,
  onRebaseOnto,
  onDeleteBranch,
  onCheckoutRemote
}: RepoSidebarProps): React.JSX.Element {
  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-top">
        <IconButton
          label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="sidebar-toggle"
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </IconButton>
        {!sidebarCollapsed && <div className="panel-title sidebar-heading">Repositories</div>}
      </div>
      <ul className="repo-list">
        {repos.map((r) => (
          <li
            key={r.id}
            className={r.id === activeRepo.id ? 'active' : ''}
            onClick={() => onSelectRepo(r)}
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
                  onClick={() => onRequestRemove(r)}
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
            <button type="button" className="panel-title panel-disclosure" onClick={onToggleBranches}>
              <span>Branches</span>
              <span className="muted">
                {branchesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>
            <IconButton label="New branch" onClick={onCreateBranch}>
              <Plus size={16} />
            </IconButton>
          </div>
          {branchesExpanded && (
            <ul className="branch-list">
              {branches.map((b) => (
                <li
                  key={b.name}
                  className={b.current ? 'active' : ''}
                  onDoubleClick={() => onCheckoutBranch(b.name)}
                  title="Double-click to checkout"
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
                  {!b.current && (
                    <div className="branch-row-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        label={`Merge ${b.name} into current`}
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(CONFIRM_MERGE(b.name))) return
                          onMergeBranch(b.name)
                        }}
                      >
                        <GitMerge size={14} strokeWidth={1.75} />
                      </IconButton>
                      <IconButton
                        label={`Rebase current onto ${b.name}`}
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(CONFIRM_REBASE(b.name))) return
                          onRebaseOnto(b.name)
                        }}
                      >
                        <GitBranchPlus size={14} strokeWidth={1.75} />
                      </IconButton>
                      <IconButton
                        label={`Delete branch ${b.name}`}
                        hint={`Delete ${b.name}`}
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(`Delete branch "${b.name}"?`)) return
                          onDeleteBranch(b.name)
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </IconButton>
                    </div>
                  )}
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
                  onClick={onToggleRemoteBranches}
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
              </div>
              {remoteBranchesExpanded && (
                <ul className="branch-list">
                  {remoteBranches.map((b) => {
                    const hasLocal = localBranchNames.has(b.shortName)
                    return (
                      <li
                        key={b.name}
                        onDoubleClick={() => onCheckoutRemote(b.name)}
                        title={
                          hasLocal
                            ? `Double-click to checkout local "${b.shortName}"`
                            : 'Double-click to create local tracking branch and checkout'
                        }
                      >
                        <div className="branch-row-main">
                          <div className="cell-ellipsis">{b.name}</div>
                          {hasLocal && <div className="muted text-xs">local</div>}
                        </div>
                        <div className="branch-row-actions" onClick={(e) => e.stopPropagation()}>
                          <IconButton
                            label={
                              hasLocal
                                ? `Checkout local ${b.shortName}`
                                : `Checkout and track ${b.name}`
                            }
                            disabled={busy}
                            onClick={() => onCheckoutRemote(b.name)}
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
