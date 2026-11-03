/**
 * First-page thumbnail for a PDF tile. Renders only once the tile scrolls
 * near the viewport, and shows the plain document icon until (or unless) the
 * page is ready, so a broken or encrypted file still gets a sensible tile.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CmsMediaAsset } from '@core/persistence/cmsMedia'
import { pdfContentKey, pdfThumbnailUrl } from '../../pdf/pdfDocument'

interface PdfThumbnailProps {
  asset: CmsMediaAsset
  cssWidth: number
  imageClassName: string
  fallback: ReactNode
}

export function PdfThumbnail({ asset, cssWidth, imageClassName, fallback }: PdfThumbnailProps) {
  const { publicPath, sizeBytes, replacedAt } = asset
  const frameRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const contentKey = pdfContentKey({ publicPath, sizeBytes, replacedAt })
  const [rendered, setRendered] = useState<{ key: string; url: string } | null>(null)
  // A thumbnail of the file before a "Replace" must not linger.
  const url = rendered?.key === contentKey ? rendered.url : null

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
      { rootMargin: '200px' },
    )
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    let cancelled = false
    const asset = { publicPath, sizeBytes, replacedAt }
    pdfThumbnailUrl(asset, cssWidth)
      .then((next) => {
        if (!cancelled) setRendered({ key: pdfContentKey(asset), url: next })
      })
      .catch((err: unknown) => {
        // The tile keeps its icon; the viewer reports the error properly.
        if (!cancelled) console.warn('[media:pdf] thumbnail failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [visible, publicPath, sizeBytes, replacedAt, cssWidth])

  return (
    <span ref={frameRef} data-pdf-thumbnail="">
      {url ? <img src={url} alt="" className={imageClassName} draggable={false} /> : fallback}
    </span>
  )
}
