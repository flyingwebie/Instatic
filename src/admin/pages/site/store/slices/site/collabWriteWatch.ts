/**
 * Collab write watch — did a programmatic write actually reach the server?
 *
 * Interactive edits learn about a refused or reverted write from a toast. A
 * programmatic caller (an AI tool relayed from MCP or the in-editor agent)
 * gets no toast: it only sees the store, and a refused write leaves the store
 * unchanged, so the tool would report the OLD state as its result. This module
 * keeps a ledger of every write incident so such a caller can ask, after its
 * mutation, whether anything went wrong in between.
 *
 * Three incidents count:
 *   - a local write refused by the transport gate (offline / connecting /
 *     syncing),
 *   - a server reset that discarded this client's doc changes (stale lineage,
 *     a refused write, an oversize update, a deleted branch),
 *   - a delivery receipt that never came (see `CollabProvider.flush`).
 *
 * This module owns only the ledger and the wording. `collabBinding` records
 * incidents and owns the provider.
 */
import type { ResetReason } from '@core/collab'
import type { BlockedReason } from './collabNotices'

export type CollabWriteIncident =
  | { kind: 'blocked'; reason: BlockedReason }
  | { kind: 'reset'; reason: ResetReason }

export type CollabWriteReceipt = { ok: true } | { ok: false; error: string }

/** Resets that do not discard anything this client wrote. */
const HARMLESS_RESETS: ReadonlySet<ResetReason> = new Set<ResetReason>(['rewritten'])

let incidentCount = 0
let lastIncident: CollabWriteIncident | null = null

export function recordCollabWriteIncident(incident: CollabWriteIncident): void {
  if (incident.kind === 'reset' && HARMLESS_RESETS.has(incident.reason)) return
  incidentCount += 1
  lastIncident = incident
}

const BLOCKED_ERROR: Record<BlockedReason, string> = {
  offline:
    'The editor is offline, so this change was NOT applied. Wait until the editor shows "Draft synced", then retry.',
  connecting:
    'The editor is still connecting to the server, so this change was NOT applied. Retry in a few seconds.',
  syncing:
    'The document was still loading, so this change was NOT applied. Retry in a few seconds.',
}

const RESET_ERROR: Record<ResetReason, string> = {
  rewritten: '',
  stale:
    'The server rebuilt this document while the change was in flight, so the change was discarded. Re-read the document and retry.',
  refused: 'The server refused this change for this account, so it was undone.',
  oversize:
    'This change was too large to sync in one step, so the server undid it. Split it into smaller edits (for example one section at a time).',
  gone: 'The branch this change was made on no longer exists, so the change was discarded.',
}

export const UNDELIVERED_ERROR =
  'The change was applied in the editor, but the server did not confirm receiving it (the connection dropped or stalled). Re-read the document to check before retrying.'

function describeIncident(incident: CollabWriteIncident): string {
  return incident.kind === 'blocked' ? BLOCKED_ERROR[incident.reason] : RESET_ERROR[incident.reason]
}

/**
 * Start watching. The returned function reports the first-class outcome of
 * everything written since: an incident recorded meanwhile wins over the
 * delivery receipt, because a refused or reverted write is not on the server
 * however promptly the socket answers.
 */
export function startCollabWriteWatch(
  confirmDelivery: () => Promise<boolean>,
): () => Promise<CollabWriteReceipt> {
  const countAtStart = incidentCount
  const incidentSinceStart = (): CollabWriteIncident | null =>
    incidentCount !== countAtStart ? lastIncident : null

  return async () => {
    const early = incidentSinceStart()
    if (early) return { ok: false, error: describeIncident(early) }
    const delivered = await confirmDelivery()
    // A server reset for this write arrives BEFORE the receipt (frames are
    // answered in order), so check the ledger again after waiting.
    const late = incidentSinceStart()
    if (late) return { ok: false, error: describeIncident(late) }
    return delivered ? { ok: true } : { ok: false, error: UNDELIVERED_ERROR }
  }
}
