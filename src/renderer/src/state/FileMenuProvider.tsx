import { createContext, useCallback, useMemo, useState } from 'react'
import type React from 'react'
import { ContextMenu, type MenuItem } from '../components/ui'
import { BlameModal } from '../features/blame/BlameModal'
import { FileHistoryModal } from '../features/file-history/FileHistoryModal'
import { useRequiredContext } from './context'
import { useHistoryActions } from './HistoryProvider'
import { useSession } from './RepoSessionProvider'

/** A file a menu was opened on. */
export interface FileTarget {
  path: string
  /** The commit the file is listed in (commit pane): offers blame at that commit. */
  sha?: string
  /** That commit deleted the file, so there is nothing to blame there. */
  deletedInCommit?: boolean
  /** The file exists in the work tree: offers blame of it and Show in folder. */
  inWorkTree: boolean
  /** Not committed yet: no history and no blame. */
  untracked?: boolean
}

export interface FileMenu {
  openFileMenu: (target: FileTarget, point: { x: number; y: number }) => void
}

type FileDialog = { kind: 'history'; path: string } | { kind: 'blame'; path: string; rev: string | null } | null

const FileMenuContext = createContext<FileMenu | null>(null)

const IS_MAC = /Mac/.test(navigator.userAgent)

/** File history, blame, copy path and Show in folder, for the file lists of the commit and Changes panes. */
export function FileMenuProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { activeRepo } = useSession()
  const { revealCommit } = useHistoryActions()
  const [menu, setMenu] = useState<{ target: FileTarget; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<FileDialog>(null)

  const openFileMenu = useCallback((target: FileTarget, point: { x: number; y: number }): void => {
    setMenu({ target, ...point })
  }, [])
  const closeMenu = useCallback(() => setMenu(null), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  const showInHistory = (sha: string): void => {
    setDialog(null)
    void revealCommit(sha)
  }

  const itemsFor = (target: FileTarget): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: 'File history',
        disabled: target.untracked,
        onSelect: () => setDialog({ kind: 'history', path: target.path })
      },
      {
        label: 'Blame',
        disabled: target.untracked || !target.inWorkTree,
        onSelect: () => setDialog({ kind: 'blame', path: target.path, rev: null })
      }
    ]
    if (target.sha) {
      const sha = target.sha
      items.push({
        label: 'Blame at this commit',
        disabled: target.deletedInCommit,
        onSelect: () => setDialog({ kind: 'blame', path: target.path, rev: sha })
      })
    }
    items.push(
      {
        label: 'Copy path',
        separatorBefore: true,
        onSelect: () => void navigator.clipboard.writeText(target.path)
      },
      {
        label: IS_MAC ? 'Reveal in Finder' : 'Show in folder',
        disabled: !target.inWorkTree || !activeRepo,
        onSelect: () => {
          if (activeRepo) void window.gitManager.shell.showInFolder(activeRepo.path, target.path)
        }
      }
    )
    return items
  }

  const value = useMemo<FileMenu>(() => ({ openFileMenu }), [openFileMenu])

  return (
    <FileMenuContext.Provider value={value}>
      {children}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={`Actions for ${menu.target.path}`}
          items={itemsFor(menu.target)}
          onClose={closeMenu}
        />
      )}
      {dialog?.kind === 'history' && activeRepo && (
        <FileHistoryModal
          repoPath={activeRepo.path}
          path={dialog.path}
          onClose={closeDialog}
          onShowInHistory={showInHistory}
          onBlame={(path, sha) => setDialog({ kind: 'blame', path, rev: sha })}
        />
      )}
      {dialog?.kind === 'blame' && activeRepo && (
        <BlameModal
          key={`${dialog.path}@${dialog.rev ?? ''}`}
          repoPath={activeRepo.path}
          path={dialog.path}
          rev={dialog.rev}
          onClose={closeDialog}
          onShowInHistory={showInHistory}
          onFileHistory={(path) => setDialog({ kind: 'history', path })}
        />
      )}
    </FileMenuContext.Provider>
  )
}

export const useFileMenu = (): FileMenu => useRequiredContext(FileMenuContext, 'useFileMenu')
