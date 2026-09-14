import { useEffect, useRef } from 'react'
import { MenuChannels } from '@shared/ipc'
import { useDialogActions } from '../state/DialogsProvider'
import { useGitActions } from '../state/GitActionsProvider'
import { useHistoryActions } from '../state/HistoryProvider'
import { useLayout } from '../state/LayoutProvider'
import { useWorkingTreeActions } from '../state/WorkingTreeProvider'

/** Runs the commands the application menu (File, View, Repository, Help) sends from the main process. */
export function useMenuCommands(): void {
  const { openDialog } = useDialogActions()
  const { addRepo, openClone, runSync } = useGitActions()
  const { searchInputRef } = useHistoryActions()
  const { goHistory, selectWorkingCopy } = useWorkingTreeActions()
  const { toggleDock, toggleSidebar } = useLayout()

  // Handlers close over fresh state every render; subscribe to the menu once and call the latest.
  const handlersRef = useRef<Record<string, () => void>>({})
  handlersRef.current = {
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
    [MenuChannels.toggleSidebar]: toggleSidebar
  }

  useEffect(() => {
    if (!window.gitManagerMenu) return
    const offs = Object.keys(handlersRef.current).map((channel) =>
      window.gitManagerMenu.on(channel, () => handlersRef.current[channel]?.())
    )
    return () => offs.forEach((off) => off())
  }, [])
}
