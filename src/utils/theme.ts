import type { AppTheme } from '../types'

export const APP_THEME: AppTheme = 'premium'

const THEME_COLOR = '#09090b'

export function applyTheme(): void {
  document.documentElement.dataset.theme = APP_THEME
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR)
}

export function normalizeTheme(_value?: unknown): AppTheme {
  return APP_THEME
}
