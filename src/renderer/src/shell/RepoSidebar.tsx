import { useState } from 'react'
import type React from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Ellipsis, ListFilter, Locate, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { confirmDeleteBranch, confirmMerge, confirmRebase } from '../lib/copy'
import { Button, ContextMenu, IconButton, isMenuKey, menuPointFor, type MenuItem } from '../components/ui'
import { useRovingList } from '../hooks/useRovingList'
import { useAppStatus } from '../state/AppStatusProvider'
import { useConfirm } from '../state/ConfirmProvider'
import { useDialogActions } from '../state/DialogsProvider'
import { useGitActions, useRemoteOp } from '../state/GitActionsProvider'
import { useHistoryActions } from '../state/HistoryProvider'
import { useLayoutPrefsState } from '../state/LayoutProvider'
import { useActiveRepo, useSession } from '../state/RepoSessionProvider'

const stopRowEvents = {
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('button')) e.stopPropagation()
  }
}

type SidebarMenu = { kind: 'local' | 'remote' | 'remotes'; name: string; x: number; y: number }

export function RepoSidebar(): React.JSX.Element {
  const { busy } = useAppStatus()
  const activeRepo = useActiveRepo()
  const { repos, branches, remoteBranches, currentBranch, localBranchNames } = useSession()
  const { sidebarCollapsed, branchesExpanded, remoteBranchesExpanded, toggleSidebar, toggleBranches, toggleRemoteBranches } = useLayoutPrefsState()
  const { openDialog, openBranchDialog } = useDialogActions()
  const confirm = useConfirm()
  const { selectRepo, requestRemoveRepo, checkoutBranch, runMergeOrRebase, deleteBranch, checkoutRemote, runSync } = useGitActions()
  const remoteOp = useRemoteOp()
  const blocked = busy || Boolean(remoteOp)
  const fetching = remoteOp?.kind === 'fetch'
  const { showBranchHistory, revealCommit } = useHistoryActions()
  const [menu, setMenu] = useState<SidebarMenu | null>(null)

  const repoRows = useRovingList(repos.length, repos.findIndex((repo) => repo.id === activeRepo.id), (index) => {
    const repo = repos[index]
    if (repo) selectRepo(repo)
  })
  const branchRows = useRovingList(branches.length, branches.findIndex((branch) => branch.current), (index) => {
    const branch = branches[index]
    if (branch && !blocked) void checkoutBranch(branch.name)
  })
  const remoteRows = useRovingList(remoteBranches.length, 0, (index) => {
    const branch = remoteBranches[index]
    if (branch && !blocked) void checkoutRemote(branch.name)
  })

  const tracking = (name: string): void => openBranchDialog({ kind: 'tracking', repoPath: activeRepo.path, branchName: name })
  const pushTo = (name: string): void => openBranchDialog({ kind: 'publish', repoPath: activeRepo.path, branchName: name })
  const menuHandlers = (kind: 'local' | 'remote', name: string): React.HTMLAttributes<HTMLLIElement> => ({
    onContextMenu: (e) => {
      e.preventDefault()
      if (blocked) return
      e.currentTarget.focus()
      setMenu({ kind, name, x: e.clientX, y: e.clientY })
    },
    onKeyDown: (e) => {
      if (!isMenuKey(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (blocked) return
      setMenu({ kind, name, ...menuPointFor(e.currentTarget) })
    }
  })
  const menuButton = (kind: 'local' | 'remote', name: string): React.JSX.Element => (
    <IconButton label={`Actions for ${name}`} hint="Branch actions" disabled={blocked} aria-haspopup="menu" aria-expanded={menu?.kind === kind && menu.name === name} onClick={(e) => setMenu({ kind, name, ...menuPointFor(e.currentTarget) })}>
      <Ellipsis size={16} strokeWidth={1.75} />
    </IconButton>
  )
  const historyButtons = (name: string, sha: string | null): React.JSX.Element => (
    <>
      <IconButton label={`Show only ${name} in history`} hint="Show only this branch" disabled={busy} onClick={() => void showBranchHistory(name, sha)}>
        <ListFilter size={14} strokeWidth={1.75} />
      </IconButton>
      <IconButton label={`Jump to the tip of ${name}`} hint="Jump to tip" disabled={busy || !sha} onClick={() => { if (sha) void revealCommit(sha, name) }}>
        <Locate size={14} strokeWidth={1.75} />
      </IconButton>
    </>
  )

  const local = menu?.kind === 'local' ? branches.find((branch) => branch.name === menu.name) : undefined
  const remote = menu?.kind === 'remote' ? remoteBranches.find((branch) => branch.name === menu.name) : undefined
  const menuItems: MenuItem[] = local ? [
    { label: 'Check out', disabled: blocked || local.current, onSelect: () => void checkoutBranch(local.name) },
    { label: 'Merge into current branch', disabled: blocked || local.current, onSelect: () => {
      void confirm(confirmMerge(local.name)).then((ok) => { if (ok) void runMergeOrRebase('merge', local.name) })
    } },
    { label: 'Rebase current branch onto this', disabled: blocked || local.current, onSelect: () => {
      void confirm(confirmRebase(local.name)).then((ok) => { if (ok) void runMergeOrRebase('rebase', local.name) })
    } },
    { label: 'Tracking', separatorBefore: true, disabled: blocked, onSelect: () => tracking(local.name) },
    ...(local.current ? [{ label: local.upstream ? 'Push to' : 'Publish branch', disabled: blocked || !local.sha, onSelect: () => pushTo(local.name) }] : []),
    { label: 'Delete branch', separatorBefore: true, danger: true, disabled: blocked || local.current, onSelect: () => {
      void confirm(confirmDeleteBranch(local.name)).then((ok) => { if (ok) void deleteBranch(local.name) })
    } }
  ] : remote ? [
    { label: localBranchNames.has(remote.shortName) ? 'Check out local branch' : 'Check out and track', disabled: blocked, onSelect: () => void checkoutRemote(remote.name) }
  ] : menu?.kind === 'remotes' ? [
    { label: 'Manage remotes', disabled: blocked, onSelect: () => openDialog('remotes') }
  ] : []

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} data-pane="sidebar">
      {menu && menuItems.length > 0 && <ContextMenu x={menu.x} y={menu.y} items={menuItems} ariaLabel={menu.kind === 'remotes' ? 'Remote actions' : `Actions for ${menu.name}`} onClose={() => setMenu(null)} />}
      <div className="sidebar-top">
        <IconButton label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="sidebar-toggle" onClick={toggleSidebar}>
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </IconButton>
        {!sidebarCollapsed && <div className="panel-title sidebar-heading">Repositories</div>}
      </div>
      <ul className="repo-list" aria-label="Repositories" onKeyDown={repoRows.onKeyDown}>
        {repos.map((repo, index) => (
          <li key={repo.id} {...repoRows.rowProps(index)} className={repo.id === activeRepo.id ? 'active' : ''} onClick={() => selectRepo(repo)} title={sidebarCollapsed ? `${repo.name}${repo.currentBranch ? ` (${repo.currentBranch})` : ''}` : repo.path}>
            <div className="repo-row-main">
              <div className="cell-ellipsis repo-name">{sidebarCollapsed ? repo.name.slice(0, 1).toUpperCase() : repo.name}</div>
              {!sidebarCollapsed && repo.id !== activeRepo.id && <div className="muted cell-ellipsis repo-branch-sub">{repo.currentBranch || 'detached'}</div>}
            </div>
            {!sidebarCollapsed && <div className="repo-row-actions" onClick={(e) => e.stopPropagation()}>
              <IconButton label={`Remove ${repo.name} from list`} hint="Remove from list" disabled={busy} onClick={() => requestRemoveRepo(repo)}><Trash2 size={14} strokeWidth={1.75} /></IconButton>
            </div>}
          </li>
        ))}
      </ul>
      {!sidebarCollapsed && (
        <>
          <div className="branch-summary">
            <div className="branch-summary-label muted">Current branch</div>
            <div className="cell-ellipsis branch-summary-name" title={currentBranch?.name || activeRepo.currentBranch || 'detached'}>{currentBranch?.name || activeRepo.currentBranch || 'detached'}</div>
            {currentBranch && <>
              <button type="button" className="branch-tracking muted cell-ellipsis" title={`Change tracking for ${currentBranch.name}`} disabled={blocked} onClick={() => tracking(currentBranch.name)}>{currentBranch.upstream || 'No upstream'}</button>
              {(currentBranch.ahead > 0 || currentBranch.behind > 0) && <div className="muted ahead-behind text-xs"><ArrowUp size={12} strokeWidth={2} />{currentBranch.ahead}<ArrowDown size={12} strokeWidth={2} />{currentBranch.behind}</div>}
              {!currentBranch.upstream && <Button className="branch-publish" disabled={blocked || !currentBranch.sha} onClick={() => void runSync('push')}>Publish branch</Button>}
            </>}
          </div>
          <div className="panel-disclosure-row">
            <button type="button" className="panel-title panel-disclosure" onClick={toggleBranches}><span>Branches</span><span className="muted">{branchesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span></button>
            <IconButton label="New branch" onClick={() => openDialog('createBranch')}><Plus size={16} /></IconButton>
          </div>
          {branchesExpanded && <ul className="branch-list" aria-label="Branches" onKeyDown={branchRows.onKeyDown}>
            {branches.map((branch, index) => (
              <li key={branch.name} {...branchRows.rowProps(index)} {...menuHandlers('local', branch.name)} className={branch.current ? 'active' : ''} onDoubleClick={() => { if (!blocked) void checkoutBranch(branch.name) }} title="Double-click or press Enter to check out">
                <div className="branch-row-main">
                  <div className="cell-ellipsis">{branch.name}</div>
                  {(branch.ahead > 0 || branch.behind > 0) && <div className="muted ahead-behind text-xs"><ArrowUp size={12} strokeWidth={2} />{branch.ahead}<ArrowDown size={12} strokeWidth={2} />{branch.behind}</div>}
                </div>
                <div className="branch-row-actions" {...stopRowEvents}>{historyButtons(branch.name, branch.sha)}{menuButton('local', branch.name)}</div>
              </li>
            ))}
          </ul>}
          <div className="panel-disclosure-row">
            <button type="button" className="panel-title panel-disclosure" onClick={toggleRemoteBranches}><span>Remote branches</span><span className="muted">{remoteBranchesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span></button>
            <IconButton label={fetching ? 'Fetching remote branches' : 'Fetch remote branches'} disabled={blocked || !activeRepo.remotes.length} onClick={() => void runSync('fetch')}><RefreshCw size={14} strokeWidth={1.75} className={fetching ? 'spin' : undefined} /></IconButton>
            <IconButton label="Remote actions" disabled={blocked} aria-haspopup="menu" aria-expanded={menu?.kind === 'remotes'} onClick={(e) => setMenu({ kind: 'remotes', name: '', ...menuPointFor(e.currentTarget) })}><Ellipsis size={16} strokeWidth={1.75} /></IconButton>
          </div>
          {remoteBranchesExpanded && <ul className="branch-list" aria-label="Remote branches" onKeyDown={remoteRows.onKeyDown}>
            {remoteBranches.map((branch, index) => (
              <li key={branch.name} {...remoteRows.rowProps(index)} {...menuHandlers('remote', branch.name)} onDoubleClick={() => { if (!blocked) void checkoutRemote(branch.name) }} title={localBranchNames.has(branch.shortName) ? `Double-click or press Enter to check out local "${branch.shortName}"` : 'Double-click or press Enter to create a local tracking branch and check it out'}>
                <div className="branch-row-main"><div className="cell-ellipsis">{branch.name}</div>{localBranchNames.has(branch.shortName) && <div className="muted text-xs">local</div>}</div>
                <div className="branch-row-actions" {...stopRowEvents}>{historyButtons(branch.name, branch.sha)}{menuButton('remote', branch.name)}</div>
              </li>
            ))}
            {remoteBranches.length === 0 && <li className="muted text-xs" style={{ pointerEvents: 'none' }}>{activeRepo.remotes.length ? 'No remote branches — fetch to refresh' : 'No remotes configured'}</li>}
          </ul>}
        </>
      )}
    </aside>
  )
}
