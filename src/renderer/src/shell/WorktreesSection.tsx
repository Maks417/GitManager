import { useEffect, useState } from 'react'
import type React from 'react'
import { ChevronDown, ChevronRight, Ellipsis, Lock, Plus } from 'lucide-react'
import type { WorktreeItem } from '@shared/ipc'
import { WORKTREE_HAS_CHANGES } from '@shared/git-messages'
import { ContextMenu, IconButton, isMenuKey, menuPointFor, type MenuItem } from '../components/ui'
import { useRovingList } from '../hooks/useRovingList'
import { confirmForceRemoveWorktree, confirmRemoveWorktree } from '../lib/copy'
import { toErrorMessage } from '../lib/errors'
import { sameRepoPath } from '../lib/paths'
import { runWithBusy } from '../lib/useAsyncAction'
import { folderName } from '../logic/worktree-paths'
import { useAppStatus, useAppStatusActions } from '../state/AppStatusProvider'
import { useConfirm } from '../state/ConfirmProvider'
import { useDialogActions } from '../state/DialogsProvider'
import { useGitActions, useRemoteOp } from '../state/GitActionsProvider'
import { useLayoutPrefsState } from '../state/LayoutProvider'
import { useActiveRepo, useSession, useSessionActions } from '../state/RepoSessionProvider'

type WorktreeMenu = { path: string | null; x: number; y: number }

const describe = (item: WorktreeItem): string =>
  item.branch ?? (item.bare ? 'bare' : item.head ? `detached at ${item.head.slice(0, 7)}` : 'detached')

/**
 * The work trees of the active repository: open one, lock or unlock it, remove it, or add another. The list
 * loads while the section is open, and again whenever the branches change (a checkout here or in a sibling).
 */
