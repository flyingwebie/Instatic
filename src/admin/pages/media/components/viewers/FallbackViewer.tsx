/**
 * FallbackViewer — anything without a dedicated in-place viewer.
 *
 * In practice that means documents and archives, which the library accepts
 * but never renders: `/uploads/*` serves every non-passive type with
 * `Content-Disposition: attachment` under a zero-permission CSP, precisely so
 * a PDF or an Office file can't be navigated to and run on the admin origin.
 * The action below therefore says "Download" rather than "Open" — for these
 * types a new tab would download the file and close itself, which looks like
 * a bug.
 *
 * It also still backstops a row whose MIME falls outside everything the
 * catalogue knows (manually inserted, written by an older build): we render
 * something useful instead of breaking the viewer window.
 */
import { Button } from '@ui/components/Button'
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { ExternalLinkSolidIcon } from 'pixel-art-icons/icons/external-link-solid'
import { isInlineMediaMime, mediaTypeByMime } from '@core/media-types'
import styles from './FallbackViewer.module.css'

interface FallbackViewerProps {
  publicPath: string
  filename: string
  mimeType: string
}

export function FallbackViewer({ publicPath, filename, mimeType }: FallbackViewerProps) {
  // An unknown MIME is not in the catalogue, so it has no `inline` flag —
  // treat it the way the server will: as a download.
  const opensInline = isInlineMediaMime(mimeType)
  const label = opensInline ? 'Open in new tab' : 'Download'
  const typeLabel = mediaTypeByMime(mimeType)?.label ?? (mimeType || 'Unknown type')

  return (
    <div className={styles.root}>
      <FileTextSolidIcon size={48} />
      <p className={styles.title}>{filename}</p>
      <p className={styles.meta}>{typeLabel}</p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => window.open(publicPath, '_blank', 'noopener,noreferrer')}
        aria-label={`${label} ${filename}`}
      >
        <ExternalLinkSolidIcon size={13} />
        <span>{label}</span>
      </Button>
    </div>
  )
}
