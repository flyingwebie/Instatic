import type { CssToolbarCommand } from '@site/code-editor/cssToolbarTypes'
import type { CssToolbarIcon } from './cssToolbarIcons'

export interface CssPreset {
  label: string
  icon: CssToolbarIcon
  badge?: number
  command: CssToolbarCommand
}

export interface CssTool {
  id: 'type' | 'alignment' | 'color' | 'effects' | 'spacing' | 'size' | 'layout' | 'position'
  label: string
  property: string
  presets: CssPreset[]
}

function preset(
  label: string,
  icon: CssToolbarIcon,
  declarations: Record<string, string>,
): CssPreset {
  return { label, icon, command: { kind: 'declarations', declarations } }
}

/** Ordered by authoring task; values are published CSS, never editor theme tokens. */
export const CSS_TOOLS: CssTool[] = [
  {
    id: 'type',
    label: 'Typography',
    property: 'font-size',
    presets: [
      preset('System sans', 'type', { 'font-family': 'system-ui, sans-serif' }),
      preset('Serif', 'heading', { 'font-family': 'Georgia, serif' }),
      preset('Monospace', 'code', { 'font-family': 'ui-monospace, monospace' }),
      preset('Fluid heading', 'size', {
        'font-size': 'clamp(2rem, 5vw, 4rem)',
        'line-height': '1.1',
      }),
      preset('Body text', 'type', { 'font-size': '1rem', 'line-height': '1.6' }),
      preset('Medium weight', 'bold', { 'font-weight': '500' }),
      preset('Bold weight', 'bold', { 'font-weight': '700' }),
      preset('Tight tracking', 'columns', { 'letter-spacing': '-0.025em' }),
      preset('Wide tracking', 'horizontal', { 'letter-spacing': '0.1em' }),
    ],
  },
  {
    id: 'alignment',
    label: 'Text alignment',
    property: 'text-align',
    presets: [
      ...(['left', 'center', 'right', 'justify'] as const).map((value) =>
        preset(value[0].toUpperCase() + value.slice(1), value === 'center' ? 'alignment' : value, {
          'text-align': value,
        }),
      ),
    ],
  },
  {
    id: 'color',
    label: 'Colors',
    property: 'color',
    presets: [
      preset('Inherit text color', 'type', { color: 'inherit' }),
      preset('Transparent background', 'hidden', { 'background-color': 'transparent' }),
      preset('Current color border', 'square', { 'border-color': 'currentColor' }),
    ],
  },
  {
    id: 'effects',
    label: 'Effects',
    property: 'opacity',
    presets: [
      preset('Full opacity', 'visible', { opacity: '1' }),
      preset('Half opacity', 'hidden', { opacity: '0.5' }),
      preset('Soft shadow', 'effects', { 'box-shadow': '0 4px 16px rgb(0 0 0 / 0.15)' }),
      preset('Rounded corners', 'proportions', { 'border-radius': '0.5rem' }),
      preset('Subtle border', 'square', { border: '1px solid currentColor' }),
      preset('Grayscale', 'color', { filter: 'grayscale(1)' }),
      preset('No filter', 'clear', { filter: 'none' }),
    ],
  },
  {
    id: 'spacing',
    label: 'Spacing',
    property: 'padding',
    presets: [
      preset('Compact padding', 'spacing', { padding: '0.5rem' }),
      preset('Comfortable padding', 'container', { padding: '1.5rem' }),
      preset('Section padding', 'vertical', { 'padding-block': 'clamp(2rem, 6vw, 6rem)' }),
      preset('Center with auto margins', 'center', { 'margin-inline': 'auto' }),
      preset('Vertical margin', 'vertical', { 'margin-block': '1rem' }),
      preset('Small gap', 'horizontal', { gap: '0.5rem' }),
      preset('Large gap', 'horizontal', { gap: '2rem' }),
    ],
  },
  {
    id: 'size',
    label: 'Dimensions',
    property: 'width',
    presets: [
      preset('Full width', 'horizontal', { width: '100%' }),
      preset('Fit content', 'container', { width: 'fit-content' }),
      preset('Readable measure', 'columns', { 'max-width': '65ch' }),
      preset('Full viewport height', 'monitor', { 'min-height': '100dvh' }),
      preset('Automatic height', 'vertical', { height: 'auto' }),
      preset('Square', 'square', { 'aspect-ratio': '1' }),
      preset('Widescreen', 'proportions', { 'aspect-ratio': '16 / 9' }),
    ],
  },
  {
    id: 'layout',
    label: 'Layout',
    property: 'display',
    presets: [
      preset('Horizontal flex', 'horizontal', {
        display: 'flex',
        'flex-direction': 'row',
        gap: '1rem',
      }),
      preset('Vertical flex', 'vertical', {
        display: 'flex',
        'flex-direction': 'column',
        gap: '1rem',
      }),
      preset('Display grid', 'grid', { display: 'grid' }),
      preset('Center children', 'center', {
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
      }),
      preset('Wrapping flex', 'wrap', { display: 'flex', 'flex-wrap': 'wrap', gap: '1rem' }),
      preset('Block', 'square', { display: 'block' }),
      preset('Query container', 'container', { 'container-type': 'inline-size' }),
    ],
  },
  {
    id: 'position',
    label: 'Position',
    property: 'position',
    presets: [
      preset('Relative', 'position', { position: 'relative' }),
      preset('Absolute fill', 'size', { position: 'absolute', inset: '0' }),
      preset('Sticky top', 'top', { position: 'sticky', top: '0' }),
      preset('Fixed bottom', 'bottom', { position: 'fixed', bottom: '0', 'inset-inline': '0' }),
      preset('Static', 'square', { position: 'static' }),
      preset('Contain overflow', 'hidden', { overflow: 'hidden' }),
    ],
  },
]

