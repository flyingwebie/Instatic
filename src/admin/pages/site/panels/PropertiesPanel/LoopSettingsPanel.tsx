import { useEffect, useRef } from 'react'
import { PanelHeader } from '@admin/shared/PanelHeader'
import { selectActiveCanvasPage, selectCodeDockLoopNode, useEditorStore } from '@site/store/store'
import { LoopPropertiesView } from './LoopPropertiesView'
import { usePropertiesPanelAutoOpen } from './usePropertiesPanelAutoOpen'
import styles from './LoopSettingsPanel.module.css'

/** The fixed, module-only inspector used alongside the Code Dock. */
export function LoopSettingsPanel() {
  usePropertiesPanelAutoOpen()
  const node = useEditorStore(selectCodeDockLoopNode)
  const page = useEditorStore(selectActiveCanvasPage)
  const collapsed = useEditorStore((s) => s.propertiesPanel.collapsed)
  const setPropertiesPanel = useEditorStore((s) => s.setPropertiesPanel)
  const focusedPanel = useEditorStore((s) => s.focusedPanel)
  const setFocusedPanel = useEditorStore((s) => s.setFocusedPanel)
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focusedPanel === 'properties' && !collapsed && !panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus()
    }
  }, [focusedPanel, collapsed])
  if (!node || collapsed) return null

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      aria-label="Loop settings"
      tabIndex={-1}
      onFocus={() => setFocusedPanel('properties')}
      onClick={(event) => event.stopPropagation()}
    >
      <PanelHeader
        title="Loop settings"
        panelId="loop-settings"
        onClose={() => setPropertiesPanel({ collapsed: true })}
      />
      <div className={styles.controls}>
        <LoopPropertiesView nodeId={node.id} props={node.props} activePage={page} />
      </div>
    </section>
  )
}
