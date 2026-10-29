import { useEffect, useEffectEvent } from 'react'
import { MenuChannels, type MenuChannel } from '@shared/ipc'
import { focusBranchFilter } from '../shell/BranchFilterBox'
import { useDialogActions } from '../state/DialogsProvider'
import { useGitActions } from '../state/GitActionsProvider'
import { useHistoryActions } from '../state/HistoryProvider'
import { useSession } from '../state/RepoSessionProvider'
import { useLayoutPrefsState } from '../state/LayoutProvider'
import { useWorkingTreeActions } from '../state/WorkingTreeProvider'

/** Runs the commands the application menu (File, View, Repository, Help) sends from the main process. */
export function useMenuCommands(): void {
  const { openDialog, openWorktreeDialog } = useDialogActions()
  const { activeRepo } = useSession()
  const { addRepo, openClone, openNewRepo, runSync } = useGitActions()
  const { searchInputRef } = useHistoryActions()
  const { goHistory, selectWorkingCopy } = useWorkingTreeActions()
  const { toggleDiffView, toggleDock, toggleSidebar, sidebarCollapsed, setSyntaxHighlighting, syntaxHighlighting } =
    useLayoutPrefsState()

  // The menu is subscribed once; each command runs with the state of the latest render.
  const runCommand = useEffectEvent((channel: MenuChannel): void => {
    const commands: Record<MenuChannel, () => void> = {
      [MenuChannels.newRepo]: openNewRepo,
      [MenuChannels.addRepo]: () => void addRepo(),
      [MenuChannels.cloneRepo]: openClone,
      [MenuChannels.accounts]: () => openDialog('accounts'),
      [MenuChannels.identity]: () => openDialog('identity'),
      [MenuChannels.remotes]: () => openDialog('remotes'),
      [MenuChannels.compare]: () => openDialog('compare'),
      [MenuChannels.recovery]: () => openDialog('recovery'),
      [MenuChannels.createBranch]: () => openDialog('createBranch'),
      [MenuChannels.merge]: () => openDialog('mergePick'),
      [MenuChannels.rebase]: () => openDialog('rebasePick'),
      [MenuChannels.focusSearch]: () => searchInputRef.current?.focus(),
      [MenuChannels.fetch]: () => void runSync('fetch'),
      [MenuChannels.pull]: () => void runSync('pull'),
      [MenuChannels.push]: () => void runSync('push'),
      [MenuChannels.updates]: () => openDialog('updates'),
      [MenuChannels.about]: () => openDialog('about'),
      [MenuChannels.viewHistory]: goHistory,
      [MenuChannels.viewChanges]: selectWorkingCopy,
      [MenuChannels.toggleDock]: toggleDock,
      [MenuChannels.toggleDiffView]: toggleDiffView,
      [MenuChannels.toggleSyntaxHighlighting]: () => setSyntaxHighlighting(!syntaxHighlighting),
      [MenuChannels.toggleSidebar]: toggleSidebar,
      [MenuChannels.findBranch]: () => {
        // A collapsed sidebar has no filter box: it takes focus once the sidebar shows it.
        if (sidebarCollapsed) toggleSidebar()
        focusBranchFilter()
      },
      [MenuChannels.newWorktree]: () => {
        if (activeRepo) openWorktreeDialog({ repoPath: activeRepo.path, source: { kind: 'new' } })
      }
    }
    commands[channel]()
  })

  useEffect(() => {
    if (!window.gitManagerMenu) return
    const offs = Object.values(MenuChannels).map((channel) =>
      window.gitManagerMenu.on(channel, () => runCommand(channel))
    )
    return () => offs.forEach((off) => off())
  }, [])
}
