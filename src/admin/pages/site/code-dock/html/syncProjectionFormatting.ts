import { parser } from '@lezer/html'
import type { SyntaxNode } from '@lezer/common'
import { applyDocumentChanges, type DocumentChange } from '@site/code-editor'

interface Tag {
  node: SyntaxNode
  name: string
  rawParent: boolean
}

const RAW_ELEMENTS = new Set(['pre', 'textarea', 'script', 'style'])

function tagsIn(text: string): Tag[] | null {
  const tags: Tag[] = []
  let invalid = false
  parser.parse(text).iterate({
    enter({ node }) {
      if (node.type.isError) invalid = true
      if (!['OpenTag', 'CloseTag', 'SelfClosingTag'].includes(node.name)) return
      const nameNode = node.getChild('TagName')
      const name = nameNode ? text.slice(nameNode.from, nameNode.to) : ''
      let parent = node.parent
      let rawParent = RAW_ELEMENTS.has(name)
      while (parent && !rawParent) {
        const parentName = parent.getChild('OpenTag')?.getChild('TagName')
        rawParent = !!parentName && RAW_ELEMENTS.has(text.slice(parentName.from, parentName.to))
        parent = parent.parent
      }
      tags.push({ node, name, rawParent })
      return false
    },
  })
  return invalid ? null : tags
}

/**
 * Keep the author's whitespace while synchronizing a projection with the same
 * element structure. Attribute changes (including newly assigned uids) patch
 * their source ranges; raw text is always synchronized verbatim. Structural
 * changes use the freshly rendered projection rather than guessing at a match.
 */
export function syncProjectionFormatting(current: string, projected: string): string {
  const oldTags = tagsIn(current)
  const newTags = tagsIn(projected)
  if (!oldTags || !newTags || oldTags.length !== newTags.length) return projected
  const changes: DocumentChange[] = []
  let oldEnd = 0
  let newEnd = 0

  function syncGap(oldTo: number, newTo: number, raw: boolean) {
    const before = current.slice(oldEnd, oldTo)
    const after = projected.slice(newEnd, newTo)
    if (before === after || (!raw && before.trim() === after.trim())) return
    changes.push({ from: oldEnd, to: oldTo, insert: after })
  }

  for (let i = 0; i < oldTags.length; i++) {
    const oldTag = oldTags[i]
    const newTag = newTags[i]
    if (oldTag.name !== newTag.name || oldTag.node.name !== newTag.node.name) return projected
    syncGap(oldTag.node.from, newTag.node.from, oldTag.rawParent || newTag.rawParent)
    const oldAttrs = oldTag.node.getChildren('Attribute')
    const newAttrs = newTag.node.getChildren('Attribute')
    const nameOf = (node: SyntaxNode, text: string) => {
      const name = node.getChild('AttributeName')
      return name ? text.slice(name.from, name.to).toLowerCase() : ''
    }
    const remaining = new Map(newAttrs.map((attr) => [nameOf(attr, projected), attr]))
    let previousAttrEnd = oldTag.node.getChild('TagName')?.to ?? oldTag.node.from
    for (const attr of oldAttrs) {
      const leadingFrom = previousAttrEnd
      previousAttrEnd = attr.to
      const fresh = remaining.get(nameOf(attr, current))
      if (!fresh) {
        changes.push({ from: leadingFrom, to: attr.to, insert: '' })
        continue
      }
      remaining.delete(nameOf(attr, current))
      const oldValue = attr.getChild('AttributeValue')
      const newValue = fresh.getChild('AttributeValue')
      const from = oldValue && newValue ? oldValue.from : attr.from
      const to = oldValue && newValue ? oldValue.to : attr.to
      const insert = newValue && oldValue
        ? projected.slice(newValue.from, newValue.to)
        : projected.slice(fresh.from, fresh.to)
      if (current.slice(from, to) !== insert) changes.push({ from, to, insert })
    }
    if (remaining.size > 0) {
      const name = oldTag.node.getChild('TagName')!
      const gap = oldAttrs.length ? current.slice(name.to, oldAttrs[0].from) : ' '
      const separator = gap.includes('\n') ? gap : ' '
      changes.push({
        from: name.to,
        to: name.to,
        insert: [...remaining.values()].map((attr) => separator + projected.slice(attr.from, attr.to)).join(''),
      })
    }
    oldEnd = oldTag.node.to
    newEnd = newTag.node.to
  }
  syncGap(current.length, projected.length, false)
  return applyDocumentChanges(current, changes.sort((a, b) => a.from - b.from || a.to - b.to))
}
