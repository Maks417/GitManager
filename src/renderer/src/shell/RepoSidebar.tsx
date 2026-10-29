import { memo, useMemo, useState } from 'react'
import type React from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Ellipsis, FolderGit2, ListFilter, Locate, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { confirmDeleteBranch, confirmMerge, confirmRebase } from '../lib/copy'
import { loadBranchFolders, saveBranchFolders } from '../logic/branch-folders'
import { buildBranchRows, filterBranchNames, folderChain, type BranchLeafRow, type BranchRow } from '../logic/branch-tree'
import { orderRepos } from '../logic/worktree-paths'
import { Button, ContextMenu, IconButton, isMenuKey, menuPointFor, type MenuItem } from '../components/ui'
import { useRovingList } from '../hooks/useRovingList'
import { useAppStatus } from '../state/AppStatusProvider'
import { useConfirm } from '../state/ConfirmProvider'
import { useDialogActions } from '../state/DialogsProvider'
import { useGitActions, useRemoteOp } from '../state/GitActionsProvider'
import { useHistoryActions } from '../state/HistoryProvider'
import { useLayoutPrefsState } from '../state/LayoutProvider'
import { useActiveRepo, useSession } from '../state/RepoSessionProvider'
import { BranchFilterBox } from './BranchFilterBox'
import { BranchLabel, BranchTreeList, type BranchRowView } from './BranchTreeList'
import { WorktreesSection } from './WorktreesSection'

const stopRowEvents = {
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('button')) e.stopPropagation()
  }
}

type SidebarMenu = { kind: 'local' | 'remote' | 'remotes'; name: string; x: number; y: number }

interface BranchListView {
  rows: BranchRow[]
  /** Matching branches (all of them without a filter), rendered or not. */
  total: number
}

/** A filter's results as a flat list, or else the branches in folders. */
function branchListView(
  names: readonly string[],
  filter: string,
  isOpen: (key: string) => boolean,
  remoteOf?: (name: string) => string | null
): BranchListView {
  if (filter.trim()) return filterBranchNames(filter, names, remoteOf)
  return { rows: buildBranchRows(names, isOpen), total: names.length }
}

