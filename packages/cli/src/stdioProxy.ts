/**
 * `instatic mcp` — a local stdio MCP server that forwards to an Instatic site.
 *
 * Desktop MCP clients (Claude Desktop, Cursor, …) launch local servers over
 * stdio and cannot always attach an `Authorization` header to a remote URL.
 * This proxy holds the token, advertises the site's own instructions and tool
 * list unchanged, and forwards each `tools/call` with the same safe-retry
 * rules as the CLI. A dropped connection is reopened on the next request
 * instead of killing the stdio server, so the desktop client never sees the
 * Instatic server "disconnect".
 */
import { Server, type CallToolResult } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import type { FetchLike } from '@modelcontextprotocol/client'
import type { ResolvedConnection } from './config'
import { ConnectionError, InstaticSession } from './connection'

export interface ProxyOptions {
  clientVersion: string
  fetch?: FetchLike
  log: (text: string) => void
}

/** Opens the remote session lazily and reopens it after a connection failure. */
class RemoteSession {
  private current: Promise<InstaticSession> | null = null
  private readonly connection: ResolvedConnection
  private readonly options: ProxyOptions

  constructor(connection: ResolvedConnection, options: ProxyOptions) {
    this.connection = connection
    this.options = options
  }

  get(): Promise<InstaticSession> {
    if (!this.current) {
      const opening = InstaticSession.open(this.connection, {
        clientVersion: this.options.clientVersion,
        fetch: this.options.fetch,
      })
      // A failed open must not be cached: the next request tries again.
      opening.catch(() => {
        if (this.current === opening) this.current = null
      })
      this.current = opening
    }
    return this.current
  }

  /** Drop the session after a transport failure so the next call reconnects. */
  reset(): void {
    const stale = this.current
    this.current = null
    void stale?.then((session) => session.close()).catch(() => {})
  }

  async close(): Promise<void> {
    const session = await this.current?.catch(() => null)
    await session?.close()
  }
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** Build the proxy server. Connects to the site first to learn its instructions. */
export async function createProxyServer(
  connection: ResolvedConnection,
  options: ProxyOptions,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const remote = new RemoteSession(connection, options)
  const first = await remote.get()
  const server = new Server(
    { name: 'instatic', version: options.clientVersion },
    { capabilities: { tools: {} }, instructions: first.instructions() },
  )

  server.setRequestHandler('tools/list', async () => {
    try {
      const session = await remote.get()
      return { tools: await session.listTools() }
    } catch (err) {
      if (err instanceof ConnectionError && err.kind === 'unreachable') remote.reset()
      throw err
    }
  })

  server.setRequestHandler('tools/call', async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params
    try {
      const session = await remote.get()
      const result = await session.callTool(name, args ?? {})
      return server.projectCallToolResult(
        { isError: result.isError, content: result.content as CallToolResult['content'] },
        undefined,
      )
    } catch (err) {
      if (err instanceof ConnectionError) {
        if (err.kind === 'unreachable') remote.reset()
        options.log(`[instatic mcp] ${err.message}\n`)
        return errorResult(err.message)
      }
      throw err
    }
  })

  return { server, close: () => remote.close() }
}

export async function runStdioProxy(connection: ResolvedConnection, options: ProxyOptions): Promise<void> {
  const { server, close } = await createProxyServer(connection, options)
  const transport = new StdioServerTransport()
  // The desktop client ends the session by closing our stdin; the transport
  // does not report that on its own.
  const closed = new Promise<void>((resolve) => {
    transport.onclose = () => resolve()
    process.stdin.once('end', () => resolve())
    process.stdin.once('close', () => resolve())
  })
  await server.connect(transport)
  options.log(`[instatic mcp] forwarding to ${connection.url}\n`)
  await closed
  await server.close()
  await close()
}
