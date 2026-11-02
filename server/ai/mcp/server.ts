/**
 * Build a capability-scoped MCP `Server` over Instatic's existing tool engine.
 *
 * We use the low-level SDK `Server` + `setRequestHandler` so our canonical
 * TypeBox `inputSchema` remains the source of truth and is advertised verbatim
 * as JSON Schema (exactly as the AI drivers send it to providers). Each call
 * still runs through `executeAiTool`, which already does TypeBox input
 * validation, a capability re-check, and `{ ok, data | error }`
 * normalisation.
 */
import {
  Server,
  type CallToolResult,
  type JSONValue,
  type Tool,
} from '@modelcontextprotocol/server'
import type { DbClient } from '../../db/client'
import type { CoreCapability } from '@core/capabilities'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { AiBrowserBridge, AiTool, AiToolOutput } from '../runtime/types'
import { BrowserToolInterruptedError } from '../runtime'
import { executeAiTool } from '../drivers/http/execTool'
import { mcpToolsForCapabilities } from './registry'
import { MCP_SERVER_INSTRUCTIONS } from './instructions'
import { authorizeMcpContentTool } from './contentAuthorization'
import { waitForEditorWorkspace, type EditorBridgeScope, type EditorWorkspace } from './editorBridge'
import { runPublishFlush } from '../../publish/publishFlush'
import { MAIN_SCOPE } from '../../branches/scope'

export interface McpServerContext {
  db: DbClient
  userId: string
  connectorId: string
  capabilities: readonly CoreCapability[]
  uploadsDir?: string
  /** Test seam: how long a browser tool waits for its workspace to (re)connect. */
  workspaceWaitMs?: number
}

/**
 * How long a browser tool waits for the owner's workspace to connect before
 * failing. An open editor's stream has routine gaps — the idle recycle, a
 * reconnect after a network blip, a server restart — that last a few seconds;
 * failing instantly inside one reads to the agent as "the tool disconnected".
 */
const WORKSPACE_WAIT_MS = 15_000

// Used for server-resolved tools, which never call the bridge.
const NOOP_BRIDGE: AiBrowserBridge = {
  callBrowser: async () => {
    throw new Error('[ai:mcp] this tool has no server handler and no live editor bridge')
  },
}

const WORKSPACE_LABEL: Record<EditorBridgeScope, string> = {
  site: 'Site editor',
  content: 'Content workspace',
}

const STATE_CHECK_HINT: Record<EditorBridgeScope, string> = {
  site: 'Check the current state (site_read_document, site_list_code_assets) before retrying.',
  content: 'Re-read the affected entry before retrying.',
}

const NO_WORKSPACE_MESSAGE: Record<EditorBridgeScope, string> = {
  site: 'No Instatic Site editor connected within 15 seconds. This tool runs in the Site editor: ask the user to open it in a browser (signed in as the connector owner), then retry. Headless tools such as get_context keep working meanwhile.',
  content: 'No Instatic Content workspace connected within 15 seconds. This tool runs in the Content workspace: ask the user to open it in a browser (signed in as the connector owner), then retry. Headless tools such as get_context keep working meanwhile.',
}

/**
 * Explain an interrupted browser call in terms an external agent can act on.
 * The transport's own messages are written for the in-app chat stream; over
 * MCP the important fact is whether the edit could have been applied.
 */
function interruptionMessage(
  err: BrowserToolInterruptedError,
  toolName: string,
  scope: EditorBridgeScope,
): string {
  const label = WORKSPACE_LABEL[scope]
  if (!err.delivered) {
    return `The ${label} disconnected before running "${toolName}"; nothing was applied. Retry the call. If it fails again, ask the user to check that the ${label} is open.`
  }
  if (err.reason === 'timeout') {
    return `The ${label} did not finish "${toolName}" within 90 seconds. The edit may still complete. ${STATE_CHECK_HINT[scope]} Split very large edits into smaller calls.`
  }
  if (err.reason === 'aborted') {
    return `"${toolName}" was cancelled before the ${label} returned a result; the edit may or may not have been applied. ${STATE_CHECK_HINT[scope]}`
  }
  return `The ${label} tab disconnected while "${toolName}" was running, so the result is unknown: the edit may or may not have been applied. ${STATE_CHECK_HINT[scope]}`
}

