/** Syntax-aware CSS edits, dispatched through the editor's ordinary change path. */
import { cssLanguage } from '@codemirror/lang-css'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { getLockedRanges } from './lockedRegions'
import type { CssToolbarCommand, CssToolbarContext, CssToolbarResult } from './cssToolbarTypes'

function overlapsLock(state: EditorState, from: number, to: number): boolean {
  return getLockedRanges(state).some((range) => from < range.to && to > range.from)
}

function readContext(state: EditorState) {
  const tree = ensureSyntaxTree(state, state.doc.length, 100)
  const rules: SyntaxNode[] = []
  let invalid = !tree
  tree?.iterate({
    enter(node) {
      if (node.type.isError) invalid = true
      if (node.name === 'RuleSet') rules.push(node.node)
    },
  })
  const head = state.selection.main.head
  // Deepest containing block wins, including declarations in nested conditions.
  let block: SyntaxNode | null = null
  let cursor = tree?.resolveInner(head, -1) ?? null
  while (cursor) {
    if (cursor.name === 'Block') {
      block = cursor
      break
    }
    cursor = cursor.parent
  }
  const rule = rules.filter((node) => node.from <= head && head <= node.to).at(-1) ?? null
  if (rule && (!block || block.from < rule.from)) block = rule.getChild('Block')
  // Between rules there is deliberately no implicit target.
  const label = (node: SyntaxNode) =>
    state.sliceDoc(node.from, node.getChild('Block')?.from ?? node.to).trim()
  const declarations: Record<string, string> = {}
  for (const node of block?.getChildren('Declaration') ?? []) {
    const property = node.getChild('PropertyName') ?? node.getChild('VariableName')
    const colon = node.getChild(':')
    if (property && colon)
      declarations[state.sliceDoc(property.from, property.to)] = state
        .sliceDoc(colon.to, node.to)
        .trim()
  }
  const canEdit =
    !!rule && !!block && !invalid && !state.readOnly && !overlapsLock(state, block.from, block.to)
  const context: CssToolbarContext = {
    rules: rules.map((node) => ({
      from: node.from,
      label: label(node),
      locked: overlapsLock(state, node.from, node.to),
    })),
    activeRule: rule ? label(rule) : null,
    declarations,
    canEdit,
    canWrap:
      canEdit && !!rule && label(rule) !== 'element' && !overlapsLock(state, rule.from, rule.to),
  }
  return { context, rule, block }
}

export function cssToolbarContext(state: EditorState): CssToolbarContext {
  return readContext(state).context
}

export function runCssToolbarCommand(
  view: EditorView,
  command: CssToolbarCommand,
): CssToolbarResult {
  const { state } = view
  const { context, rule, block } = readContext(state)
  if (command.kind === 'navigate') {
    const target = context.rules.find((item) => item.from === command.from)
    if (!target) return { ok: false, error: 'This rule has changed. Reopen the rule list.' }
    view.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    })
    view.focus()
    return { ok: true }
  }
  if (!context.canEdit || !rule || !block) {
    return { ok: false, error: 'Place the cursor in an editable CSS rule with valid syntax.' }
  }
  let changes: Array<{ from: number; to?: number; insert: string }>
  let anchor: number
  if (command.kind === 'wrap') {
    if (!context.canWrap)
      return {
        ok: false,
        error: 'Inline styles cannot have conditions. Choose a class or selector rule.',
      }
    // Only condition kinds supported by the stylesheet registry are offered.
    const source = state.sliceDoc(rule.from, rule.to)
    const insert = `${command.condition} {\n${source
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}\n}`
    changes = [{ from: rule.from, to: rule.to, insert }]
    anchor = rule.from + command.condition.length + 5
  } else {
    for (const [property, value] of Object.entries(command.declarations)) {
      const source = `.rule { ${property}: ${value}; }`
      const parsed = cssLanguage.parser.parse(source)
      let invalid = false
      parsed.iterate({
        enter(node) {
          if (node.type.isError) invalid = true
        },
      })
      const body = parsed.topNode.firstChild?.getChild('Block')
      if (
        !/^(?:--[\w-]+|-?[a-z][a-z-]*)$/.test(property) ||
        !value.trim() ||
        invalid ||
        parsed.topNode.firstChild?.nextSibling != null ||
        body?.getChildren('Declaration').length !== 1 ||
        body.getChild('RuleSet') ||
        body.to !== source.length
      ) {
        return { ok: false, error: 'Enter one valid CSS value for each property.' }
      }
    }
    changes = []
    // Remove direct occurrences only. Nested rules, comments and other properties survive.
    for (const node of block.getChildren('Declaration')) {
      const property = node.getChild('PropertyName') ?? node.getChild('VariableName')
      if (!property || !(state.sliceDoc(property.from, property.to) in command.declarations))
        continue
      const to = state.sliceDoc(node.to, node.to + 1) === ';' ? node.to + 1 : node.to
      const firstLine = state.doc.lineAt(node.from)
      const lastLine = state.doc.lineAt(to)
      const wholeLine =
        !state.sliceDoc(firstLine.from, node.from).trim() &&
        !state.sliceDoc(to, lastLine.to).trim() &&
        lastLine.to < block.to - 1
      changes.push({
        from: wholeLine ? firstLine.from : node.from,
        to: wholeLine ? lastLine.to + 1 : to,
        insert: '',
      })
    }
    const end = block.to - 1
    const last = block.getChildren('Declaration').at(-1)
    const needsSemicolon =
      last &&
      state.sliceDoc(last.to, end).trim() === '' &&
      !changes.some(
        (change) => change.from <= last.from && change.to !== undefined && change.to >= last.to,
      )
    if (needsSemicolon) changes.push({ from: last.to, insert: ';' })
    const indent = state.doc.lineAt(block.from).text.match(/^\s*/)?.[0] ?? ''
    const closingLine = state.doc.lineAt(end)
    const ownLine = !state.sliceDoc(closingLine.from, end).trim()
    const insert = `${ownLine ? '' : '\n'}${Object.entries(command.declarations)
      .map(([property, value]) => `${indent}  ${property}: ${value};`)
      .join('\n')}\n${indent}`
    changes.push({ from: ownLine ? closingLine.from : end, to: end, insert })
    anchor = state.changes(changes).mapPos(end, 1) - indent.length - 1
  }
  const transaction = state.update({
    changes,
    selection: { anchor },
    scrollIntoView: true,
    userEvent: 'input.css-toolbar',
  })
  if (!transaction.docChanged) return { ok: false, error: 'This CSS rule is read-only.' }
  view.dispatch(transaction)
  view.focus()
  return { ok: true }
}
