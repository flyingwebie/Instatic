import { useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { ArrowLeftIcon } from 'pixel-art-icons/icons/arrow-left'
import { ArrowRightIcon } from 'pixel-art-icons/icons/arrow-right'
import { ReloadIcon } from 'pixel-art-icons/icons/reload'
import { Button } from '@ui/components/Button'
import { Separator } from '@ui/components/Separator'
import { cn } from '@ui/cn'
import styles from './ControlOrderEditor.module.css'

export function ControlOrderEditor({
  items,
  saveOrder,
  defaultOrder,
  label,
}: {
  items: { id: string; label: string; icon: ReactNode }[]
  defaultOrder: readonly string[]
  label: string
  saveOrder: (ids: readonly string[]) => void
}) {
  const [selected, setSelected] = useState(items[0].id)
  const [dragged, setDragged] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const index = items.findIndex((item) => item.id === selected)

  function move(id: string, to: number) {
    const from = items.findIndex((item) => item.id === id)
    if (from < 0 || to < 0 || to >= items.length || from === to) return
    const ids: string[] = items.map((item) => item.id)
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    saveOrder(ids)
  }

  return (
    <>
      <div className={styles.heading}>Drag icons, or select one and use the arrows.</div>
      <div
        ref={rowRef}
        className={cn(styles.settings, styles.orderPalette)}
        role="group"
        aria-label={label}
        style={{ '--order-columns': Math.min(5, items.length) } as CSSProperties}
      >
        {items.map((item, position) => {
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="xs"
              iconOnly
              draggable
              className={styles.orderItem}
              data-drop-target={over === item.id && dragged !== item.id}
              data-order-id={item.id}
              aria-label={item.label}
              tooltip={`${item.label} · ${position + 1} of ${items.length}`}
              pressed={selected === item.id}
              onFocus={() => setSelected(item.id)}
              onClick={() => setSelected(item.id)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', item.id)
                setSelected(item.id)
                setDragged(item.id)
              }}
              onDragOver={(event) => {
                if (!dragged) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setOver(item.id)
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(event) => {
                event.preventDefault()
                if (dragged) move(dragged, position)
                setDragged(null)
                setOver(null)
              }}
              onDragEnd={() => {
                setDragged(null)
                setOver(null)
              }}
              onKeyDown={(event) => {
                const target =
                  event.key === 'ArrowLeft'
                    ? position - 1
                    : event.key === 'ArrowRight'
                      ? position + 1
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? items.length - 1
                          : null
                if (target === null) return
                event.preventDefault()
                move(item.id, target)
                requestAnimationFrame(() => {
                  rowRef.current
                    ?.querySelector<HTMLButtonElement>(`[data-order-id="${item.id}"]`)
                    ?.focus()
                })
              }}
            >
              {item.icon}
            </Button>
          )
        })}
      </div>
      <Separator spacing="compact" />
      <div className={styles.settings} role="group" aria-label="Reorder actions">
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label="Move earlier"
          tooltip="Move earlier"
          disabled={index === 0}
          onClick={() => move(selected, index - 1)}
        >
          <ArrowLeftIcon size={16} />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label="Move later"
          tooltip="Move later"
          disabled={index === items.length - 1}
          onClick={() => move(selected, index + 1)}
        >
          <ArrowRightIcon size={16} />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Reset ${label.toLowerCase()}`}
          tooltip={`Reset ${label.toLowerCase()}`}
          onClick={() => saveOrder(defaultOrder)}
        >
          <ReloadIcon size={16} />
        </Button>
      </div>
      <div className={styles.heading} role="status">
        {items[index]?.label} · {index + 1} of {items.length}
      </div>
    </>
  )
}
