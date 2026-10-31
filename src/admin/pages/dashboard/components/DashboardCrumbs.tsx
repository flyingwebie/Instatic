/**
 * DashboardCrumbs — the breadcrumb strip above the dashboard grid, with the
 * running Instatic release pinned to the far end.
 *
 * Its own component so `DashboardPage` does not also own the version fetch:
 * the page is already a grandfathered god-file, and the release line has
 * nothing to do with the grid, the drag session, or the widget layout.
 */
import { ChevronRightIcon } from 'pixel-art-icons/icons/chevron-right'
import { useAppVersion } from '@admin/state/appVersion'
import styles from '../DashboardPage.module.css'

export function DashboardCrumbs() {
  const appVersion = useAppVersion()

  return (
    <div className={styles.crumbs}>
      <span>Admin</span>
      <ChevronRightIcon size={9} aria-hidden="true" />
      <span className={styles.crumbsCurrent}>Dashboard</span>
      <span className={styles.crumbsSpring} aria-hidden="true" />
      {/* Renders only once loaded: an empty slot reads better than a flash
          of "unknown" on every dashboard mount, and the version is never
          important enough to show an error state for. */}
      {appVersion && <span className={styles.version}>Instatic v{appVersion}</span>}
    </div>
  )
}
