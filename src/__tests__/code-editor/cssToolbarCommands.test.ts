import { afterEach, describe, expect, it } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { css } from '@codemirror/lang-css'
import { cssToolbarContext, runCssToolbarCommand } from '@site/code-editor/cssToolbarCommands'
import { lockedRegions } from '@site/code-editor/lockedRegions'

const views: EditorView[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
})
function editor(doc: string, cursor: string, lockedFrom?: number) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.indexOf(cursor) },
      extensions: [
        css(),
        ...(lockedFrom === undefined
          ? []
          : [lockedRegions([{ from: lockedFrom, to: doc.length }])]),
      ],
    }),
    parent: document.body,
  })
  views.push(view)
  return view
}
const set = (view: EditorView, declarations: Record<string, string>) =>
  runCssToolbarCommand(view, { kind: 'declarations', declarations })

describe('CSS toolbar commands', () => {
  it('updates only the cursor rule, keeping nested declarations, comments, and neighbouring rules', () => {
    const view = editor(
      '.a {\n  color: red;\n  /* keep */\n  &:hover { color: blue; }\n}\n.b { color: green; }',
      'color: red',
    )
    expect(set(view, { color: 'purple', display: 'flex' })).toEqual({ ok: true })
    expect(view.state.doc.toString()).toContain('/* keep */')
    expect(view.state.doc.toString()).toContain('&:hover { color: blue; }')
    expect(view.state.doc.toString()).toContain('.b { color: green; }')
    expect(cssToolbarContext(view.state).declarations.color).toBe('purple')
    expect(view.state.doc.toString()).not.toContain('color: red')
  })

  it('targets nested conditions rather than changing base declarations', () => {
    const view = editor('.a { color: red; @media (width < 600px) { color: blue; } }', 'color: blue')
    expect(set(view, { color: 'green' }).ok).toBe(true)
    expect(view.state.doc.toString()).toContain('.a { color: red;')
    expect(cssToolbarContext(view.state).declarations.color).toBe('green')
  })

  it('handles missing final semicolons, custom properties, duplicate declarations and repeated actions', () => {
    const view = editor(
      '.a {\n  color: red;\n  color: blue !important;\n  --space: 1rem;\n  width: 10px\n}',
      'color: red',
    )
    expect(set(view, { color: 'green', '--space': '2rem', display: 'grid' }).ok).toBe(true)
    expect(view.state.doc.toString()).toContain('width: 10px')
    expect(cssToolbarContext(view.state).canEdit).toBe(true)
    expect(cssToolbarContext(view.state).declarations['--space']).toBe('2rem')
    const once = view.state.doc.toString()
    expect(set(view, { color: 'green', '--space': '2rem', display: 'grid' }).ok).toBe(true)
    expect(view.state.doc.toString()).toBe(once)
    expect(once.match(/color:/g)).toHaveLength(1)
  })

  it('navigates to nested selectors without applying declarations to their parent block', () => {
    const view = editor(
      '@media (width < 600px) { .a { color: red; .child { color: blue; } } }',
      'color: red',
    )
    const rule = cssToolbarContext(view.state).rules.find((item) => item.label === '.child')!
    expect(runCssToolbarCommand(view, { kind: 'navigate', from: rule.from }).ok).toBe(true)
    expect(set(view, { color: 'green' }).ok).toBe(true)
    expect(view.state.doc.toString()).toContain('.a { color: red;')
    expect(cssToolbarContext(view.state).activeRule).toBe('.child')
    expect(cssToolbarContext(view.state).declarations.color).toBe('green')
  })

  it('rejects property injection without changing the buffer', () => {
    const view = editor('.a { color: red; }', 'color')
    const before = view.state.doc.toString()
    expect(set(view, { color: 'blue; display: none' }).ok).toBe(false)
    expect(set(view, { color: 'blue; } .b { display: none' }).ok).toBe(false)
    expect(view.state.doc.toString()).toBe(before)
  })

  it('keeps locked rules protected after offsets shift, while navigation still works', () => {
    const source = '.a { color: red; }\n.locked { color: blue; }'
    const view = editor(source, 'color: red', source.indexOf('.locked'))
    expect(set(view, { padding: '2rem' }).ok).toBe(true)
    const rule = cssToolbarContext(view.state).rules.find((item) => item.label === '.locked')!
    expect(rule.locked).toBe(true)
    expect(runCssToolbarCommand(view, { kind: 'navigate', from: rule.from }).ok).toBe(true)
    const before = view.state.doc.toString()
    expect(set(view, { color: 'green' }).ok).toBe(false)
    expect(view.state.doc.toString()).toBe(before)
  })

  it('wraps a selector in a condition but refuses inline styles and invalid documents', () => {
    const view = editor('/* keep origin */\n.a { color: red; }', 'color')
    expect(
      runCssToolbarCommand(view, { kind: 'wrap', condition: '@container (min-width: 40rem)' }).ok,
    ).toBe(true)
    expect(view.state.doc.toString()).toBe(
      '/* keep origin */\n@container (min-width: 40rem) {\n  .a { color: red; }\n}',
    )
    const inline = editor('element { color: red; }', 'color')
    expect(runCssToolbarCommand(inline, { kind: 'wrap', condition: '@media print' }).ok).toBe(false)
    expect(set(editor('.a { color: red;', 'color'), { color: 'blue' }).ok).toBe(false)
  })
})
