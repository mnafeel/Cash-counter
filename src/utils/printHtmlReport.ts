/** Open the system print dialog for inline HTML (Save as PDF). */
export function printHtmlReport(html: string): void {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.left = '-10000px'
  frame.style.top = '0'
  frame.style.width = '210mm'
  frame.style.height = '297mm'
  frame.style.border = '0'
  frame.style.opacity = '0'
  frame.style.pointerEvents = 'none'
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
    frame.remove()
    win.removeEventListener('afterprint', cleanup)
  }

  const triggerPrint = () => {
    if (printed) return
    printed = true
    win.addEventListener('afterprint', cleanup)
    win.focus()
    win.print()
    window.setTimeout(cleanup, 60_000)
  }

  frame.onload = () => {
    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(triggerPrint)
    })
  }

  doc.open()
  doc.write(html)
  doc.close()

  // Some browsers skip iframe onload after doc.write — fallback after layout.
  window.setTimeout(() => {
    if (!printed && document.body.contains(frame)) {
      triggerPrint()
    }
  }, 350)
}