function isUndeliveredClosure(err: unknown): boolean {
  return err instanceof BrowserToolInterruptedError && !err.delivered && err.reason === 'closed'
}

/**
 * Same requirement as `NO_WORKSPACE_MESSAGE`, stated up front.
 *
 * An MCP client picks its tools from `tools/list` and nothing else, so a
 * browser tool that reads like a headless one gets called blind: the model
 * only learns the editor has to be open by burning a turn on the failure. That
 * is the wrong end of the loop to teach it from — it can neither open the
 * editor itself nor tell from the error whether retrying is worthwhile, so it
 * retries anyway. Advertising the precondition alongside the description lets
 * the model ask the user to open the workspace before it spends anything.
 */
const BROWSER_WORKSPACE_REQUIREMENT: Record<EditorBridgeScope, string> = {
  site: 'Requires the Instatic Site editor to be open in a browser, signed in as the connector owner; this tool edits that live workspace and cannot run headlessly.',
  content: 'Requires the Instatic Content workspace to be open in a browser, signed in as the connector owner; this tool edits that live workspace and cannot run headlessly.',
}

/** Tool description as advertised over MCP — browser tools carry their precondition. */
function advertisedDescription(tool: AiTool): string {
  if (tool.execution !== 'browser') return tool.description
  if (tool.scope !== 'site' && tool.scope !== 'content') return tool.description
  return `${tool.description}\n\n${BROWSER_WORKSPACE_REQUIREMENT[tool.scope]}`
}

/**
 * TypeBox schemas are JSON Schema plus symbol-keyed runtime metadata. MCP v2
 * validates the advertised schema as JSON data, so project only the enumerable
 * string-keyed JSON value while preserving the canonical schema itself.
 */
function plainJsonValue(value: unknown): JSONValue {
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : plainJsonValue(item))
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value !== 'object') {
    throw new TypeError('TypeBox schema contains a non-JSON value')
  }

  const out: Record<string, JSONValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = plainJsonValue(item)
  }
  return out
}

function plainInputSchema(schema: AiTool['inputSchema']): Tool['inputSchema'] {
  const value = plainJsonValue(schema)
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    value.type !== 'object'
  ) {
    throw new TypeError('MCP tool input schema must be a JSON Schema object')
  }
  return value as Tool['inputSchema']
}

