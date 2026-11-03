/**
 * Live editor bridge for MCP.
 *
 * Browser-execution tools (insert HTML, apply CSS, set tokens, manage pages,
 * content CRUD, …) have no server implementation — their logic runs in the
 * editor app against the live store. To let an external MCP client use them,
 * the editor holds a long-lived newline-delimited JSON stream open while
 * mounted. Its HTTP response is advertised as an event stream so reverse
 * proxies preserve incremental delivery. This module keeps one bridge per user
 * and workspace and lets the MCP server relay a
 * browser tool call to the correct workspace before awaiting its result.
 *
 * Reuses the chat bridge machinery wholesale: `createBridge` issues the
 * `AiBrowserBridge` (whose `callBrowser` resolves when the editor POSTs back to
 * the existing `/admin/api/ai/tool-result`), and `encodeStreamEvent` frames the
 * NDJSON the editor reads with `readNdjsonStream`.
 *
 * Several tabs may hold a stream for the same workspace. Each tab sends a
 * stable `tabId` and keeps its claim across reconnects: tool calls route to
 * the most recently *opened* tab, and a tab merely reconnecting after an idle
 * recycle never steals the workspace back. Superseded tabs stay connected (so
 * in-flight calls finish) and take over automatically when the active tab
 * closes. Callers that land in a reconnect gap wait briefly
 * (`waitForEditorWorkspace`) instead of failing at once.
 *
 * Security: the registry is keyed by `userId` + workspace scope, so an MCP
 * connector can only ever reach the open workspace of its OWN owner and a
 * content tool can never be dispatched to the site editor (or vice versa).
 */
import { MAIN_BRANCH_ID } from '@core/branches'
import type { AiBrowserBridge, AiStreamEvent } from '../runtime/types'
import { createBridge, encodeStreamEvent } from '../runtime'

export type EditorBridgeScope = 'site' | 'content'

/** The live workspace a browser tool is relayed to. */
export interface EditorWorkspace {
  bridge: AiBrowserBridge
  /** The branch the connected workspace has open; browser tools act in it. */
  branchId: string
}

interface WorkspaceConnection extends EditorWorkspace {
  bridgeId: string
  tabId: string
  /** Claim order: the highest claim among live connections is active. */
  claim: number
  close: () => void
}

interface TabClaim {
  claim: number
  /** When the tab's last connection closed; null while one is live. */
  releasedAt: number | null
}

/**
 * How long a stream may sit with NO tool traffic before the server drops it.
 * This is an IDLE lease: every relayed tool request re-arms it, so an active
 * batch is never cut mid-flight (a fixed lease used to kill the stream at
 * exactly two minutes, failing whichever tool call straddled the boundary).
 * Its purpose is bounding orphan lifetime when a proxy fails to propagate a
 * closed downstream connection; the client reconnect loop restores a
 * legitimately alive workspace within seconds of the drop.
 */
const STREAM_IDLE_LEASE_MS = 120_000

/**
 * How long a disconnected tab keeps its claim. Long enough to cover any
 * reconnect (idle recycle, deploy, laptop sleep) so the tab resumes its place
 * instead of jumping ahead of a tab opened after it.
 */
const TAB_CLAIM_MEMORY_MS = 10 * 60_000

const connections = new Map<string, Map<string, WorkspaceConnection>>()
const claims = new Map<string, Map<string, TabClaim>>()
const waiters = new Map<string, Set<() => void>>()
let claimSequence = 0

function workspaceKey(userId: string, scope: EditorBridgeScope): string {
  return `${scope}\u0000${userId}`
}

function activeConnection(key: string): WorkspaceConnection | null {
  let active: WorkspaceConnection | null = null
  for (const connection of connections.get(key)?.values() ?? []) {
    // `>=`: on a tie (one tab, two streams) the later registration wins.
    if (!active || connection.claim >= active.claim) active = connection
  }
  return active
}

/** The live workspace for a user and scope, or null when none is connected. */
export function getEditorWorkspace(userId: string, scope: EditorBridgeScope): EditorWorkspace | null {
  const active = activeConnection(workspaceKey(userId, scope))
  return active ? { bridge: active.bridge, branchId: active.branchId } : null
}

export function hasEditorBridge(userId: string, scope: EditorBridgeScope): boolean {
  return activeConnection(workspaceKey(userId, scope)) !== null
}

/**
 * The live workspace, waiting up to `timeoutMs` for one to connect. Covers
 * the routine gaps in a workspace's stream (idle recycle, a reconnect after a
 * network blip or server restart) so a tool call landing in one does not fail.
 */
export function waitForEditorWorkspace(
  userId: string,
  scope: EditorBridgeScope,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<EditorWorkspace | null> {
  const ready = getEditorWorkspace(userId, scope)
  if (ready || options.timeoutMs <= 0 || options.signal?.aborted) return Promise.resolve(ready)

  const key = workspaceKey(userId, scope)
  return new Promise((resolve) => {
    const set = waiters.get(key) ?? new Set<() => void>()
    waiters.set(key, set)
    const finish = (): void => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', finish)
      set.delete(finish)
      if (set.size === 0) waiters.delete(key)
      resolve(getEditorWorkspace(userId, scope))
    }
    const timer = setTimeout(finish, options.timeoutMs)
    options.signal?.addEventListener('abort', finish, { once: true })
    set.add(finish)
  })
}

function notifyWaiters(key: string): void {
  for (const finish of [...(waiters.get(key) ?? [])]) finish()
}

