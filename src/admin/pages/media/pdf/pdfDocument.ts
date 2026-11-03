/**
 * PDF rendering for the media library — pdf.js, loaded on demand.
 *
 * `/uploads/*` serves PDFs as downloads (`inline: false` in the media-type
 * catalogue) so a PDF can never be opened and run on the admin origin. The
 * library previews them anyway by fetching the bytes and drawing pages onto
 * canvases with pdf.js. pdf.js parses in a Web Worker and paints vector
 * output; it runs no document JavaScript (no scripting sandbox is loaded) and
 * XFA forms are off, so nothing in the file executes.
 *
 * pdf.js (~1.7 MB with its worker) is only fetched the first time a PDF is
 * shown, never as part of the admin's initial bundle.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { apiBlobRequest } from '@core/http'
import type { CmsMediaAsset } from '@core/persistence/cmsMedia'

type PdfJs = typeof import('pdfjs-dist')

let pdfJsPromise: Promise<PdfJs> | null = null

function loadPdfJs(): Promise<PdfJs> {
  pdfJsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
    .then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })
    .catch((err: unknown) => {
      // A failed chunk load (offline, a deploy swapped the hashes) must not
      // poison every later preview for the life of the tab.
      pdfJsPromise = null
      throw err
    })
  return pdfJsPromise
}

export function isPdfAsset(asset: Pick<CmsMediaAsset, 'mimeType'>): boolean {
  return asset.mimeType === 'application/pdf'
}

/**
 * Identity of the bytes behind an asset. "Replace" keeps the public path but
 * changes the file, so the replacement time is part of the key.
 */
export function pdfContentKey(asset: Pick<CmsMediaAsset, 'publicPath' | 'sizeBytes' | 'replacedAt'>): string {
  return `${asset.publicPath}|${asset.sizeBytes}|${asset.replacedAt ?? ''}`
}

/** Fetch and parse a PDF asset. Aborting the signal tears the parse down. */
export async function openPdfAsset(
  asset: Pick<CmsMediaAsset, 'publicPath' | 'replacedAt'>,
  signal: AbortSignal,
): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs()
  const blob = await apiBlobRequest(asset.publicPath, {
    signal,
    // Bust the HTTP cache after "Replace", which reuses the path.
    query: asset.replacedAt ? { v: asset.replacedAt } : undefined,
    // External storage may serve from another origin; never send cookies there.
    credentials: 'same-origin',
  })
  signal.throwIfAborted()
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    enableXfa: false,
  })
  const abort = (): void => { void task.destroy() }
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await task.promise
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

/** The page's height for a given CSS width, so placeholders reserve space. */
export function pdfPageHeightFor(page: PDFPageProxy, cssWidth: number): number {
  const base = page.getViewport({ scale: 1 })
  return (cssWidth / base.width) * base.height
}

/**
 * Paint one page at `cssWidth` CSS pixels wide, sharp on high-DPI screens
 * (capped at 2x so a long document does not allocate huge canvases).
 */
export async function renderPdfPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): Promise<void> {
  const base = page.getViewport({ scale: 1 })
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * pixelRatio })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, viewport }).promise
}

// ---------------------------------------------------------------------------
// First-page thumbnails for the grid
// ---------------------------------------------------------------------------

/** Rendered thumbnails stay valid for the tab's life; bounded so a big library can't hoard memory. */
const THUMBNAIL_CACHE_LIMIT = 200
const thumbnailCache = new Map<string, Promise<string>>()

/** Grids can hold dozens of PDFs; parse at most two at a time. */
const MAX_CONCURRENT_THUMBNAILS = 2
let activeThumbnails = 0
const thumbnailQueue: Array<() => void> = []

async function withThumbnailSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeThumbnails >= MAX_CONCURRENT_THUMBNAILS) {
    await new Promise<void>((resolve) => thumbnailQueue.push(resolve))
  }
  activeThumbnails += 1
  try {
    return await work()
  } finally {
    activeThumbnails -= 1
    thumbnailQueue.shift()?.()
  }
}

async function renderThumbnail(
  asset: Pick<CmsMediaAsset, 'publicPath' | 'replacedAt'>,
  cssWidth: number,
): Promise<string> {
  return withThumbnailSlot(async () => {
    const pdf = await openPdfAsset(asset, new AbortController().signal)
    try {
      const page = await pdf.getPage(1)
      const canvas = document.createElement('canvas')
      await renderPdfPage(page, canvas, cssWidth)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not encode the PDF thumbnail')
      return URL.createObjectURL(blob)
    } finally {
      void pdf.loadingTask.destroy()
    }
  })
}

/**
 * Object URL of the asset's first page, rendered once per content version.
 * A failure is not cached, so a later view can retry.
 */
export function pdfThumbnailUrl(
  asset: Pick<CmsMediaAsset, 'publicPath' | 'sizeBytes' | 'replacedAt'>,
  cssWidth: number,
): Promise<string> {
  const key = `${pdfContentKey(asset)}|${cssWidth}`
  const cached = thumbnailCache.get(key)
  if (cached) return cached

  const pending = renderThumbnail(asset, cssWidth)
  thumbnailCache.set(key, pending)
  pending.catch(() => thumbnailCache.delete(key))
  if (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
    const [oldestKey, oldest] = thumbnailCache.entries().next().value!
    thumbnailCache.delete(oldestKey)
    void oldest.then((url) => URL.revokeObjectURL(url), () => {})
  }
  return pending
}