export function buildMcpServer(ctx: McpServerContext): Server {
  const server = new Server(
    { name: 'instatic', version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: MCP_SERVER_INSTRUCTIONS },
  )

  const tools = mcpToolsForCapabilities(
    ctx.capabilities,
    ctx.uploadsDir
      ? { connectorId: ctx.connectorId, uploadsDir: ctx.uploadsDir }
      : undefined,
  )
  const byName = new Map<string, AiTool>(tools.map((t) => [t.name, t]))

  server.setRequestHandler('tools/list', async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: advertisedDescription(t),
      // Every MCP tool schema is a Type.Object. Remove TypeBox's symbol-keyed
      // runtime annotations before handing the otherwise unchanged JSON Schema
      // to the v2 wire validator.
      inputSchema: plainInputSchema(t.inputSchema),
    })),
  }))

  server.setRequestHandler('tools/call', async (request, requestContext): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params
    const tool = byName.get(name)
    const project = (result: CallToolResult) =>
      server.projectCallToolResult(result, undefined)
    if (!tool) {
      return project({ isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] })
    }

    // Server-resolved tools run in-process; browser tools are relayed to the
    // connector owner's matching open workspace. No workspace → a clear,
    // actionable error. Browser tools currently belong only to Site or
    // Content; keep that invariant explicit instead of guessing a bridge.
    let bridge = NOOP_BRIDGE
    let browserScope: EditorBridgeScope | null = null
    if (tool.execution === 'browser') {
      if (tool.scope !== 'site' && tool.scope !== 'content') {
        return project({
          isError: true,
          content: [{ type: 'text', text: `Browser tool "${tool.name}" has unsupported scope "${tool.scope}".` }],
        })
      }
      const scope: EditorBridgeScope = tool.scope
      browserScope = scope
      const signal = requestContext.mcpReq.signal
      const waitMs = ctx.workspaceWaitMs ?? WORKSPACE_WAIT_MS
      const connect = () => waitForEditorWorkspace(ctx.userId, scope, { timeoutMs: waitMs, signal })

      const initial = await connect()
      if (!initial) {
        return project({
          isError: true,
          content: [{ type: 'text', text: NO_WORKSPACE_MESSAGE[scope] }],
        })
      }

      const run = async (
        workspace: EditorWorkspace,
        toolName: string,
        input: unknown,
      ): Promise<AiToolOutput> => {
        if (scope === 'content') {
          await authorizeMcpContentTool(
            ctx.db,
            ctx.userId,
            ctx.capabilities,
            toolName,
            input,
            { branchId: workspace.branchId },
          )
        }
        return workspace.bridge.callBrowser(toolName, input)
      }

      bridge = {
        callBrowser: async (toolName, input) => {
          try {
            return await run(initial, toolName, input)
          } catch (err) {
            // The tab's stream closed before the call was pushed to it, so the
            // editor never saw it: retry once on whichever tab is live now.
            if (!isUndeliveredClosure(err)) throw err
            const next = await connect()
            if (!next) throw new Error(NO_WORKSPACE_MESSAGE[scope], { cause: err })
            return run(next, toolName, input)
          }
        },
      }
    } else {
      // Headless reads hit the DB directly, but live co-editing persists on an
      // ~800 ms debounce — flush the relay first so a headless read reflects
      // edits still in flight in an open editor. Cheap: a clean doc's flush is
      // a no-op (persistNow early-returns when not dirty).
      await runPublishFlush()
    }

    let output: AiToolOutput
    try {
      output = await executeAiTool(tool, args ?? {}, bridge, requestContext.mcpReq.signal, {
        db: ctx.db,
        // Headless MCP reads describe the live site. Browser-bridged tools run
        // inside whatever branch the connected workspace has open (the bridge
        // records it, and the ownership pre-check above reads the row there).
        branch: MAIN_SCOPE,
        userId: ctx.userId,
        capabilities: ctx.capabilities,
        scope: tool.scope === 'shared' ? 'content' : tool.scope,
        conversationId: `mcp:${ctx.connectorId}`,
        snapshot: null,
      })
    } catch (err) {
      // Browser bridge rejection is terminal for a chat turn, but MCP has no
      // surrounding provider loop to terminate. Translate the same transport
      // failure into the protocol's normal tool-error result instead of
      // letting the request handler reject with an internal MCP error.
      const text = err instanceof BrowserToolInterruptedError && browserScope
        ? interruptionMessage(err, tool.name, browserScope)
        : getErrorMessage(err, `Browser tool "${tool.name}" could not return a result.`)
      return project({ isError: true, content: [{ type: 'text', text }] })
    }

    if (!output.ok) {
      return project({
        isError: true,
        content: [{ type: 'text', text: output.error ?? 'Tool failed.' }],
      })
    }
    // A tool that mutates but returns no payload (e.g. deleteNode) must still
    // read as an unambiguous success — never the literal "null".
    const payload = output.data === undefined || output.data === null ? { ok: true } : output.data
    const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(payload) }]
    // Forward image attachments (e.g. render_snapshot's PNG) as MCP image
    // content blocks so vision clients actually receive the screenshot — they
    // travel on `output.images`, never inlined into the text payload.
    for (const image of output.images ?? []) {
      content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
    }
    return project({ content })
  })

  return server
}
