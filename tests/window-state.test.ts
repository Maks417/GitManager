import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { restoreWindowState, trackWindowState, WindowStateSchema, type WindowState } from '../src/main/window-state'

class FakeWindow extends EventEmitter {
  maximized = false
  fullScreen = false
  minimized = false
  maximize(): void { this.maximized = true; this.emit('maximize') }
  setFullScreen(value: boolean): void {
    this.fullScreen = value
    this.emit(value ? 'enter-full-screen' : 'leave-full-screen')
  }
  isMaximized(): boolean { return this.maximized }
  isFullScreen(): boolean { return this.fullScreen }
  isMinimized(): boolean { return this.minimized }
}

describe('window state', () => {
  it('restores maximized and fullscreen modes and accepts older profiles without saved state', () => {
    expect(WindowStateSchema.parse({})).toEqual({ maximized: false, fullScreen: false })
    expect(WindowStateSchema.parse({ maximized: 'yes', fullScreen: true })).toEqual({ maximized: false, fullScreen: true })
    const win = new FakeWindow()
    restoreWindowState(win, { maximized: true, fullScreen: true })
    expect(win.isMaximized()).toBe(true)
    expect(win.isFullScreen()).toBe(true)
  })

  it('persists mode changes and the final state for the next launch', () => {
    const win = new FakeWindow()
    const saved: WindowState[] = []
    trackWindowState(win, (state) => saved.push(state))
    win.maximize()
    win.setFullScreen(true)
    win.setFullScreen(false)
    win.maximized = false
    win.emit('unmaximize')
    win.emit('close')
    expect(saved).toEqual([
      { maximized: true, fullScreen: false },
      { maximized: true, fullScreen: true },
      { maximized: true, fullScreen: false },
      { maximized: false, fullScreen: false },
      { maximized: false, fullScreen: false }
    ])
    const reopened = new FakeWindow()
    restoreWindowState(reopened, saved[saved.length - 1])
    expect(reopened.isMaximized()).toBe(false)
    expect(reopened.isFullScreen()).toBe(false)
  })

  it('keeps maximized mode when a minimized window is closed', () => {
    const win = new FakeWindow()
    const save = vi.fn()
    trackWindowState(win, save)
    win.maximize()
    win.minimized = true
    win.maximized = false
    win.emit('close')
    expect(save).toHaveBeenLastCalledWith({ maximized: true, fullScreen: false })
  })

  it('keeps fullscreen mode when closing and tolerates an unwritable profile', () => {
    const win = new FakeWindow()
    const save = vi.fn()
    trackWindowState(win, save)
    win.setFullScreen(true)
    win.emit('close')
    expect(save).toHaveBeenLastCalledWith({ maximized: false, fullScreen: true })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const locked = new FakeWindow()
      trackWindowState(locked, () => { throw new Error('profile is read-only') })
      expect(() => locked.emit('close')).not.toThrow()
      expect(log).toHaveBeenCalledOnce()
    } finally { log.mockRestore() }
  })
})
