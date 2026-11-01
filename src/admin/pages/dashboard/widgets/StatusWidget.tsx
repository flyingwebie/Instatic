/**
 * Site status widget — rows of (version / site / build / backup / plugins)
 * with a status dot per row.
 *
 * The Version row is read from the server (`GET /admin/api/cms/about`). The
 * rows below it are still hardcoded placeholders from the widget's original
 * scaffold and are NOT wired to anything — do not read them as live state,
 * and prefer extending this widget by making one of them real over adding
 * another fake.
 */
import { ZapSolidIcon } from 'pixel-art-icons/icons/zap-solid'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '@ui/components/Widget'
import { useAppVersion } from '@admin/state/appVersion'
import styles from './widgets.module.css'

interface Row { label: string; value: string; tone: 'green' | 'amber' }

const PLACEHOLDER_ROWS: readonly Row[] = [
  { label: 'Site', value: 'Live', tone: 'green' },
  { label: 'Build', value: '3m ago', tone: 'green' },
  { label: 'Backup', value: '2h ago', tone: 'green' },
  { label: 'Plugins', value: '1 update', tone: 'amber' },
]

export function StatusWidget({ span, editing }: DashboardWidgetRendererProps) {
  const appVersion = useAppVersion()
  const rows: readonly Row[] = [
    { label: 'Version', value: appVersion ? `v${appVersion}` : '—', tone: 'green' },
    ...PLACEHOLDER_ROWS,
  ]

  return (
    <Widget
      widgetId="status"
      title="Status"
      icon={ZapSolidIcon}
      tint="mint"
      span={span}
      editing={editing}
    >
      <div className={styles.statusGrid}>
        {rows.map((r) => (
          <div key={r.label} className={styles.statusRow}>
            <span className={styles.statusLabel}>
              <span className={`${styles.dot} ${r.tone === 'green' ? styles.dotGreen : styles.dotAmber}`} />
              {r.label}
            </span>
            <span className={styles.wlistMeta}>{r.value}</span>
          </div>
        ))}
      </div>
    </Widget>
  )
}
