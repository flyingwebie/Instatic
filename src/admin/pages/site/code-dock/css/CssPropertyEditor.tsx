import { useId, useState } from 'react'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { ColorInput } from '@ui/components/ColorInput'
import type { CssToolbarCommand, CssToolbarContext } from '@site/code-editor/cssToolbarTypes'
import type { CssPropertyControl } from './cssToolbarCatalog'
import styles from './CssToolbar.module.css'

export function CssPropertyEditor({
  control,
  context,
  custom,
  run,
}: {
  control: CssPropertyControl
  context: CssToolbarContext
  custom: boolean
  run: (command: CssToolbarCommand) => void
}) {
  const authoredValue = context.declarations[control.property] ?? ''
  const isCount = control.kind === 'count'
  const [property, setProperty] = useState(control.property)
  const [value, setValue] = useState(
    isCount ? (authoredValue.match(/^repeat\(\s*(\d+)\s*,/)?.[1] ?? '') : authoredValue,
  )
  const [error, setError] = useState('')
  const id = useId()
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        const name = property.trim()
        let next = value.trim()
        if (isCount) {
          const count = Number(next)
          if (!Number.isInteger(count) || count < 1 || count > 24) {
            setError('Enter a track count from 1 to 24.')
            return
          }
          next = `repeat(${count}, minmax(0, 1fr))`
        }
        if (!/^(?:--[\w-]+|-?[a-z][a-z-]*)$/.test(name) || !next) {
          setError('Enter a CSS property and value.')
          return
        }
        if (
          typeof CSS !== 'undefined' &&
          !CSS.supports(name, next.replace(/\s*!important\s*$/, ''))
        ) {
          setError('This property or value is not supported by your browser.')
          return
        }
        run({
          kind: 'declarations',
          declarations: { ...(isCount ? { display: 'grid' } : {}), [name]: next },
        })
      }}
    >
      {custom && (
        <>
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
        </>
      )}
      <label htmlFor={`${id}-value`}>{custom ? 'Value' : control.label}</label>
      <div className={styles.valueRow}>
        {control.kind === 'color' && (
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
          autoFocus
          fieldSize="sm"
          monospace
          type={isCount ? 'number' : 'text'}
          min={isCount ? 1 : undefined}
          max={isCount ? 24 : undefined}
          step={isCount ? 1 : undefined}
          placeholder={isCount ? 'Track count' : 'CSS value or var(--token)'}
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
        Apply
      </Button>
    </form>
  )
}
