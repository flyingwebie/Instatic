/**
 * Collab write watch: an AI tool's result must match what actually reached
 * the server.
 *
 * A refused write leaves the store unchanged, so a tool that simply described
 * the store afterwards reported the OLD state as a success. An MCP client
 * then saw "updated" with the previous file's hash and kept building on an
 * edit that never landed. These tests pin the three ways a write can fail
 * after the pre-flight gate opened: refused by the transport, reverted by a
 * server reset, or never confirmed by the delivery receipt.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import {
  beginCollabWriteWatch,
  connectCollabProvider,
  disconnectCollabProvider,
} from '@site/store/slices/site/collabBinding'
import { UNDELIVERED_ERROR } from '@site/store/slices/site/collabWriteWatch'
import { clearCollabBlockNotice } from '@site/store/slices/site/collabNotices'
import type {
  BoundCollabDoc,
  CollabProvider,
  CollabResetListener,
  CollabStatus,
} from '@site/collab/collabProvider'
import type { ResetReason } from '@core/collab'
import { useEditorStore } from '@site/store/store'
import { executeAgentTool } from '@site/agent'
import '@modules/base/index'

interface FakeTransport extends CollabProvider {
  sendable: boolean
  currentStatus: CollabStatus
  delivered: boolean
  reset(docId: string, reason: ResetReason): void
}

/** A provider whose docs are synced at once, with switchable transport state. */
function fakeTransport(): FakeTransport {
  const presenceDoc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(presenceDoc)
  const bound = new Map<string, BoundCollabDoc>()
  const resetListeners = new Set<CollabResetListener>()
  const transport: FakeTransport = {
    sendable: true,
    currentStatus: 'connected',
    delivered: true,
    bind: (docId) => {
      let entry = bound.get(docId)
      if (!entry) {
        entry = { doc: new Y.Doc(), synced: false, whenSynced: Promise.resolve() }
        const synced = entry
        void entry.whenSynced.then(() => { synced.synced = true })
        bound.set(docId, entry)
      }
      return entry
    },
    unbind: (docId) => {
      bound.get(docId)?.doc.destroy()
      bound.delete(docId)
    },
    awareness,
    status: () => transport.currentStatus,
    canSend: () => transport.sendable,
    reconnectNow: () => {},
    flush: async () => transport.delivered,
    onStatus: () => () => {},
    onReset: (listener) => {
      resetListeners.add(listener)
      return () => resetListeners.delete(listener)
    },
    reset: (docId, reason) => {
      for (const listener of resetListeners) listener(docId, reason)
    },
    destroy: () => {
      awareness.destroy()
      presenceDoc.destroy()
    },
  }
  return transport
}

async function connectedSite(): Promise<FakeTransport> {
  useEditorStore.getState().createSite('Watch Site')
  const transport = fakeTransport()
  connectCollabProvider(transport)
  // Let the whenSynced promises settle so the write gates are open.
  await new Promise((resolve) => setTimeout(resolve, 10))
  return transport
}

afterEach(() => {
  disconnectCollabProvider()
  useEditorStore.getState().clearSite()
  // A refused write latches the "one toast per outage" flag in module scope.
  clearCollabBlockNotice()
})

describe('collab write watch', () => {
  it('is ok when nothing was refused and the server confirmed delivery', async () => {
    await connectedSite()
    const finish = beginCollabWriteWatch()
    expect(await finish()).toEqual({ ok: true })
  })

  it('reports an offline refusal that happened during the watch', async () => {
    const transport = await connectedSite()
    const finish = beginCollabWriteWatch()
    transport.sendable = false
    transport.currentStatus = 'offline'
    useEditorStore.getState().createFile('src/styles/a.css', 'style', 'a {}')
    const receipt = await finish()
    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.error).toContain('offline')
  })

  it('reports a server reset that discarded the write', async () => {
    const transport = await connectedSite()
    const finish = beginCollabWriteWatch()
    transport.reset('site:main', 'oversize')
    const receipt = await finish()
    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.error).toContain('too large')
  })

  it('ignores the routine out-of-relay reseed', async () => {
    const transport = await connectedSite()
    const finish = beginCollabWriteWatch()
    transport.reset('site:main', 'rewritten')
    expect(await finish()).toEqual({ ok: true })
  })

  it('reports a write the server never confirmed', async () => {
    const transport = await connectedSite()
    transport.delivered = false
    const finish = beginCollabWriteWatch()
    expect(await finish()).toEqual({ ok: false, error: UNDELIVERED_ERROR })
  })

  it('does not count an incident from before the watch started', async () => {
    const transport = await connectedSite()
    transport.sendable = false
    transport.currentStatus = 'offline'
    useEditorStore.getState().createFile('src/styles/a.css', 'style', 'a {}')
    transport.sendable = true
    transport.currentStatus = 'connected'
    const finish = beginCollabWriteWatch()
    expect(await finish()).toEqual({ ok: true })
  })
})

describe('executeAgentTool write receipts', () => {
  it('fails a code asset write the editor refused instead of reporting the old file as updated', async () => {
    const transport = await connectedSite()
    const created = await executeAgentTool('site_write_code_asset', {
      path: 'src/styles/watch.css',
      type: 'style',
      content: '.a { color: red; }',
    })
    expect(created.ok).toBe(true)

    transport.sendable = false
    transport.currentStatus = 'offline'
    const refused = await executeAgentTool('site_write_code_asset', {
      path: 'src/styles/watch.css',
      type: 'style',
      content: '.a { color: blue; }',
    })
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('NOT applied')
    const file = useEditorStore.getState().site?.files.find((f) => f.path === 'src/styles/watch.css')
    expect(file?.content).toBe('.a { color: red; }')
  })

  it('fails a write whose delivery the server never confirmed', async () => {
    const transport = await connectedSite()
    transport.delivered = false
    const result = await executeAgentTool('site_write_code_asset', {
      path: 'src/styles/lost.css',
      type: 'style',
      content: '.b {}',
    })
    expect(result).toEqual({ ok: false, error: UNDELIVERED_ERROR })
  })

  it('does not wait for a receipt on read-only tools', async () => {
    const transport = await connectedSite()
    transport.delivered = false
    const result = await executeAgentTool('site_list_code_assets', {})
    expect(result.ok).toBe(true)
  })
})
