import { useId, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { TextStartTIcon } from 'pixel-art-icons/icons/text-start-t'
import { TextAlignCenterIcon } from 'pixel-art-icons/icons/text-align-center'
import { ColorsSwatchSolidIcon } from 'pixel-art-icons/icons/colors-swatch-solid'
import { PaintBucketSolidIcon } from 'pixel-art-icons/icons/paint-bucket-solid'
import { RulerDimensionSolidIcon } from 'pixel-art-icons/icons/ruler-dimension-solid'
import { ArrowsScaleIcon } from 'pixel-art-icons/icons/arrows-scale'
import { LayoutSolidIcon } from 'pixel-art-icons/icons/layout-solid'
import { MoveIcon } from 'pixel-art-icons/icons/move'
import { CodeIcon } from 'pixel-art-icons/icons/code'
import { BulletlistSolidIcon } from 'pixel-art-icons/icons/bulletlist-solid'
import { BoldIcon } from 'pixel-art-icons/icons/bold'
import { ItalicIcon } from 'pixel-art-icons/icons/italic'
import { UnderlineIcon } from 'pixel-art-icons/icons/underline'
import { StrikeIcon } from 'pixel-art-icons/icons/strike'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { ColorInput } from '@ui/components/ColorInput'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  MenuSearchHeader,
} from '@ui/components/ContextMenu'
import { Separator } from '@ui/components/Separator'
import type { CssToolbarCommand, CssToolbarContext } from '@site/code-editor/cssToolbarTypes'
import { CSS_TOOLS, CSS_CONDITIONS, type CssTool, type CssPreset } from './cssToolbarCatalog'
import styles from './CssToolbar.module.css'

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  type: TextStartTIcon,
  alignment: TextAlignCenterIcon,
  color: ColorsSwatchSolidIcon,
  effects: PaintBucketSolidIcon,
  spacing: RulerDimensionSolidIcon,
  size: ArrowsScaleIcon,
  layout: LayoutSolidIcon,
  position: MoveIcon,
}

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

function PropertyForm({
  tool,
  context,
  run,
}: {
  tool: CssTool
  context: CssToolbarContext
  run: (command: CssToolbarCommand) => void
}) {
  const [property, setProperty] = useState(tool.property)
  const [value, setValue] = useState(context.declarations[tool.property] ?? '')
  const [error, setError] = useState('')
  const id = useId()
  const submit = () => {
    const name = property.trim()
    const next = value.trim()
    if (!/^--[\w-]+$|^-?[a-z][a-z-]*$/.test(name) || !next) {
      setError('Enter a CSS property and value.')
      return
    }
    if (typeof CSS !== 'undefined' && !CSS.supports(name, next.replace(/\s*!important\s*$/, ''))) {
      setError('This property or value is not supported by your browser.')
      return
    }
    run({ kind: 'declarations', declarations: { [name]: next } })
  }
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label htmlFor={`${id}-property`}>Property</label>
      <Input
        id={`${id}-property`}
        fieldSize="sm"
        monospace
        value={property}
        onChange={(event) => {
          setProperty(event.target.value)
          setError('')
        }}
      />
      <label htmlFor={`${id}-value`}>Value</label>
      <div className={styles.valueRow}>
        {tool.id === 'color' && (
          <ColorInput
            aria-label="Choose color"
            value={value}
            swatchValue={value}
            onChange={(event) => {
              setValue(event.target.value)
              setError('')
            }}
          />
        )}
        <Input
          id={`${id}-value`}
          fieldSize="sm"
          monospace
          placeholder="CSS value or var(--token)"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setError('')
          }}
        />
      </div>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
      <Button type="submit" variant="secondary" size="sm">
        Apply property
      </Button>
    </form>
  )
}

