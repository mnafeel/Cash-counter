import { useEffect } from 'react'

export type ScreenSize = 'phone' | 'tablet' | 'desktop'

function isTouchDevice(): boolean {
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 1 ||
    'ontouchstart' in window
  )
}

/** Classify device — touch iPads stay tablet even in landscape (up to 1400px). */
function getScreenSize(width: number, touch: boolean): ScreenSize {
  if (width < 768) return 'phone'
  if (width < 1280) return 'tablet'
  if (touch && width < 1400) return 'tablet'
  return 'desktop'
}

function isShortScreen(screen: ScreenSize, height: number): boolean {
  if (screen === 'phone') return height < 700
  if (screen === 'tablet') return height < 850
  return height < 750
}

function getAppDimensions() {
  const vv = window.visualViewport
  const touch = isTouchDevice()
  return {
    width: Math.round(window.innerWidth),
    height: Math.round(touch && vv ? vv.height : window.innerHeight),
  }
}

interface LayoutVars {
  pageGap: number
  keyGap: number
  uiPad: number
  fontBase: number
}

function getLayoutVars(
  screen: ScreenSize,
  height: number,
  short: boolean,
  landscape: boolean,
): LayoutVars {
  if (screen === 'phone') {
    return {
      pageGap: short ? 3 : 4,
      keyGap: short ? 2 : 3,
      uiPad: short ? 4 : 6,
      fontBase: 15,
    }
  }

  if (screen === 'tablet') {
    const compact = short || landscape
    return {
      pageGap: compact ? 3 : 5,
      keyGap: compact ? 2 : 4,
      uiPad: compact ? 5 : 8,
      fontBase: 16,
    }
  }

  const hScale = Math.min(Math.max(height / 900, 0.85), 1.15)
  return {
    pageGap: Math.round(6 * hScale),
    keyGap: Math.round(5 * hScale),
    uiPad: Math.round(10 * hScale),
    fontBase: Math.round(Math.min(17, 15 + height / 250)),
  }
}

/** Apply device attrs + layout CSS vars. Safe to call before React render. */
export function applyDeviceSize() {
  const { width, height } = getAppDimensions()
  const touch = isTouchDevice()
  const screen = getScreenSize(width, touch)
  const short = isShortScreen(screen, height)
  const landscape = width > height
  const vars = getLayoutVars(screen, height, short, landscape)
  const root = document.documentElement

  root.dataset.screen = screen
  root.dataset.short = short ? 'true' : 'false'
  root.dataset.landscape = landscape ? 'true' : 'false'
  root.dataset.touch = touch ? 'true' : 'false'

  root.style.setProperty('--app-width', `${width}px`)
  root.style.setProperty('--app-height', `${height}px`)
  root.style.setProperty('--page-gap', `${vars.pageGap}px`)
  root.style.setProperty('--key-gap', `${vars.keyGap}px`)
  root.style.setProperty('--ui-pad', `${vars.uiPad}px`)
  root.style.fontSize = `${vars.fontBase}px`
}

export function useDeviceSize() {
  useEffect(() => {
    let orientTimer: ReturnType<typeof setTimeout> | undefined

    const update = () => applyDeviceSize()

    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', () => {
      clearTimeout(orientTimer)
      orientTimer = setTimeout(update, 150)
    })
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)

    return () => {
      clearTimeout(orientTimer)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [])
}