export function WorktreesSection(): React.JSX.Element {
  const { busy } = useAppStatus()
  const { setBusy, setError } = useAppStatusActions()
  const repoPath = useActiveRepo().path
  const { repos, branches } = useSession()
  const { refreshRepos, afterGitMutation } = useSessionActions()
  const { worktreesExpanded: expanded, toggleWorktrees } = useLayoutPrefsState()
  const { openWorktree } = useGitActions()
  const { openWorktreeDialog } = useDialogActions()
  const confirm = useConfirm()
  const remoteOp = useRemoteOp()
  const blocked = busy || Boolean(remoteOp)
  const [loaded, setLoaded] = useState<{ repoPath: string; items: WorktreeItem[] } | null>(null)
  const [reloads, setReloads] = useState(0)
  const [menu, setMenu] = useState<WorktreeMenu | null>(null)

  useEffect(() => {
    if (!expanded) return
    let live = true
    window.gitManager.git.worktreeList(repoPath).then(
      (items) => {
        if (live) setLoaded({ repoPath, items })
      },
      () => {
        if (live) setLoaded({ repoPath, items: [] })
      }
    )
    return () => {
      live = false
    }
    // `branches` changes identity whenever refs or worktree checkouts move.
  }, [expanded, repoPath, branches, reloads])

  const items = loaded && sameRepoPath(loaded.repoPath, repoPath) ? loaded.items : []
  const rows = useRovingList(items.length, items.findIndex((item) => item.isCurrent), (index) => {
    const item = items[index]
    if (item && !item.isCurrent && !item.prunable && !blocked) void openWorktree(item.path)
  }, repoPath)

  /** A worktree change: reloads this list and the branches whose worktree marks it moved. */
  const act = (fn: () => Promise<void>): Promise<void> =>
    runWithBusy(
      async () => {
        try {
          await fn()
        } finally {
          setReloads((n) => n + 1)
        }
        await afterGitMutation()
      },
      { setBusy, setError }
    )

  const remove = async (item: WorktreeItem): Promise<void> => {
    if (!(await confirm(confirmRemoveWorktree(item.path, item.branch)))) return
    await act(async () => {
      try {
        await window.gitManager.git.worktreeRemove(repoPath, item.path)
      } catch (err) {
        if (!toErrorMessage(err).startsWith(WORKTREE_HAS_CHANGES)) throw err
        if (!(await confirm(confirmForceRemoveWorktree(item.path)))) return
        await window.gitManager.git.worktreeRemove(repoPath, item.path, true)
      }
      // A worktree that was also in the repository list leaves it with its folder.
      const listed = repos.find((repo) => sameRepoPath(repo.path, item.path))
      if (listed) {
        await window.gitManager.repo.remove(listed.id, {})
        await refreshRepos({ activateFirst: false })
      }
    })
  }

  const target = menu?.path ? items.find((item) => item.path === menu.path) : undefined
  const menuItems: MenuItem[] = target
    ? [
        { label: 'Open', disabled: blocked || target.isCurrent || target.prunable, onSelect: () => void openWorktree(target.path) },
        {
          label: 'Open folder',
          disabled: target.prunable,
          onSelect: () => void window.gitManager.shell.openWorktreeFolder(repoPath, target.path).catch((err: unknown) => setError(toErrorMessage(err)))
        },
        ...(target.isMain
          ? []
          : [
              {
                label: target.locked ? 'Unlock' : 'Lock',
                separatorBefore: true,
                disabled: blocked,
                onSelect: () =>
                  void act(() =>
                    target.locked
                      ? window.gitManager.git.worktreeUnlock(repoPath, target.path)
                      : window.gitManager.git.worktreeLock(repoPath, target.path)
                  )
              },
              {
                label: 'Remove worktree…',
                danger: true,
                disabled: blocked || target.isCurrent || target.locked,
                onSelect: () => void remove(target)
              }
            ])
      ]
    : menu
      ? [
          { label: 'New worktree…', disabled: blocked, onSelect: () => openWorktreeDialog({ repoPath, source: { kind: 'new' } }) },
          {
            label: 'Prune missing worktrees',
            disabled: blocked || !items.some((item) => item.prunable),
            onSelect: () => void act(async () => void (await window.gitManager.git.worktreePrune(repoPath)))
          }
        ]
      : []

  return (
    <>
      {menu && menuItems.length > 0 && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} ariaLabel={target ? `Actions for ${folderName(target.path)}` : 'Worktree actions'} onClose={() => setMenu(null)} />
      )}
      <div className="panel-disclosure-row">
        <button type="button" className="panel-title panel-disclosure" onClick={toggleWorktrees}>
          <span>Worktrees{expanded && items.length > 1 ? <span className="branch-filter-count">{items.length}</span> : null}</span>
          <span className="muted">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        </button>
        <IconButton label="New worktree" disabled={blocked} onClick={() => openWorktreeDialog({ repoPath, source: { kind: 'new' } })}>
          <Plus size={16} />
        </IconButton>
        <IconButton label="Worktree actions" disabled={blocked} aria-haspopup="menu" aria-expanded={Boolean(menu && !menu.path)} onClick={(e) => setMenu({ path: null, ...menuPointFor(e.currentTarget) })}>
          <Ellipsis size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      {expanded && (
        <ul key={repoPath} className="branch-list worktree-list" aria-label="Worktrees" onKeyDown={rows.onKeyDown}>
          {items.map((item, index) => (
            <li
              key={item.path}
              {...rows.rowProps(index)}
              className={item.isCurrent ? 'active' : ''}
              title={item.isCurrent ? `${item.path} (open)` : item.prunable ? `${item.path} (folder missing)` : `${item.path}\nDouble-click or press Enter to open`}
              onDoubleClick={() => {
                if (!item.isCurrent && !item.prunable && !blocked) void openWorktree(item.path)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                if (blocked) return
                e.currentTarget.focus()
                setMenu({ path: item.path, x: e.clientX, y: e.clientY })
              }}
              onKeyDown={(e) => {
                if (!isMenuKey(e)) return
                e.preventDefault()
                e.stopPropagation()
                if (!blocked) setMenu({ path: item.path, ...menuPointFor(e.currentTarget) })
              }}
            >
              <div className="branch-row-main">
                <div className="cell-ellipsis">{folderName(item.path)}</div>
                {item.isMain && <div className="muted text-xs" title="The repository's main work tree, which the others share history with">main worktree</div>}
                {item.locked && <span className="muted" title={item.lockReason ? `Locked: ${item.lockReason}` : 'Locked'}><Lock size={12} strokeWidth={2} aria-label="Locked" /></span>}
                {item.prunable && <div className="muted text-xs worktree-missing">missing</div>}
              </div>
              <div className="muted text-xs cell-ellipsis">{describe(item)}</div>
            </li>
          ))}
          {loaded && items.length <= 1 && (
            <li className="muted text-xs branch-list-note">No other worktrees. Use + to check out a branch in a folder of its own.</li>
          )}
        </ul>
      )}
    </>
  )
}