export const CSS_CONDITIONS: CssPreset[] = [
  {
    label: 'Small screens (≤ 48rem)',
    icon: 'phone',
    command: { kind: 'wrap', condition: '@media (max-width: 48rem)' },
  },
  {
    label: 'Large screens (≥ 64rem)',
    icon: 'monitor',
    command: { kind: 'wrap', condition: '@media (min-width: 64rem)' },
  },
  {
    label: 'Reduced motion',
    icon: 'hidden',
    command: { kind: 'wrap', condition: '@media (prefers-reduced-motion: reduce)' },
  },
  {
    label: 'Dark color scheme',
    icon: 'color',
    command: { kind: 'wrap', condition: '@media (prefers-color-scheme: dark)' },
  },
  {
    label: 'Narrow container (≤ 40rem)',
    icon: 'container',
    command: { kind: 'wrap', condition: '@container (max-width: 40rem)' },
  },
  {
    label: 'Wide container (≥ 40rem)',
    icon: 'container',
    command: { kind: 'wrap', condition: '@container (min-width: 40rem)' },
  },
  {
    label: 'Grid supported',
    icon: 'grid',
    command: { kind: 'wrap', condition: '@supports (display: grid)' },
  },
  {
    label: 'Subgrid supported',
    icon: 'grid',
    command: { kind: 'wrap', condition: '@supports (grid-template-columns: subgrid)' },
  },
]

/** Grid presets set the track count without resetting authored rows or gaps. */
export const CSS_GRID_PRESETS: CssPreset[] = [
  ...[1, 2, 3, 4, 6].map((count): CssPreset => ({
    label: `Grid-${count}: ${count} ${count === 1 ? 'column' : 'columns'}`,
    icon: 'grid',
    badge: count,
    command: {
      kind: 'declarations',
      declarations: {
        display: 'grid',
        'grid-template-columns': `repeat(${count}, minmax(0, 1fr))`,
      },
    },
  })),
  preset('Responsive grid', 'size', {
    display: 'grid',
    'grid-template-columns': 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
  }),
]

export interface CssPropertyControl {
  label: string
  property: string
  icon: CssToolbarIcon
  kind?: 'count' | 'color'
  custom?: boolean
}

export const CSS_GRID_CONTROLS: CssPropertyControl[] = [
  { label: 'Grid columns', property: 'grid-template-columns', icon: 'columns', kind: 'count' },
  { label: 'Grid rows', property: 'grid-template-rows', icon: 'rows', kind: 'count' },
  { label: 'Column gap', property: 'column-gap', icon: 'horizontal' },
  { label: 'Row gap', property: 'row-gap', icon: 'vertical' },
]
