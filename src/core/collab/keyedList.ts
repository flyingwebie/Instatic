/**
 * Keyed lists — shell fields that are arrays of `{ id }` records, stored one
 * record per Y.Map entry plus an order array.
 *
 * A plain shell value is one LWW slot: changing any record rewrites, and
 * re-sends, the whole array. For `site.files` that meant every save of one
 * stylesheet shipped every script and stylesheet of the site in a single sync
 * frame, and a site whose files totalled more than the frame ceiling could no
 * longer save any file at all. Stored per record, an edit ships only the
 * record that changed, and two editors changing different files merge.
 *
 * Layout: `Y.Map { entries: Y.Map<id, record>, order: Y.Array<id> }`.
 */
import * as Y from 'yjs'
import { own } from './nodeY'

interface KeyedRecord {
  id: string
}

function isKeyedRecord(value: unknown): value is KeyedRecord {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
}

export function buildKeyedList(records: readonly unknown[]): Y.Map<unknown> {
  const entries = new Y.Map<unknown>()
  // Deduped through a Set: a Y.Map cannot be read before it joins a doc.
  const ids = new Set<string>()
  for (const record of records) {
    if (!isKeyedRecord(record) || ids.has(record.id)) continue
    entries.set(record.id, record)
    ids.add(record.id)
  }
  const order = new Y.Array<string>()
  order.push([...ids])
  const list = new Y.Map<unknown>()
  list.set('entries', entries)
  list.set('order', order)
  return list
}

/**
 * Members in `order`, deduped, without ids that have no entry, followed by
 * entries the order does not name (sorted, so every peer projects the same
 * array from converged state).
 */
export function projectKeyedList(list: Y.Map<unknown>): unknown[] {
  const entries = list.get('entries')
  if (!(entries instanceof Y.Map)) return []
  const order = list.get('order')
  const rawOrder = order instanceof Y.Array ? (order.toArray() as unknown[]) : []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of rawOrder) {
    if (typeof id !== 'string' || seen.has(id) || !entries.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  ids.push(...[...entries.keys()].filter((id) => !seen.has(id)).sort())
  return ids.map((id) => own(entries.get(id)))
}

/**
 * Write only what changed between `pre` and `next`. Records are compared by
 * reference: the store's structural sharing gives an untouched record the same
 * object in both snapshots.
 */
export function applyKeyedListDiff(
  list: Y.Map<unknown>,
  pre: readonly KeyedRecord[],
  next: readonly KeyedRecord[],
  applyOrderDiff: (order: Y.Array<string>, pre: readonly string[], next: readonly string[]) => void,
): void {
  let entries = list.get('entries')
  if (!(entries instanceof Y.Map)) {
    entries = new Y.Map<unknown>()
    list.set('entries', entries)
  }
  const entryMap = entries as Y.Map<unknown>
  const preById = new Map(pre.map((record) => [record.id, record]))
  const nextIds = new Set(next.map((record) => record.id))
  for (const record of next) {
    if (preById.get(record.id) !== record || !entryMap.has(record.id)) entryMap.set(record.id, record)
  }
  for (const id of [...entryMap.keys()]) {
    if (!nextIds.has(id)) entryMap.delete(id)
  }

  let order = list.get('order')
  if (!(order instanceof Y.Array)) {
    order = new Y.Array<string>()
    list.set('order', order)
  }
  applyOrderDiff(
    order as Y.Array<string>,
    pre.map((record) => record.id),
    next.map((record) => record.id),
  )
}