function ToolMenu({
  tool,
  context,
  run,
}: {
  tool: CssTool
  context: CssToolbarContext
  run: (command: CssToolbarCommand) => void
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const Icon = ICONS[tool.id]
  const close = () => {
    setOpen(false)
    anchorRef.current?.focus()
  }
  const apply = (command: CssToolbarCommand) => {
    setOpen(false)
    run(command)
  }
  return (
    <>
      <Button
        ref={anchorRef}
        variant="ghost"
        size="xs"
        iconOnly
        aria-label={tool.label}
        tooltip={tool.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!context.canEdit}
        onClick={() => setOpen(!open)}
      >
        <Icon size={16} />
      </Button>
      {open && (
        <ContextMenu
          anchorRef={anchorRef}
          ariaLabel={tool.label}
          role="dialog"
          onClose={close}
          width={280}
          maxHeight={440}
          onKeyDown={menuKeys}
        >
          <div className={styles.heading}>{tool.label}</div>
          <div role="menu" aria-label={`${tool.label} presets`}>
            {tool.presets.map((preset, index) => (
              <ContextMenuItem
                key={preset.label}
                autoFocus={index === 0}
                onClick={() => apply(preset.command)}
              >
                {preset.label}
              </ContextMenuItem>
            ))}
          </div>
          <ContextMenuSeparator />
          <PropertyForm tool={tool} context={context} run={apply} />
        </ContextMenu>
      )}
    </>
  )
}

function RuleMenu({
  context,
  run,
  conditions,
}: {
  context: CssToolbarContext
  run: (command: CssToolbarCommand) => void
  conditions: CssPreset[]
}) {
  const [open, setOpen] = useState<'rules' | 'conditions' | null>(null)
  const [query, setQuery] = useState('')
  const rulesRef = useRef<HTMLButtonElement>(null)
  const conditionsRef = useRef<HTMLButtonElement>(null)
  const close = () => {
    ;(open === 'rules' ? rulesRef : conditionsRef).current?.focus()
    setOpen(null)
  }
  const apply = (command: CssToolbarCommand) => {
    setOpen(null)
    run(command)
  }
  const rules = context.rules.filter((rule) =>
    rule.label.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <>
      <Button
        ref={conditionsRef}
        variant="ghost"
        size="xs"
        iconOnly
        aria-label="Conditional rules"
        tooltip={
          context.canWrap
            ? 'Wrap the current rule in a condition'
            : 'Choose an editable class or selector rule to add a condition'
        }
        aria-haspopup="menu"
        aria-expanded={open === 'conditions'}
        disabled={!context.canWrap}
        onClick={() => setOpen(open === 'conditions' ? null : 'conditions')}
      >
        <CodeIcon size={16} />
      </Button>
      <Button
        ref={rulesRef}
        variant="ghost"
        size="xs"
        iconOnly
        aria-label="Navigate CSS rules"
        tooltip="Navigate CSS rules"
        aria-haspopup="menu"
        aria-expanded={open === 'rules'}
        onClick={() => {
          setQuery('')
          setOpen(open === 'rules' ? null : 'rules')
        }}
      >
        <BulletlistSolidIcon size={16} />
      </Button>
      {open === 'conditions' && (
        <ContextMenu
          anchorRef={conditionsRef}
          ariaLabel="Conditional rules"
          onClose={close}
          width={290}
          maxHeight={380}
          onKeyDown={menuKeys}
        >
          <div className={styles.heading}>Wrap current rule</div>
          {[...conditions, ...CSS_CONDITIONS].map((preset, index) => (
            <ContextMenuItem
              key={preset.label}
              autoFocus={index === 0}
              onClick={() => apply(preset.command)}
            >
              {preset.label}
            </ContextMenuItem>
          ))}
        </ContextMenu>
      )}
      {open === 'rules' && (
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
  const decoration = (
    context.declarations['text-decoration-line'] ??
    context.declarations['text-decoration'] ??
    ''
  ).replace(/\s*!important\s*$/, '')
  const toggles = [
    {
      label: 'Bold',
      Icon: BoldIcon,
      property: 'font-weight',
      value: '700',
      off: '400',
      active: /^(bold|[7-9]00)(\s*!important)?$/.test(context.declarations['font-weight'] ?? ''),
    },
    {
      label: 'Italic',
      Icon: ItalicIcon,
      property: 'font-style',
      value: 'italic',
      off: 'normal',
      active: context.declarations['font-style']?.startsWith('italic'),
    },
    ...[
      { label: 'Underline', Icon: UnderlineIcon, token: 'underline' },
      { label: 'Strikethrough', Icon: StrikeIcon, token: 'line-through' },
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
  return (
    <div className={styles.root} data-testid="css-toolbar">
      <div className={styles.controls} role="group" aria-label="CSS tools">
        <div className={styles.group} role="group" aria-label="Text tools">
          {CSS_TOOLS.slice(0, 2).map((tool) => (
            <ToolMenu key={tool.id} tool={tool} context={context} run={run} />
          ))}
          {toggles.map(({ label, Icon, property, value, off, active }) => (
            <Button
              key={label}
              variant="ghost"
              size="xs"
              iconOnly
              aria-label={label}
              tooltip={label}
              pressed={!!active}
              disabled={!context.canEdit}
              onClick={() =>
                run({ kind: 'declarations', declarations: { [property]: active ? off : value } })
              }
            >
              <Icon size={16} />
            </Button>
          ))}
        </div>
        <Separator orientation="vertical" spacing="compact" />
        <div className={styles.group} role="group" aria-label="Appearance and box tools">
          {CSS_TOOLS.slice(2, 6).map((tool) => (
            <ToolMenu key={tool.id} tool={tool} context={context} run={run} />
          ))}
        </div>
        <Separator orientation="vertical" spacing="compact" />
        <div className={styles.group} role="group" aria-label="Layout and rule tools">
          {CSS_TOOLS.slice(6).map((tool) => (
            <ToolMenu key={tool.id} tool={tool} context={context} run={run} />
          ))}
          <RuleMenu context={context} run={run} conditions={conditions} />
        </div>
      </div>
      <div className={styles.target} title={context.activeRule ?? undefined}>
        {context.activeRule
          ? `Target: ${context.activeRule}${context.canEdit ? '' : ' · read-only or invalid CSS'}`
          : 'Choose a rule in the code or rule navigator'}
      </div>
    </div>
  )
}
