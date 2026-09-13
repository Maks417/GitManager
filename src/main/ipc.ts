import { registerAppHandlers } from './ipc/app-handlers'
import { registerGitHandlers } from './ipc/git-handlers'
import { registerHistoryHandlers } from './ipc/history-handlers'
import { registerMergeHandlers } from './ipc/merge-handlers'
import { registerPrefsHandlers } from './ipc/prefs-handlers'
import { registerProvidersHandlers } from './ipc/providers-handlers'
import { registerRepoHandlers } from './ipc/repo-handlers'

export function registerIpcHandlers(): void {
  registerRepoHandlers()
  registerHistoryHandlers()
  registerGitHandlers()
  registerMergeHandlers()
  registerProvidersHandlers()
  registerPrefsHandlers()
  registerAppHandlers()
}
