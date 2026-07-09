import { useEffect } from 'react'

export type ScreenSize = 'phone' | 'tablet' | 'desktop'

function getScreenSize(width: number): ScreenSize {
  if (width >= 1280) return 'desktop'
  if (width >= 768) return 'tablet'
  return 'phone'
}

function isShortScreen(screen: ScreenSize, height: number): boolean {
  if (screen === 'phone') return height < 720
  if (screen === 'tablet') return height < 960
  return height < 820
}

function getViewportSize() {
  const vv = window.visualViewport
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  }
}

function applyDeviceAttrs(width: number, height: number) {
  const root = document.documentElement
  const screen = getScreenSize(width)
  const short = isShortScreen(screen, height)
  const landscape = width > height

  root.dataset.screen = screen
  root.dataset.short = short ? 'true' : 'false'
  root.dataset.landscape = landscape ? 'true' : 'false'
  root.dataset.tight = screen === 'tablet' || short ? 'true' : 'false'
}

export function useDeviceSize() {
  useEffect(() => {
    const update = () => {
      const { width, height } = getViewportSize()
      applyDeviceAttrs(width, height)
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [])
}
