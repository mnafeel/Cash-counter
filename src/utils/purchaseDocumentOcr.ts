import { installPdfJsPolyfills } from './pdfJsPolyfills'

const PAGE_BREAK = '\n\n<<<PAGE_BREAK>>>\n\n'

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsArrayBuffer(file)
  })
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

type PdfTextItem = {
  str?: string
  transform: number[]
}

type PdfPage = {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>
  getViewport: (options: { scale: number }) => { width: number; height: number }
  render: (options: {
    canvas: HTMLCanvasElement
    canvasContext: CanvasRenderingContext2D
    viewport: { width: number; height: number }
  }) => { promise: Promise<void> }
}

type PdfDocument = {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPage>
}

function groupPdfItemsToLines(items: PdfTextItem[]): string[] {
  const rows = new Map<number, { x: number; text: string }[]>()

  for (const item of items) {
    const text = item.str?.trim()
    if (!text) continue
    const y = Math.round(item.transform[5] ?? 0)
    const x = item.transform[4] ?? 0
    const bucket = Math.round(y / 4) * 4
    const list = rows.get(bucket) ?? []
    list.push({ x, text })
    rows.set(bucket, list)
  }

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) =>
      parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
}

async function extractDigitalPageLines(page: PdfPage): Promise<string[]> {
  const content = await page.getTextContent()
  return groupPdfItemsToLines(content.items)
}

async function renderPageToDataUrl(page: PdfPage, scale = 2): Promise<string> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not prepare PDF preview')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvas, canvasContext: context, viewport }).promise
  return canvas.toDataURL('image/png')
}

async function ocrDataUrls(
  dataUrls: string[],
  onProgress?: (message: string) => void,
): Promise<string[]> {
  if (dataUrls.length === 0) return []
  onProgress?.('Scanning bill…')
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', undefined, {
    logger: () => undefined,
  })
  try {
    const results: string[] = []
    for (let i = 0; i < dataUrls.length; i++) {
      onProgress?.(`Scanning page ${i + 1}/${dataUrls.length}…`)
      const { data } = await worker.recognize(dataUrls[i]!)
      results.push(data.text.trim())
    }
    return results
  } finally {
    await worker.terminate()
  }
}

async function extractTextFromPdf(
  file: File,
  onProgress?: (message: string) => void,
): Promise<string> {
  onProgress?.('Reading PDF…')
  installPdfJsPolyfills()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const data = await readFileAsArrayBuffer(file)
  const pdf = (await pdfjs.getDocument({ data }).promise) as unknown as PdfDocument
  const pageTexts: string[] = []
  const pagesNeedingOcr: number[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    onProgress?.(`Reading PDF page ${pageNumber}/${pdf.numPages}…`)
    const page = await pdf.getPage(pageNumber)
    const lines = await extractDigitalPageLines(page)
    const pageText = lines.join('\n').trim()
    pageTexts.push(pageText)
    if (pageText.length < 40) pagesNeedingOcr.push(pageNumber)
  }

  if (pdf.numPages > 1 && !pagesNeedingOcr.includes(pdf.numPages)) {
    const lastPageText = pageTexts[pageTexts.length - 1] ?? ''
    const hasMoneyTotal =
      /(?:rs\.?|₹|inr)\s*[\d,]{3,}/i.test(lastPageText) &&
      /(?:grand\s*total|net\s*payable|amount\s*payable|invoice\s*total)/i.test(lastPageText)
    if (!hasMoneyTotal) pagesNeedingOcr.push(pdf.numPages)
  }

  if (pagesNeedingOcr.length > 0) {
    onProgress?.('Scanning scanned pages…')
    const ocrUrls: string[] = []
    for (const pageNumber of pagesNeedingOcr) {
      const page = await pdf.getPage(pageNumber)
      ocrUrls.push(await renderPageToDataUrl(page, pageNumber === pdf.numPages ? 2.4 : 2))
    }
    const ocrTexts = await ocrDataUrls(ocrUrls, onProgress)
    for (let i = 0; i < pagesNeedingOcr.length; i++) {
      const index = pagesNeedingOcr[i]! - 1
      const ocrText = ocrTexts[i] ?? ''
      if (ocrText.length > (pageTexts[index]?.length ?? 0)) {
        pageTexts[index] = ocrText
      } else if (pageTexts[index]) {
        pageTexts[index] = `${pageTexts[index]}\n${ocrText}`.trim()
      } else {
        pageTexts[index] = ocrText
      }
    }
  }

  const combined = pageTexts.filter(Boolean).join(PAGE_BREAK).trim()
  if (!combined) throw new Error('Could not read any text from this PDF.')
  return combined
}

async function extractTextFromImageDataUrl(
  dataUrl: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const [text] = await ocrDataUrls([dataUrl], onProgress)
  return text ?? ''
}

export async function extractTextFromPurchaseDocument(
  file: File,
  onProgress?: (message: string) => void,
): Promise<string> {
  const type = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()

  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    return extractTextFromPdf(file, onProgress)
  }

  if (type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|heic|heif)$/i.test(name)) {
    const dataUrl = await readFileAsDataUrl(file)
    return extractTextFromImageDataUrl(dataUrl, onProgress)
  }

  throw new Error('Unsupported file type. Use a photo or PDF bill.')
}

export const PURCHASE_SCAN_PAGE_BREAK = PAGE_BREAK
