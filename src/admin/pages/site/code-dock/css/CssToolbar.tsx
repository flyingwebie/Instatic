import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { DragAndDropSolidIcon } from 'pixel-art-icons/icons/drag-and-drop-solid'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem, MenuSearchHeader } from '@ui/components/ContextMenu'
import { Separator } from '@ui/components/Separator'
import type { CssToolbarCommand, CssToolbarContext } from '@site/code-editor/cssToolbarTypes'
import {
  CSS_TOOLS,
  CSS_CONDITIONS,
  CSS_GRID_PRESETS,
  CSS_GRID_CONTROLS,
  type CssTool,
  type CssPreset,
  type CssPropertyControl,
} from './cssToolbarCatalog'
import { CSS_TOOLBAR_ICONS } from './cssToolbarIcons'
import { CssPropertyEditor } from './CssPropertyEditor'
import { useCssToolbarOrder } from './cssToolbarOrder'
import { CssToolbarOrderEditor } from './CssToolbarOrderEditor'
import styles from './CssToolbar.module.css'

function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  if (!(event.target instanceof HTMLButtonElement)) return
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
  )
  const index = items.indexOf(event.target)
  if (index < 0 || !items.length) return
  event.preventDefault()
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}

function RuleNavigator({
  context,
  run,
  onOpen,
}: {
  context: CssToolbarContext
  run: (command: CssToolbarCommand) => void
  onOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rulesRef = useRef<HTMLButtonElement>(null)
  const close = () => {
    rulesRef.current?.focus()
    setOpen(false)
  }
  const apply = (command: CssToolbarCommand) => {
    setOpen(false)
    run(command)
  }
  const rules = context.rules.filter((rule) =>
    rule.label.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <>
      <Button
        ref={rulesRef}
        variant="ghost"
        size="xs"
        iconOnly
        aria-label="Navigate CSS rules"
        tooltip="Navigate CSS rules"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          onOpen()
          setQuery('')
          setOpen(!open)
        }}
      >
        <CSS_TOOLBAR_ICONS.rows size={16} />
      </Button>
      {open && (
        <ContextMenu
          anchorRef={rulesRef}
          ariaLabel="CSS rules"
          onClose={close}
          width={290}
          maxHeight={380}
          onKeyDown={menuKeys}
          header={
            <MenuSearchHeader
              value={query}
              onValueChange={setQuery}
              placeholder="Find a selector…"
              inputRef={(node) => {
                node?.focus()
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  event.currentTarget
                    .closest('[role=menu]')
                    ?.querySelector<HTMLButtonElement>('[role=menuitem]')
                    ?.focus()
                }
                if (event.key === 'Enter' && rules[0]) {
                  event.preventDefault()
                  apply({ kind: 'navigate', from: rules[0].from })
                }
              }}
            />
          }
        >
          {rules.map((rule) => (
            <ContextMenuItem
              key={rule.from}
              onClick={() => apply({ kind: 'navigate', from: rule.from })}
            >
              <span className={styles.ruleLabel}>{rule.label}</span>
              {rule.locked && <span className={styles.readOnly}>Read-only</span>}
            </ContextMenuItem>
          ))}
          {!rules.length && <div className={styles.heading}>No matching rules</div>}
        </ContextMenu>
      )}
    </>
  )
}

