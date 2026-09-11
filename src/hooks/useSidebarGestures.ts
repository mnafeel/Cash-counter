import { useEffect, useRef, type RefObject } from 'react'

const EDGE_WIDTH_PX = 28
const SWIPE_THRESHOLD_PX = 56

type TouchStart = {
  x: number
  y: number
  fromEdge: boolean
  onSidebar: boolean
}

export function useSidebarGestures(
  sidebarOpen: boolean,
  setSidebarOpen: (open: boolean) => void,
  sidebarRef: RefObject<HTMLElement | null>,
) {
  const touchStartRef = useRef<TouchStart | null>(null)

  useEffect(() => {
    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      const target = event.target
      const onSidebar = sidebarRef.current?.contains(target as Node) ?? false
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        fromEdge: touch.clientX <= EDGE_WIDTH_PX,
        onSidebar,
      }
    }

    function onTouchEnd(event: TouchEvent) {
      const start = touchStartRef.current
      touchStartRef.current = null
      if (!start || event.changedTouches.length !== 1) return

      const touch = event.changedTouches[0]
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return
      if (Math.abs(dx) < Math.abs(dy) * 1.15) return

      if (!sidebarOpen && start.fromEdge && dx > 0) {
        setSidebarOpen(true)
        return
      }

      if (sidebarOpen && (start.onSidebar || dx < 0) && dx < 0) {
        setSidebarOpen(false)
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [setSidebarOpen, sidebarOpen, sidebarRef])
}
