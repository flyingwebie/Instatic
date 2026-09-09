import type { CssToolbarCommand } from '@site/code-editor/cssToolbarTypes'

export interface CssPreset {
  label: string
  command: CssToolbarCommand
}

export interface CssTool {
  id: string
  label: string
  property: string
  presets: CssPreset[]
}

function preset(label: string, declarations: Record<string, string>): CssPreset {
  return { label, command: { kind: 'declarations', declarations } }
}

/** Ordered by authoring task; values are published CSS, never editor theme tokens. */
export const CSS_TOOLS: CssTool[] = [
  {
    id: 'type',
    label: 'Typography',
    property: 'font-size',
    presets: [
      preset('System sans', { 'font-family': 'system-ui, sans-serif' }),
      preset('Serif', { 'font-family': 'Georgia, serif' }),
      preset('Monospace', { 'font-family': 'ui-monospace, monospace' }),
      preset('Fluid heading', { 'font-size': 'clamp(2rem, 5vw, 4rem)', 'line-height': '1.1' }),
      preset('Body text', { 'font-size': '1rem', 'line-height': '1.6' }),
      preset('Medium weight', { 'font-weight': '500' }),
      preset('Bold weight', { 'font-weight': '700' }),
      preset('Tight tracking', { 'letter-spacing': '-0.025em' }),
      preset('Wide tracking', { 'letter-spacing': '0.1em' }),
    ],
  },
  {
    id: 'alignment',
    label: 'Text alignment',
    property: 'text-align',
    presets: [
      ...['left', 'center', 'right', 'justify'].map((value) =>
        preset(value[0].toUpperCase() + value.slice(1), { 'text-align': value }),
      ),
    ],
  },
  {
    id: 'color',
    label: 'Colors',
    property: 'color',
    presets: [
      preset('Inherit text color', { color: 'inherit' }),
      preset('Transparent background', { 'background-color': 'transparent' }),
      preset('Current color border', { 'border-color': 'currentColor' }),
    ],
  },
  {
    id: 'effects',
    label: 'Effects',
    property: 'opacity',
    presets: [
      preset('Full opacity', { opacity: '1' }),
      preset('Half opacity', { opacity: '0.5' }),
      preset('Soft shadow', { 'box-shadow': '0 4px 16px rgb(0 0 0 / 0.15)' }),
      preset('Rounded corners', { 'border-radius': '0.5rem' }),
      preset('Subtle border', { border: '1px solid currentColor' }),
      preset('Grayscale', { filter: 'grayscale(1)' }),
      preset('No filter', { filter: 'none' }),
    ],
  },
  {
    id: 'spacing',
    label: 'Spacing',
    property: 'padding',
    presets: [
      preset('Compact padding', { padding: '0.5rem' }),
      preset('Comfortable padding', { padding: '1.5rem' }),
      preset('Section padding', { 'padding-block': 'clamp(2rem, 6vw, 6rem)' }),
      preset('Center with auto margins', { 'margin-inline': 'auto' }),
      preset('Vertical margin', { 'margin-block': '1rem' }),
      preset('Small gap', { gap: '0.5rem' }),
      preset('Large gap', { gap: '2rem' }),
    ],
  },
  {
    id: 'size',
    label: 'Dimensions',
    property: 'width',
    presets: [
      preset('Full width', { width: '100%' }),
      preset('Fit content', { width: 'fit-content' }),
      preset('Readable measure', { 'max-width': '65ch' }),
      preset('Full viewport height', { 'min-height': '100dvh' }),
      preset('Automatic height', { height: 'auto' }),
      preset('Square', { 'aspect-ratio': '1' }),
      preset('Widescreen', { 'aspect-ratio': '16 / 9' }),
    ],
  },
  {
    id: 'layout',
    label: 'Layout',
    property: 'display',
    presets: [
      preset('Horizontal flex', { display: 'flex', 'flex-direction': 'row', gap: '1rem' }),
      preset('Vertical flex', { display: 'flex', 'flex-direction': 'column', gap: '1rem' }),
      preset('Two-column grid', {
        display: 'grid',
        'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
        gap: '1rem',
      }),
      preset('Responsive grid', {
        display: 'grid',
        'grid-template-columns': 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
        gap: '1rem',
      }),
      preset('Center children', {
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
      }),
      preset('Wrapping flex', { display: 'flex', 'flex-wrap': 'wrap', gap: '1rem' }),
      preset('Block', { display: 'block' }),
      preset('Query container', { 'container-type': 'inline-size' }),
    ],
  },
  {
    id: 'position',
    label: 'Position',
    property: 'position',
    presets: [
      preset('Relative', { position: 'relative' }),
      preset('Absolute fill', { position: 'absolute', inset: '0' }),
      preset('Sticky top', { position: 'sticky', top: '0' }),
      preset('Fixed bottom', { position: 'fixed', bottom: '0', 'inset-inline': '0' }),
      preset('Static', { position: 'static' }),
      preset('Contain overflow', { overflow: 'hidden' }),
    ],
  },
]

export const CSS_CONDITIONS: CssPreset[] = [
  {
    label: 'Small screens (≤ 48rem)',
    command: { kind: 'wrap', condition: '@media (max-width: 48rem)' },
  },
  {
    label: 'Large screens (≥ 64rem)',
    command: { kind: 'wrap', condition: '@media (min-width: 64rem)' },
  },
  {
    label: 'Reduced motion',
    command: { kind: 'wrap', condition: '@media (prefers-reduced-motion: reduce)' },
  },
  {
    label: 'Dark color scheme',
    command: { kind: 'wrap', condition: '@media (prefers-color-scheme: dark)' },
  },
  {
    label: 'Narrow container (≤ 40rem)',
    command: { kind: 'wrap', condition: '@container (max-width: 40rem)' },
  },
  {
    label: 'Wide container (≥ 40rem)',
    command: { kind: 'wrap', condition: '@container (min-width: 40rem)' },
  },
  { label: 'Grid supported', command: { kind: 'wrap', condition: '@supports (display: grid)' } },
  {
    label: 'Subgrid supported',
    command: { kind: 'wrap', condition: '@supports (grid-template-columns: subgrid)' },
  },
]
