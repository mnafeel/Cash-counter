import type { AppTheme } from '../types'

const THEME_COLORS: Record<AppTheme, string> = {
  brown: '#2a1810',
  navy: '#0a1020',
  light: '#0f766e',
  premium: '#09090b',
}

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLORS[theme])
}

export function normalizeTheme(value: unknown): AppTheme {
  if (value === 'brown') return 'brown'
  if (value === 'navy') return 'navy'
  if (value === 'light') return 'light'
  return 'premium'
}
