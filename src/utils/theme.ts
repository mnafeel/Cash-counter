import type { AppTheme } from '../types'

export const DEFAULT_THEME: AppTheme = 'premium'

const THEME_COLORS: Record<AppTheme, string> = {
  premium: '#131316',
  light: '#f8f5f2',
  brown: '#2a1810',
  navy: '#0a1020',
}

const THEME_BOOT_GRADIENTS: Record<AppTheme, string> = {
  premium: 'linear-gradient(165deg, #0f0f12 0%, #1a1a20 45%, #141418 100%)',
  light: 'linear-gradient(165deg, #fdfcfa 0%, #f5f0ea 42%, #ebe6df 100%)',
  brown: 'linear-gradient(165deg, #1f120a 0%, #3d2518 45%, #2a1810 100%)',
  navy: 'linear-gradient(165deg, #060a14 0%, #121c36 42%, #0a1020 100%)',
}

const THEME_BOOT_TEXT: Record<AppTheme, string> = {
  premium: '#f4f4f5',
  light: '#1c1917',
  brown: '#f2dcc0',
  navy: '#f0f4ff',
}

const THEME_BOOT_MUTED: Record<AppTheme, string> = {
  premium: '#a1a1aa',
  light: '#78716c',
  brown: '#c9a882',
  navy: '#94a8cc',
}

const THEME_BOOT_ACCENT: Record<AppTheme, string> = {
  premium: '#d4a84b',
  light: '#9a6b3f',
  brown: '#f2dcc0',
  navy: '#ffc857',
}

export function normalizeTheme(value?: unknown): AppTheme {
  if (value === 'light' || value === 'premium' || value === 'brown' || value === 'navy') {
    return value
  }
  return DEFAULT_THEME
}

function syncHtmlBootScreen(theme: AppTheme): void {
  const boot = document.getElementById('app-boot')
  if (!boot) return
  boot.style.background = THEME_BOOT_GRADIENTS[theme]
  boot.style.color = THEME_BOOT_TEXT[theme]
  const title = boot.querySelector('#app-boot-title')
  const sub = boot.querySelector('#app-boot-sub')
  const spinner = boot.querySelector('#app-boot-spinner')
  if (title instanceof HTMLElement) title.style.color = THEME_BOOT_TEXT[theme]
  if (sub instanceof HTMLElement) sub.style.color = THEME_BOOT_MUTED[theme]
  if (spinner instanceof HTMLElement) {
    spinner.style.borderColor = `${THEME_BOOT_ACCENT[theme]}33`
    spinner.style.borderTopColor = THEME_BOOT_ACCENT[theme]
  }
}

export function applyTheme(theme?: AppTheme): void {
  const resolved = normalizeTheme(theme)
  document.documentElement.dataset.theme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLORS[resolved])
  syncHtmlBootScreen(resolved)
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
