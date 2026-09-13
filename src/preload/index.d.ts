import type { GitManagerApi } from '@shared/ipc'

declare global {
  interface Window {
    gitManager: GitManagerApi
    gitManagerMenu: {
      on: (event: string, cb: () => void) => () => void
    }
  }
}

export {}
