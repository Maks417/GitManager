import type React from 'react'
import { useMenuCommands } from './hooks/useMenuCommands'
import { usePaneCycling } from './hooks/usePaneCycling'
import { AppDialogs } from './shell/AppDialogs'
import { AppToolbar } from './shell/AppToolbar'
import { WelcomeScreen } from './shell/WelcomeScreen'
import { WorkspaceShell } from './shell/WorkspaceShell'
import { AppProviders } from './state/AppProviders'
import { useSession } from './state/RepoSessionProvider'

export function App(): React.JSX.Element {
  return (
    <AppProviders>
      <GlobalCommands />
      <div className="app-shell">
        <AppToolbar />
        <MainView />
        <AppDialogs />
      </div>
    </AppProviders>
  )
}

/** Subscribes to application-menu commands and app-wide keys (F6); renders nothing. */
function GlobalCommands(): null {
  useMenuCommands()
  usePaneCycling()
  return null
}

function MainView(): React.JSX.Element {
  const { activeRepo } = useSession()
  return activeRepo ? <WorkspaceShell /> : <WelcomeScreen />
}
