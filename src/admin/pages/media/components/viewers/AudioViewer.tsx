/**
 * AudioViewer — native `<audio>` player with browser-supplied controls.
 *
 * The same reasoning as `VideoViewer`: the browser's transport already covers
 * scrubbing and volume, and an audio asset in the library is being auditioned,
 * not edited.
 *
 * Audio is served inline (it is in the catalogue's `inline` set), which is
 * what lets the element stream it at all — a `Content-Disposition: attachment`
 * response would download instead of play.
 */
import styles from './AudioViewer.module.css'

interface AudioViewerProps {
  src: string
}

export function AudioViewer({ src }: AudioViewerProps) {
  return (
    <div className={styles.root}>
      {/* key={src} — remount on asset switch so the previous clip's playback
          position doesn't carry over (same Safari behaviour as video). */}
      <audio key={src} src={src} controls preload="metadata" className={styles.audio} />
    </div>
  )
}
