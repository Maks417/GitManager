import { BrowserWindow, nativeTheme } from 'electron'
import { loadPreferences } from './storage'
import { resolveTheme, themeBackground, type ThemePreference } from '@shared/theme'

export function applyWindowThemeBackground(
  preference: ThemePreference = loadPreferences().theme
): void {
  const resolved = resolveTheme(preference, nativeTheme.shouldUseDarkColors)
  const bg = themeBackground(resolved)
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(bg)
  }
}

/**
 * The page CSS cannot reach the window frame, title bar or (Windows/Linux) menu bar: those follow
 * Electron's native theme, as does the renderer's `prefers-color-scheme`.
 */
export function applyThemePreference(
  preference: ThemePreference = loadPreferences().theme
): void {
  // Each assignment notifies every native-theme observer and repaints the title bar, and preferences
  // are saved on every splitter drag: assign only a change.
  if (nativeTheme.themeSource !== preference) nativeTheme.themeSource = preference
  applyWindowThemeBackground(preference)
}

export function resolvedWindowBackground(
  preference: ThemePreference = loadPreferences().theme
): string {
  return themeBackground(resolveTheme(preference, nativeTheme.shouldUseDarkColors))
}
