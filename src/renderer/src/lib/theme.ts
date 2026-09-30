import { useEffect, useState } from 'react'
import {
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference
} from '@shared/theme'

export type { ResolvedTheme, ThemePreference }
export { resolveTheme, LANE_COLORS, THEME_BG, themeBackground } from '@shared/theme'

export function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyDocumentTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

export function resolveAndApplyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, getSystemDark())
  applyDocumentTheme(resolved)
  return resolved
}

/** The Dusk dark theme for Monaco, defined in setupMonaco; light uses Monaco's own `vs`. */
export const MONACO_DARK_THEME = 'gm-dark'

export function monacoThemeFor(resolved: ResolvedTheme): 'vs' | typeof MONACO_DARK_THEME {
  return resolved === 'light' ? 'vs' : MONACO_DARK_THEME
}

export function readDocumentTheme(): ResolvedTheme {
  const t = document.documentElement.dataset.theme
  return t === 'light' ? 'light' : 'dark'
}

export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(readDocumentTheme)
  useEffect(() => {
    const sync = (): void => setTheme(readDocumentTheme())
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
}
