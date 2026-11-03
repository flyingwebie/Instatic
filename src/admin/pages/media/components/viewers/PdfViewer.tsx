/**
 * PdfViewer — page-by-page preview of a PDF asset.
 *
 * PDFs are served as downloads (see FallbackViewer), so the pages are drawn
 * here with pdf.js instead of handing the file to the browser. Pages paint
 * lazily as they scroll into view; each keeps a placeholder of its real
 * height so the scrollbar is right from the start. If the file cannot be
 * parsed, the viewer falls back to the download card.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Button } from '@ui/components/Button'
import { ExternalLinkSolidIcon } from 'pixel-art-icons/icons/external-link-solid'
import { isAbortError } from '@core/http'
import type { CmsMediaAsset } from '@core/persistence/cmsMedia'
import { openPdfAsset, pdfPageHeightFor, renderPdfPage } from '../../pdf/pdfDocument'
import { FallbackViewer } from './FallbackViewer'
import styles from './PdfViewer.module.css'

/** Pages wider than this are no easier to read, only heavier to paint. */
const MAX_PAGE_WIDTH = 900
/** Snap measured widths so a resizing window doesn't repaint every pixel. */
const WIDTH_STEP = 50
/** US Letter / A4-ish, for pages whose size is not known yet. */
const DEFAULT_PAGE_RATIO = 1.32

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; pdf: PDFDocumentProxy }
  | { status: 'failed' }

/** Which file a settled load belongs to ("Replace" keeps the path, so both parts count). */
function loadKey(publicPath: string, replacedAt: string | null): string {
  return `${publicPath}|${replacedAt ?? ''}`
}

interface PdfViewerProps {
  asset: CmsMediaAsset
}

export function PdfViewer({ asset }: PdfViewerProps) {
  const { publicPath, replacedAt } = asset
  const currentKey = loadKey(publicPath, replacedAt)
  const [settled, setSettled] = useState<{ key: string; state: LoadState } | null>(null)
  // A settled load for a previous file version reads as loading.
  const load: LoadState = settled?.key === currentKey ? settled.state : { status: 'loading' }
  const [pageWidth, setPageWidth] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    const key = loadKey(publicPath, replacedAt)
    let opened: PDFDocumentProxy | null = null
    openPdfAsset({ publicPath, replacedAt }, controller.signal)
      .then((pdf) => {
        opened = pdf
        if (controller.signal.aborted) {
          void pdf.loadingTask.destroy()
          return
        }
        setSettled({ key, state: { status: 'ready', pdf } })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        console.error('[media:pdf] preview failed:', err)
        setSettled({ key, state: { status: 'failed' } })
      })
    return () => {
      controller.abort()
      void opened?.loadingTask.destroy()
    }
  }, [publicPath, replacedAt])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const available = Math.min(entry!.contentRect.width, MAX_PAGE_WIDTH)
      setPageWidth(Math.max(WIDTH_STEP, Math.floor(available / WIDTH_STEP) * WIDTH_STEP))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (load.status === 'failed') {
    return <FallbackViewer publicPath={asset.publicPath} filename={asset.filename} mimeType={asset.mimeType} />
  }

  const pageCount = load.status === 'ready' ? load.pdf.numPages : null
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.meta} aria-live="polite">
          {pageCount === null ? 'Loading preview…' : `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => window.open(asset.publicPath, '_blank', 'noopener,noreferrer')}
          aria-label={`Download ${asset.filename}`}
        >
          <ExternalLinkSolidIcon size={13} />
          <span>Download</span>
        </Button>
      </div>
      <div ref={scrollRef} className={styles.pages} aria-label={`Preview of ${asset.filename}`}>
        {load.status === 'ready' && pageWidth > 0 &&
          Array.from({ length: load.pdf.numPages }, (_, index) => (
            <PdfPage key={index} pdf={load.pdf} pageNumber={index + 1} width={pageWidth} />
          ))}
      </div>
    </div>
  )
}

interface PdfPageProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  width: number
}

function PdfPage({ pdf, pageNumber, width }: PdfPageProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [height, setHeight] = useState(Math.round(width * DEFAULT_PAGE_RATIO))

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '800px 0px' },
    )
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    let cancelled = false
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return
        setHeight(Math.round(pdfPageHeightFor(page, width)))
        const canvas = canvasRef.current
        if (canvas) await renderPdfPage(page, canvas, width)
      } catch (err) {
        if (!cancelled) console.error(`[media:pdf] page ${pageNumber} failed to render:`, err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [visible, pdf, pageNumber, width])

  return (
    <div
      ref={frameRef}
      className={styles.page}
      style={{ '--pdf-page-width': `${width}px`, '--pdf-page-height': `${height}px` } as CSSProperties}
    >
      <canvas ref={canvasRef} className={styles.canvas} aria-label={`Page ${pageNumber}`} role="img" />
    </div>
  )
}
