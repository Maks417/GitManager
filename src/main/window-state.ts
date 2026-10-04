import { z } from 'zod'

export const WindowStateSchema = z.object({
  maximized: z.boolean().default(false).catch(false),
  fullScreen: z.boolean().default(false).catch(false)
})
export type WindowState = z.infer<typeof WindowStateSchema>

interface AppWindow {
  on(event: 'maximize' | 'unmaximize' | 'enter-full-screen' | 'leave-full-screen' | 'close', listener: () => void): unknown
  maximize(): void
  setFullScreen(value: boolean): void
  isMaximized(): boolean
  isFullScreen(): boolean
  isMinimized(): boolean
}

/** Restore before showing the window, so it does not first appear at the default size. */
export function restoreWindowState(win: AppWindow, state: WindowState): void {
  if (state.maximized) win.maximize()
  if (state.fullScreen) win.setFullScreen(true)
}

/** Minimizing is temporary; remember the last ordinary window mode instead. */
export function trackWindowState(win: AppWindow, save: (state: WindowState) => void): void {
  let maximized = win.isMaximized()
  const persist = (): void => {
    const fullScreen = win.isFullScreen()
    if (!fullScreen && !win.isMinimized()) maximized = win.isMaximized()
    try {
      save({ maximized, fullScreen })
    } catch (err) {
      // An unwritable profile should not stop the window from opening or closing.
      console.error('Could not save the window state:', err)
    }
  }
  win.on('maximize', persist)
  win.on('unmaximize', persist)
  win.on('enter-full-screen', persist)
  win.on('leave-full-screen', persist)
  win.on('close', persist)
}
