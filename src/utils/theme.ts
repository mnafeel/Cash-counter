import type { AppTheme } from '../types'

export const DEFAULT_THEME: AppTheme = 'premium'

const THEME_COLORS: Record<AppTheme, string> = {
  premium: '#131316',
  light: '#f8f5f2',
  brown: '#2a1810',
  navy: '#0a1020',
}

export function normalizeTheme(value?: unknown): AppTheme {
  if (value === 'light' || value === 'premium' || value === 'brown' || value === 'navy') {
    return value
  }
  return DEFAULT_THEME
}

export function applyTheme(theme?: AppTheme): void {
  const resolved = normalizeTheme(theme)
  document.documentElement.dataset.theme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLORS[resolved])
}

export function prefersLightTheme(): boolean {
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

export function resolveTheme(
  stored?: AppTheme,
  autoFromSystem?: boolean,
): AppTheme {
  if (autoFromSystem) {
    return prefersLightTheme() ? 'light' : 'premium'
  }
  return normalizeTheme(stored)
}
