import { useEffect, useEffectEvent } from 'react'
import { MenuChannels, type MenuChannel } from '@shared/ipc'
import { useDialogActions } from '../state/DialogsProvider'
import { useGitActions } from '../state/GitActionsProvider'
import { useHistoryActions } from '../state/HistoryProvider'
import { useLayout } from '../state/LayoutProvider'
import { useWorkingTreeActions } from '../state/WorkingTreeProvider'

/** Runs the commands the application menu (File, View, Repository, Help) sends from the main process. */
export function useMenuCommands(): void {
  const { openDialog } = useDialogActions()
  const { addRepo, openClone, openNewRepo, runSync } = useGitActions()
  const { searchInputRef } = useHistoryActions()
  const { goHistory, selectWorkingCopy } = useWorkingTreeActions()
  const { toggleDiffView, toggleDock, toggleSidebar, setSyntaxHighlighting, syntaxHighlighting } = useLayout()

  // The menu is subscribed once; each command runs with the state of the latest render.
  const runCommand = useEffectEvent((channel: MenuChannel): void => {
    const commands: Record<MenuChannel, () => void> = {
      [MenuChannels.newRepo]: openNewRepo,
      [MenuChannels.addRepo]: () => void addRepo(),
      [MenuChannels.cloneRepo]: openClone,
      [MenuChannels.accounts]: () => openDialog('accounts'),
      [MenuChannels.identity]: () => openDialog('identity'),
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
      [MenuChannels.toggleSidebar]: toggleSidebar
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
