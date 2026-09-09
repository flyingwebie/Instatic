import type { ReactNode } from 'react'
import styles from './EditorColumn.module.css'

export interface PanelHeaderProps {
  headerActions?: ReactNode
}

export function PanelHeader({
  label,
  children,
  actions,
}: {
  label: string
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <div className={styles.toolbar}>
      <span className={styles.panelLabel}>{label}</span>
      {children}
      <span className={styles.toolbarActions}>{actions}</span>
    </div>
  )
}
