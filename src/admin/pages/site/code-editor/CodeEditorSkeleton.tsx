import type { CSSProperties } from 'react'
import styles from './CodeEditorPanel.module.css'

type SkeletonLineStyle = CSSProperties & { '--skeleton-line-width': string }

const SKELETON_LINE_WIDTHS = [
  '72%',
  '54%',
  '88%',
  '40%',
  '66%',
  '78%',
  '48%',
  '92%',
  '60%',
  '34%',
  '82%',
  '58%',
] as const

export function CodeEditorSkeleton() {
  return (
    <div className={styles.loadingSkeleton} role="status" aria-label="Loading code editor">
      <div className={styles.loadingGutter} aria-hidden="true">
        {SKELETON_LINE_WIDTHS.map((_, index) => (
          <span key={index} className={styles.loadingGutterLine} />
        ))}
      </div>
      <div className={styles.loadingLines} aria-hidden="true">
        {SKELETON_LINE_WIDTHS.map((width, index) => (
          <span
            key={index}
            className={styles.loadingLine}
            style={{ '--skeleton-line-width': width } as SkeletonLineStyle}
          />
        ))}
      </div>
      <span className={styles.loadingSrOnly}>Loading code editor…</span>
    </div>
  )
}
