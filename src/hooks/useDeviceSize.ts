import { useEffect } from 'react'

export type ScreenSize = 'phone' | 'tablet' | 'desktop'

function getScreenSize(width: number): ScreenSize {
  if (width >= 1024) return 'desktop'
  if (width >= 768) return 'tablet'
  return 'phone'
}

function applyDeviceAttrs(width: number, height: number) {
  const root = document.documentElement
  root.dataset.screen = getScreenSize(width)
  root.dataset.short = height < 700 ? 'true' : 'false'
  root.dataset.landscape = width > height ? 'true' : 'false'
}

export function useDeviceSize() {
  useEffect(() => {
    const update = () => applyDeviceAttrs(window.innerWidth, window.innerHeight)

    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
}
