function isIosLikeDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/i.test(ua)) return true
  // iPadOS desktop-mode Safari
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function printViaNewWindow(html: string): boolean {
  const win = window.open('', '_blank')
  if (!win) return false

  try {
    win.document.open()
    win.document.write(html)
    win.document.close()
  } catch {
    try {
      win.close()
    } catch {
      // ignore
    }
    return false
  }

  let printed = false
  const trigger = () => {
    if (printed) return
    printed = true
    try {
      win.focus()
      win.print()
    } catch {
      // ignore
    }
  }

  // Wait for layout/fonts — critical for iPad Safari (blank page otherwise).
  win.addEventListener?.('load', () => {
    window.setTimeout(trigger, 200)
  })
  window.setTimeout(trigger, 600)
  return true
}

function printViaVisibleIframe(html: string): void {
  const frame = document.createElement('iframe')
  // iPad Safari often prints a blank page for off-screen / zero-opacity iframes.
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '1px'
  frame.style.height = '1px'
  frame.style.opacity = '0.01'
  frame.style.border = '0'
  frame.style.zIndex = '2147483647'
  frame.setAttribute('aria-hidden', 'true')
  document.body.appendChild(frame)

  const win = frame.contentWindow
  const doc = frame.contentDocument
  if (!doc || !win) {
    frame.remove()
    return
  }

  let printed = false
  const cleanup = () => {
    window.setTimeout(() => {
      if (document.body.contains(frame)) frame.remove()
    }, 1500)
    win.removeEventListener('afterprint', onAfterPrint)
  }
  const onAfterPrint = () => cleanup()

  const triggerPrint = () => {
    if (printed) return
    printed = true
    win.addEventListener('afterprint', onAfterPrint)
    try {
      win.focus()
      win.print()
    } catch {
      cleanup()
    }
    window.setTimeout(cleanup, 60_000)
  }

  frame.onload = () => {
    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(() => {
        window.setTimeout(triggerPrint, isIosLikeDevice() ? 250 : 0)
      })
    })
  }

  doc.open()
  doc.write(html)
  doc.close()

  window.setTimeout(() => {
    if (!printed && document.body.contains(frame)) triggerPrint()
  }, isIosLikeDevice() ? 800 : 350)
}

/** Open the system print dialog for inline HTML (Save as PDF). */
export function printHtmlReport(html: string): void {
  if (isIosLikeDevice()) {
    if (printViaNewWindow(html)) return
  }
  printViaVisibleIframe(html)
}
