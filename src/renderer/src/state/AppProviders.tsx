import type React from 'react'
import { AppStatusProvider } from './AppStatusProvider'
import { ConfirmProvider } from './ConfirmProvider'
import { DialogsProvider } from './DialogsProvider'
import { GitActionsProvider } from './GitActionsProvider'
import { HistoryProvider } from './HistoryProvider'
import { LayoutProvider } from './LayoutProvider'
import { RepoSessionProvider } from './RepoSessionProvider'
import { SelectionProvider } from './SelectionProvider'
import { WorkingTreeProvider } from './WorkingTreeProvider'

/** Each provider may read the ones above it; the order matters. */
export function AppProviders({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <AppStatusProvider>
      <LayoutProvider>
        <DialogsProvider>
          <ConfirmProvider>
            <SelectionProvider>
              <RepoSessionProvider>
                <HistoryProvider>
                  <WorkingTreeProvider>
                    <GitActionsProvider>{children}</GitActionsProvider>
                  </WorkingTreeProvider>
                </HistoryProvider>
              </RepoSessionProvider>
            </SelectionProvider>
          </ConfirmProvider>
        </DialogsProvider>
      </LayoutProvider>
    </AppStatusProvider>
  )
}
