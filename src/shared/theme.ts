/** Shared Ink & Ember theme constants (main + renderer). */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_BG = {
  dark: '#12110F',
  light: '#F4F6F8'
} as const

/** Graph / ref lane palette — keep in sync with CSS `--lane-*` tokens. */
export const LANE_COLORS = [
  '#E85D04',
  '#6A9B6E',
  '#D4A017',
  '#E35D5D',
  '#9B7EBD',
  '#5B8FA8',
  '#C97B84',
  '#8FA86B'
] as const

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean
): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}

export function themeBackground(resolved: ResolvedTheme): string {
  return THEME_BG[resolved]
}