export function CssToolbar({
  context,
  run,
  conditions,
}: {
  context: CssToolbarContext
  run: (command: CssToolbarCommand) => void
  conditions: CssPreset[]
}) {
  const [category, setCategory] = useState<CssTool['id'] | 'conditions' | 'order' | null>(null)
  const { items, saveOrder } = useCssToolbarOrder()
  const [editing, setEditing] = useState<CssPropertyControl | null>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const categoriesRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<CssTool['id'] | 'conditions' | 'order' | null>(null)
  // Expanded buttons change their tooltip wrapper; restore focus after that DOM update.
  useLayoutEffect(() => {
    if (category !== null) {
      // Wait until ContextMenu has measured and made the popup visible.
      const frame = requestAnimationFrame(() => {
        const target =
          popupRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ??
          popupRef.current
        target?.focus()
      })
      return () => cancelAnimationFrame(frame)
    }
    if (!restoreFocusRef.current) return
    categoriesRef.current
      ?.querySelector<HTMLButtonElement>(`[data-css-category="${restoreFocusRef.current}"]`)
      ?.focus()
    restoreFocusRef.current = null
  }, [category])
  const tool = CSS_TOOLS.find((item) => item.id === category)
  const isGrid = /^(?:inline-)?grid(?:\s*!important)?$/.test(context.declarations.display ?? '')
  const presets = tool?.presets ?? [...conditions, ...CSS_CONDITIONS]
  const decoration = (
    context.declarations['text-decoration-line'] ??
    context.declarations['text-decoration'] ??
    ''
  ).replace(/\s*!important\s*$/, '')
  const toggles = [
    {
      label: 'Bold',
      Icon: CSS_TOOLBAR_ICONS.bold,
      property: 'font-weight',
      value: '700',
      off: '400',
      active: /^(bold|[7-9]00)(\s*!important)?$/.test(context.declarations['font-weight'] ?? ''),
    },
    {
      label: 'Italic',
      Icon: CSS_TOOLBAR_ICONS.italic,
      property: 'font-style',
      value: 'italic',
      off: 'normal',
      active: context.declarations['font-style']?.startsWith('italic'),
    },
    ...[
      { label: 'Underline', Icon: CSS_TOOLBAR_ICONS.underline, token: 'underline' },
      { label: 'Strikethrough', Icon: CSS_TOOLBAR_ICONS.strike, token: 'line-through' },
    ].map(({ label, Icon, token }) => {
      const tokens = decoration
        .split(/\s+/)
        .filter((part) => ['underline', 'overline', 'line-through'].includes(part))
      const active = tokens.includes(token)
      return {
        label,
        Icon,
        property: 'text-decoration-line',
        value: [...tokens, token].join(' '),
        off: tokens.filter((part) => part !== token).join(' ') || 'none',
        active,
      }
    }),
  ]

  const renderPreset = (preset: CssPreset) => {
    const Icon = CSS_TOOLBAR_ICONS[preset.icon]
    const command = preset.command
    const active =
      command.kind === 'declarations' &&
      Object.entries(command.declarations).every(
        ([property, value]) =>
          context.declarations[property]?.replace(/\s*!important\s*$/, '') === value,
      )
    return (
      <Button
        key={preset.label}
        variant="ghost"
        size="xs"
        iconOnly
        aria-label={preset.label}
        tooltip={preset.label}
        pressed={active}
        disabled={command.kind === 'wrap' ? !context.canWrap : !context.canEdit}
        onClick={(event) => {
          setEditing(null)
          run(command)
          event.currentTarget.focus()
        }}
      >
        <span className={styles.presetIcon}>
          <Icon size={16} />
          {preset.badge !== undefined && (
            <span className={styles.badge} aria-hidden="true">
              {preset.badge}
            </span>
          )}
        </span>
      </Button>
    )
  }
  const propertyControl = (control: CssPropertyControl) => {
    const Icon = CSS_TOOLBAR_ICONS[control.icon]
    return (
      <Button
        key={control.property}
        variant="ghost"
        size="xs"
        iconOnly
        aria-label={control.label}
        tooltip={control.label}
        pressed={editing?.property === control.property}
        disabled={!context.canEdit}
        onClick={() => setEditing(control)}
      >
        <Icon size={16} />
      </Button>
    )
  }
  const selectCategory = (next: CssTool['id'] | 'conditions' | 'order') => {
    if (category === next) restoreFocusRef.current = next
    setCategory(category === next ? null : next)
    setEditing(null)
  }
  return (
    <div className={styles.root} data-testid="css-toolbar">
      <div ref={categoriesRef} className={styles.toolbarRow}>
        <div className={styles.controls} role="group" aria-label="CSS categories">
          {items.map((item) => {
            if (item.id === 'navigator') {
              return (
                <RuleNavigator
                  key={item.id}
                  context={context}
                  run={run}
                  onOpen={() => {
                    setCategory(null)
                    setEditing(null)
                  }}
                />
              )
            }
            const id = item.id
            const Icon = CSS_TOOLBAR_ICONS[item.icon]
            return (
              <Button
                key={id}
                ref={category === id ? anchorRef : undefined}
                data-css-category={id}
                variant="ghost"
                size="xs"
                iconOnly
                aria-label={item.label}
                tooltip={item.label}
                aria-haspopup="dialog"
                aria-expanded={category === id}
                pressed={category === id}
                onClick={() => selectCategory(id)}
              >
                <Icon size={16} />
              </Button>
            )
          })}
        </div>
        <div className={styles.orderTrigger}>
          <Separator orientation="vertical" spacing="compact" />
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            ref={category === 'order' ? anchorRef : undefined}
            data-css-category="order"
            aria-label="Reorder CSS toolbar"
            tooltip="Reorder CSS toolbar"
            aria-haspopup="dialog"
            aria-expanded={category === 'order'}
            pressed={category === 'order'}
            onClick={() => selectCategory('order')}
          >
            <DragAndDropSolidIcon size={16} />
          </Button>
        </div>
      </div>
      {category && (
        <ContextMenu
          key={category}
          anchorRef={anchorRef}
          triggerRef={categoriesRef}
          ref={popupRef}
          tabIndex={-1}
          ariaLabel={
            category === 'order' ? 'Reorder CSS toolbar' : (tool?.label ?? 'Conditional rules')
          }
          role="dialog"
          width={280}
          maxHeight={440}
          onClose={() => {
            if (popupRef.current?.contains(document.activeElement))
              restoreFocusRef.current = category
            setCategory(null)
            setEditing(null)
          }}
        >
          {category === 'order' ? (
            <CssToolbarOrderEditor items={items} saveOrder={saveOrder} />
          ) : (
            <>
              <div
                className={styles.settings}
                role="group"
                aria-label={`${tool?.label ?? 'Conditional rules'} settings`}
                data-testid="css-toolbar-settings"
              >
                {category === 'type' &&
                  toggles.map(({ label, Icon, property, value, off, active }) => (
                    <Button
                      key={label}
                      variant="ghost"
                      size="xs"
                      iconOnly
                      aria-label={label}
                      tooltip={label}
                      pressed={!!active}
                      disabled={!context.canEdit}
                      onClick={(event) => {
                        run({
                          kind: 'declarations',
                          declarations: { [property]: active ? off : value },
                        })
                        event.currentTarget.focus()
                      }}
                    >
                      <Icon size={16} />
                    </Button>
                  ))}
                {presets.map(renderPreset)}
                {tool &&
                  propertyControl({
                    label: 'Custom CSS property',
                    custom: true,
                    property: tool.property,
                    icon: 'settings',
                    ...(tool.id === 'color' ? { kind: 'color' } : {}),
                  })}
              </div>
              {category === 'layout' && isGrid && (
                <>
                  <Separator spacing="compact" />
                  <div role="group" aria-label="Grid settings">
                    <div className={styles.settings}>{CSS_GRID_PRESETS.map(renderPreset)}</div>
                    <div className={styles.settings}>{CSS_GRID_CONTROLS.map(propertyControl)}</div>
                  </div>
                </>
              )}
              {editing && (
                <>
                  <Separator spacing="compact" />
                  <CssPropertyEditor
                    key={editing.property}
                    control={editing}
                    context={context}
                    custom={!!editing.custom}
                    run={(command) => {
                      run(command)
                      setEditing(null)
                      anchorRef.current?.focus()
                    }}
                  />
                </>
              )}
            </>
          )}
        </ContextMenu>
      )}
    </div>
  )
}