export const RepoSidebar = memo(function RepoSidebar(): React.JSX.Element {
  const { busy } = useAppStatus()
  const activeRepo = useActiveRepo()
  const { repos, branches, remoteBranches, currentBranch, localBranchNames } = useSession()
  const { sidebarCollapsed, branchesExpanded, remoteBranchesExpanded, toggleSidebar, toggleBranches, toggleRemoteBranches } = useLayoutPrefsState()
  const { openDialog, openBranchDialog, openWorktreeDialog } = useDialogActions()
  const confirm = useConfirm()
  const { selectRepo, requestRemoveRepo, checkoutBranch, runMergeOrRebase, deleteBranch, checkoutRemote, runSync, openWorktree } = useGitActions()
  const remoteOp = useRemoteOp()
  const blocked = busy || Boolean(remoteOp)
  const fetching = remoteOp?.kind === 'fetch'
  const { showBranchHistory, revealCommit } = useHistoryActions()
  const [menu, setMenu] = useState<SidebarMenu | null>(null)
  // Branch filter text per repository, for this session.
  const [filters, setFilters] = useState<Readonly<Record<string, string>>>({})
  const [folders, setFolders] = useState(() => loadBranchFolders(activeRepo.path))
  // The sidebar stays mounted across repositories (keeping its scroll and the focused repository row); what
  // belonged to the previous repository's branches is dropped here.
  const [shownRepo, setShownRepo] = useState(activeRepo.path)
  if (shownRepo !== activeRepo.path) {
    setShownRepo(activeRepo.path)
    setMenu(null)
    setFolders(loadBranchFolders(activeRepo.path))
  }
  const filter = filters[activeRepo.path] ?? ''
  const filtering = filter.trim() !== ''

  // Linked worktrees sit under their main repository.
  const repoList = useMemo(() => orderRepos(repos), [repos])
  const repoRows = useRovingList(repoList.length, repoList.findIndex((row) => row.repo.id === activeRepo.id), (index) => {
    const row = repoList[index]
    if (row) selectRepo(row.repo)
  })

  const localByName = useMemo(() => new Map(branches.map((branch) => [branch.name, branch])), [branches])
  const remoteByName = useMemo(() => new Map(remoteBranches.map((branch) => [branch.name, branch])), [remoteBranches])
  const currentName = currentBranch?.name ?? null
  const upstreamName = currentBranch?.upstream ?? null
  // Folders start closed, except those holding the current branch and its upstream, and each remote.
  const localView = useMemo(
    () => branchListView([...localByName.keys()], filter, (key) =>
      folders[`local:${key}`] ?? (currentName !== null && folderChain(currentName).includes(key))
    ),
    [localByName, filter, folders, currentName]
  )
  const remoteView = useMemo(
    () => branchListView(
      [...remoteByName.keys()],
      filter,
      (key) => folders[`remote:${key}`] ?? (!key.includes('/') || (upstreamName !== null && folderChain(upstreamName).includes(key))),
      (name) => remoteByName.get(name)?.remote ?? null
    ),
    [remoteByName, filter, folders, upstreamName]
  )
  const toggleFolder = (section: 'local' | 'remote') => (key: string, open: boolean): void => {
    const next = { ...folders, [`${section}:${key}`]: open }
    saveBranchFolders(activeRepo.path, next)
    setFolders(next)
  }
  const filterNote = (view: BranchListView): React.ReactNode =>
    view.total === 0 ? (
      <li className="muted text-xs branch-list-note">No matching branches</li>
    ) : view.total > view.rows.length ? (
      <li className="muted text-xs branch-list-note">{view.total - view.rows.length} more — refine the filter</li>
    ) : null
  const filterCount = (view: BranchListView, all: number): React.ReactNode =>
    filtering ? <span className="branch-filter-count" title={`${view.total} of ${all} match the filter`}>{view.total}/{all}</span> : null

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

  const showLocal = filtering || branchesExpanded
  const showRemote = filtering || remoteBranchesExpanded
  const renderLocal = (row: BranchLeafRow): BranchRowView => {
    const branch = localByName.get(row.name)
    return {
      props: {
        ...menuHandlers('local', row.name),
        className: branch?.current ? 'active' : '',
        title: branch?.worktreePath
          ? `Checked out in the worktree at ${branch.worktreePath}. Double-click or press Enter to open it`
          : 'Double-click or press Enter to check out',
        onDoubleClick: () => { if (!blocked) void checkoutBranch(row.name) }
      },
      content: <>
        <div className="branch-row-main">
          <div className="branch-name-line">
            <BranchLabel row={row} />
            {branch?.worktreePath && <span className="muted branch-worktree-mark" title={`Checked out in the worktree at ${branch.worktreePath}`}><FolderGit2 size={13} strokeWidth={1.75} aria-label="In another worktree" /></span>}
          </div>
          {branch && (branch.ahead > 0 || branch.behind > 0) && <div className="muted ahead-behind text-xs"><ArrowUp size={12} strokeWidth={2} />{branch.ahead}<ArrowDown size={12} strokeWidth={2} />{branch.behind}</div>}
        </div>
        <div className="branch-row-actions" {...stopRowEvents}>{historyButtons(row.name, branch?.sha ?? null)}{menuButton('local', row.name)}</div>
      </>
    }
  }
  const renderRemote = (row: BranchLeafRow): BranchRowView => {
    const branch = remoteByName.get(row.name)
    const hasLocal = Boolean(branch && localBranchNames.has(branch.shortName))
    return {
      props: {
        ...menuHandlers('remote', row.name),
        title: hasLocal
          ? `Double-click or press Enter to check out local "${branch?.shortName}"`
          : 'Double-click or press Enter to create a local tracking branch and check it out',
        onDoubleClick: () => { if (!blocked) void checkoutRemote(row.name) }
      },
      content: <>
        <div className="branch-row-main"><BranchLabel row={row} />{hasLocal && <div className="muted text-xs">local</div>}</div>
        <div className="branch-row-actions" {...stopRowEvents}>{historyButtons(row.name, branch?.sha ?? null)}{menuButton('remote', row.name)}</div>
      </>
    }
  }

  const local = menu?.kind === 'local' ? branches.find((branch) => branch.name === menu.name) : undefined
  const remote = menu?.kind === 'remote' ? remoteBranches.find((branch) => branch.name === menu.name) : undefined
  const worktreeItem = (source: { kind: 'branch' | 'remote'; name: string }): MenuItem => ({
    label: 'Check out in new worktree…',
    disabled: blocked,
    onSelect: () => openWorktreeDialog({ repoPath: activeRepo.path, source })
  })
  const heldAt = local?.worktreePath ?? null
  const menuItems: MenuItem[] = local ? [
    heldAt
      ? { label: 'Open its worktree', disabled: blocked, onSelect: () => void openWorktree(heldAt) }
      : { label: 'Check out', disabled: blocked || local.current, onSelect: () => void checkoutBranch(local.name) },
    ...(local.current || heldAt ? [] : [worktreeItem({ kind: 'branch', name: local.name })]),
    { label: 'Merge into current branch', disabled: blocked || local.current, onSelect: () => {
      void confirm(confirmMerge(local.name)).then((ok) => { if (ok) void runMergeOrRebase('merge', local.name) })
    } },
    { label: 'Rebase current branch onto this', disabled: blocked || local.current, onSelect: () => {
      void confirm(confirmRebase(local.name)).then((ok) => { if (ok) void runMergeOrRebase('rebase', local.name) })
    } },
    { label: 'Tracking', separatorBefore: true, disabled: blocked, onSelect: () => tracking(local.name) },
    ...(local.current ? [{ label: local.upstream ? 'Push to' : 'Publish branch', disabled: blocked || !local.sha, onSelect: () => pushTo(local.name) }] : []),
    { label: 'Delete branch', separatorBefore: true, danger: true, disabled: blocked || local.current || Boolean(heldAt), onSelect: () => {
      void confirm(confirmDeleteBranch(local.name)).then((ok) => { if (ok) void deleteBranch(local.name) })
    } }
  ] : remote ? [
    { label: localBranchNames.has(remote.shortName) ? 'Check out local branch' : 'Check out and track', disabled: blocked, onSelect: () => void checkoutRemote(remote.name) },
    worktreeItem({ kind: 'remote', name: remote.name })
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
        {repoList.map(({ repo, depth }, index) => (
          <li key={repo.id} {...repoRows.rowProps(index)} className={[repo.id === activeRepo.id ? 'active' : '', depth ? 'repo-worktree' : ''].filter(Boolean).join(' ')} onClick={() => selectRepo(repo)} title={sidebarCollapsed ? `${repo.name}${repo.currentBranch ? ` (${repo.currentBranch})` : ''}` : repo.worktreeOf ? `${repo.path}\nWorktree of ${repo.worktreeOf}` : repo.path}>
            {!sidebarCollapsed && repo.worktreeOf && <FolderGit2 className="muted repo-worktree-icon" size={14} strokeWidth={1.75} aria-label="Worktree" />}
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
          <BranchFilterBox value={filter} onChange={(value) => setFilters((all) => ({ ...all, [activeRepo.path]: value }))} />
          <div className="panel-disclosure-row">
            <button type="button" className="panel-title panel-disclosure" disabled={filtering} title={filtering ? 'Clear the filter to collapse' : undefined} onClick={toggleBranches}><span>Branches{filterCount(localView, branches.length)}</span><span className="muted">{showLocal ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span></button>
            <IconButton label="New branch" onClick={() => openDialog('createBranch')}><Plus size={16} /></IconButton>
          </div>
          {showLocal && <BranchTreeList
            // Keyed by repository: another repository's branch list opens at its top.
            key={activeRepo.path}
            label="Branches"
            listKey={activeRepo.path}
            rows={localView.rows}
            preferredIndex={localView.rows.findIndex((row) => row.kind === 'branch' && row.name === currentName)}
            onToggleFolder={toggleFolder('local')}
            onActivateBranch={(name) => { if (!blocked) void checkoutBranch(name) }}
            renderBranch={renderLocal}
            footer={filtering && filterNote(localView)}
          />}
          <div className="panel-disclosure-row">
            <button type="button" className="panel-title panel-disclosure" disabled={filtering} title={filtering ? 'Clear the filter to collapse' : undefined} onClick={toggleRemoteBranches}><span>Remote branches{filterCount(remoteView, remoteBranches.length)}</span><span className="muted">{showRemote ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span></button>
            <IconButton label={fetching ? 'Fetching remote branches' : 'Fetch remote branches'} disabled={blocked || !activeRepo.remotes.length} onClick={() => void runSync('fetch')}><RefreshCw size={14} strokeWidth={1.75} className={fetching ? 'spin' : undefined} /></IconButton>
            <IconButton label="Remote actions" disabled={blocked} aria-haspopup="menu" aria-expanded={menu?.kind === 'remotes'} onClick={(e) => setMenu({ kind: 'remotes', name: '', ...menuPointFor(e.currentTarget) })}><Ellipsis size={16} strokeWidth={1.75} /></IconButton>
          </div>
          {showRemote && <BranchTreeList
            key={activeRepo.path}
            label="Remote branches"
            listKey={activeRepo.path}
            rows={remoteView.rows}
            preferredIndex={0}
            onToggleFolder={toggleFolder('remote')}
            onActivateBranch={(name) => { if (!blocked) void checkoutRemote(name) }}
            renderBranch={renderRemote}
            footer={filtering ? filterNote(remoteView) : remoteBranches.length === 0 && <li className="muted text-xs branch-list-note">{activeRepo.remotes.length ? 'No remote branches — fetch to refresh' : 'No remotes configured'}</li>}
          />}
          <WorktreesSection />
        </>
      )}
    </aside>
  )
})