function pruneClaims(key: string, now: number): void {
  const tabClaims = claims.get(key)
  if (!tabClaims) return
  for (const [tabId, claim] of tabClaims) {
    if (claim.releasedAt !== null && now - claim.releasedAt > TAB_CLAIM_MEMORY_MS) tabClaims.delete(tabId)
  }
  if (tabClaims.size === 0) claims.delete(key)
}

function register(key: string, connection: Omit<WorkspaceConnection, 'claim'>): WorkspaceConnection {
  const now = Date.now()
  pruneClaims(key, now)

  // A tab runs one stream at a time, so an older stream from the same tab is
  // one the browser already abandoned. Close it rather than leave it as a
  // routing candidate. (Closing unregisters it, which may drop the key's map,
  // so the map is looked up only afterwards.)
  for (const other of [...(connections.get(key)?.values() ?? [])]) {
    if (other.tabId === connection.tabId) other.close()
  }
  const live = connections.get(key) ?? new Map<string, WorkspaceConnection>()
  connections.set(key, live)

  const tabClaims = claims.get(key) ?? new Map<string, TabClaim>()
  claims.set(key, tabClaims)
  const existing = tabClaims.get(connection.tabId)
  const claim = existing?.claim ?? ++claimSequence
  tabClaims.set(connection.tabId, { claim, releasedAt: null })

  const entry: WorkspaceConnection = { ...connection, claim }
  live.set(entry.bridgeId, entry)
  notifyWaiters(key)
  return entry
}

function unregister(key: string, bridgeId: string): void {
  const live = connections.get(key)
  const entry = live?.get(bridgeId)
  if (!live || !entry) return
  live.delete(bridgeId)
  if (live.size === 0) connections.delete(key)
  const tabStillLive = [...live.values()].some((other) => other.tabId === entry.tabId)
  const tabClaim = claims.get(key)?.get(entry.tabId)
  if (tabClaim && !tabStillLive) tabClaim.releasedAt = Date.now()
}

/**
 * Open the long-lived stream the editor consumes. The server pushes
 * `toolRequest` events down it whenever an MCP browser tool is invoked for this
 * user; the editor runs the tool and POSTs the result to `/tool-result`.
 */
export function createEditorBridgeStream(
  userId: string,
  scope: EditorBridgeScope,
  signal: AbortSignal,
  options: {
    /** The branch the workspace has open (its `X-Instatic-Branch`); main when absent. */
    branchId?: string
    /**
     * Stable id of the browser tab across its reconnects. Absent (older
     * clients, tests) → each stream counts as a newly opened tab.
     */
    tabId?: string
    /** Test seam: the idle lease shrinks to milliseconds in unit tests. */
    idleLeaseMs?: number
  } = {},
): ReadableStream<Uint8Array> {
  const { branchId = MAIN_BRANCH_ID, idleLeaseMs = STREAM_IDLE_LEASE_MS } = options
  const key = workspaceKey(userId, scope)
  let closeStream: (() => void) | null = null

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const encoder = new TextEncoder()

      let bridgeId = ''
      let destroyBridge = (): void => {}
      let pendingCount = (): number => 0
      let heartbeat: ReturnType<typeof setInterval> | null = null
      let lease: ReturnType<typeof setTimeout> | null = null

      const cleanup = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        if (lease) clearTimeout(lease)
        signal.removeEventListener('abort', cleanup)
        destroyBridge()
        unregister(key, bridgeId)
        try {
          controller.close()
        } catch {
          /* already closed or cancelled */
        }
      }
      closeStream = cleanup

      const armLease = (): void => {
        if (closed) return
        if (lease) clearTimeout(lease)
        lease = setTimeout(() => {
          // Never recycle under a pending call: that rejected it while the
          // editor was still working on it (its result then 404'd). Every
          // pending call is bounded by the relay's per-call timeout, so an
          // orphaned stream still drains and closes.
          if (pendingCount() > 0) armLease()
          else cleanup()
        }, idleLeaseMs)
      }

      const emit = (event: AiStreamEvent): void => {
        if (closed) return
        try {
          controller.enqueue(encodeStreamEvent(event))
          // Tool traffic proves the stream is wanted — keep the idle lease
          // from expiring under an active batch.
          armLease()
        } catch {
          cleanup()
        }
      }

      // Serial: the editor runs relayed tools strictly one at a time, so
      // pushing a whole batch at once only started every call's timeout (and
      // the idle lease) early — queued calls timed out, or the lease closed the
      // stream mid-batch, while the tab was still working through earlier ones.
      const created = createBridge(emit, signal, undefined, undefined, { serial: true })
      bridgeId = created.bridgeId
      destroyBridge = created.destroy
      pendingCount = created.pendingCount

      register(key, {
        bridgeId,
        tabId: options.tabId ?? bridgeId,
        bridge: created.bridge,
        branchId,
        close: cleanup,
      })

      emit({ type: 'bridgeReady', bridgeId })

      // Heartbeat blank line keeps proxies from idling the connection;
      // `readNdjsonStream` skips empty lines.
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode('\n'))
        } catch {
          cleanup()
        }
      }, 25_000)
      // Bound orphan lifetime when a proxy fails to propagate a closed
      // downstream connection. Idle-based: re-armed by every relayed tool
      // request, so only genuinely quiet streams recycle.
      armLease()

      if (signal.aborted) cleanup()
      else signal.addEventListener('abort', cleanup, { once: true })
    },
    cancel() {
      // Bun cancels the response body when the browser tab/context closes, but
      // that transport cancellation does not abort the server Request signal.
      // Tear down the heartbeat + registry entry from either lifecycle signal.
      closeStream?.()
      closeStream = null
    },
  })
}
