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

export function resolvedWindowBackground(
  preference: ThemePreference = loadPreferences().theme
): string {
  return themeBackground(resolveTheme(preference, nativeTheme.shouldUseDarkColors))
}
