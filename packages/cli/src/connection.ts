/**
 * One authenticated MCP session against an Instatic site.
 *
 * Instatic's endpoint is stateless (MCP 2026-07-28): every request is an
 * independent authenticated POST, so a "session" is just a configured client.
 * This module adds what a terminal or agent needs on top of the SDK:
 *
 *   - failures classified into auth / unreachable / server, so callers can
 *     map them to exit codes and actionable messages;
 *   - retries that are safe: discovery and reads retry on any network error,
 *     but a tool call is re-sent only when the request provably never reached
 *     the server (connection refused, DNS failure, gateway said upstream is
 *     down) — a write must never be applied twice;
 *   - a tool-call timeout above the server's own budget (up to 15 s waiting
 *     for the editor tab plus 90 s for the editor to run the tool).
 */
import {
  Client,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type FetchLike,
  type Tool,
} from '@modelcontextprotocol/client'
import { mcpEndpoint, type ResolvedConnection } from './config'
import { createCredentials, type Credentials } from './credentials'
import { ConnectionError } from './errors'

const PROTOCOL_VERSION = '2026-07-28'
/** Above the server's 15 s workspace wait + 90 s per-call editor limit. */
export const TOOL_CALL_TIMEOUT_MS = 150_000
const READ_TIMEOUT_MS = 30_000
const RETRY_DELAYS_MS = [500, 1500]

/** Codes meaning the TCP connection was never established — nothing was sent. */
const NEVER_SENT_CODES = new Set(['ECONNREFUSED', 'ConnectionRefused', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])
const NETWORK_CODES = new Set([
  ...NEVER_SENT_CODES,
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
])
const GATEWAY_STATUSES = new Set([502, 503, 504])

/**
 * The error plus everything it wraps. The SDK nests the underlying failure
 * under `data.cause` (version-negotiation errors) as well as the standard
 * `cause`.
 */
function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = []
  let current: unknown = err
  while (current && chain.length < 8 && !chain.includes(current)) {
    chain.push(current)
    const next = (current as { cause?: unknown }).cause
      ?? ((current as { data?: { cause?: unknown } }).data?.cause)
    current = next
  }
  return chain
}

function errorCodes(err: unknown): string[] {
  return errorChain(err)
    .map((link) => (link as { code?: unknown }).code)
    .filter((code): code is string => typeof code === 'string')
}

function httpStatus(err: unknown): number | null {
  for (const link of errorChain(err)) {
    if (link instanceof SdkHttpError) return link.status
  }
  return null
}

function isNetworkFailure(err: unknown): boolean {
  if (errorCodes(err).some((code) => NETWORK_CODES.has(code))) return true
  // Node's undici surfaces a failed connection as a bare `TypeError: fetch failed`.
  return errorChain(err).some(
    (link) => link instanceof TypeError && /fetch failed|unable to connect/i.test(link.message),
  )
}

/** Worth retrying for an idempotent request (discovery, reads). */
function isTransient(err: unknown): boolean {
  const status = httpStatus(err)
  return isNetworkFailure(err) || (status !== null && GATEWAY_STATUSES.has(status))
}

function neverSent(err: unknown): boolean {
  if (errorCodes(err).some((code) => NEVER_SENT_CODES.has(code))) return true
  const status = httpStatus(err)
  return status !== null && GATEWAY_STATUSES.has(status)
}

/** Turn any SDK / network failure into a `ConnectionError` with a next step. */
export function classifyFailure(
  err: unknown,
  siteUrl: string,
  rejectedMessage = `${siteUrl} rejected the access token. Run instatic login.`,
): ConnectionError {
  // Credentials raise their own classified errors from inside the SDK's fetch.
  const classified = errorChain(err).find((link) => link instanceof ConnectionError)
  if (classified) return classified as ConnectionError
  const status = httpStatus(err)
  if (err instanceof UnauthorizedError || status === 401 || status === 403) {
    return new ConnectionError('auth', rejectedMessage, { cause: err })
  }
  if ((status !== null && GATEWAY_STATUSES.has(status)) || isNetworkFailure(err)) {
    return new ConnectionError(
      'unreachable',
      `Could not reach ${siteUrl}. Check the URL and that the server is running.`,
      { cause: err },
    )
  }
  const message = err instanceof Error ? err.message : String(err)
  return new ConnectionError('server', `Request to ${siteUrl} failed: ${message}`, { cause: err })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function withRetry<T>(run: () => Promise<T>, retryable: (err: unknown) => boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined || !retryable(err)) throw err
      await sleep(delay)
    }
  }
}

export interface ToolCallResult {
  isError: boolean
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  /** The tool needs the Site editor / Content workspace and none was open. */
  workspaceNotConnected: boolean
  _meta?: Record<string, unknown>
}

/** Server marker on "no workspace connected" results (server/ai/mcp/server.ts). */
const WORKSPACE_NOT_CONNECTED = 'workspace_not_connected'

/**
 * `fetch` that sends the current bearer token, and after a 401 renews the
 * credentials once and re-sends. A 401 means the server refused the request
 * before running anything, so re-sending is always safe.
 */
function authorizedFetch(base: FetchLike, credentials: Credentials): FetchLike {
  return async (input, init) => {
    const send = (token: string) => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return base(input, { ...init, headers })
    }
    const token = await credentials.bearer()
    const response = await send(token)
    if (response.status !== 401 || !(await credentials.renew(token))) return response
    await response.body?.cancel().catch(() => {})
    return send(await credentials.bearer())
  }
}

export interface SessionOptions {
  clientVersion: string
  /** Test seam: replaces the network for every request. */
  fetch?: FetchLike
}

export class InstaticSession {
  readonly siteUrl: string
  private readonly client: Client
  private readonly rejectedMessage: string

  private constructor(siteUrl: string, client: Client, rejectedMessage: string) {
    this.siteUrl = siteUrl
    this.client = client
    this.rejectedMessage = rejectedMessage
  }

  static async open(connection: ResolvedConnection, options: SessionOptions): Promise<InstaticSession> {
    const credentials = createCredentials(connection.auth, { fetch: options.fetch })
    const rejectedMessage = credentials.rejectedMessage(connection.url)
    const fetchFn = authorizedFetch(options.fetch ?? fetch, credentials)
    // A transport starts once, so every attempt builds a fresh client.
    const attempt = async (): Promise<Client> => {
      const client = new Client(
        { name: 'instatic-cli', version: options.clientVersion },
        { versionNegotiation: { mode: { pin: PROTOCOL_VERSION } } },
      )
      const transport = new StreamableHTTPClientTransport(mcpEndpoint(connection.url), { fetch: fetchFn })
      try {
        await client.connect(transport, { timeout: READ_TIMEOUT_MS })
        return client
      } catch (err) {
        await client.close().catch(() => {})
        throw err
      }
    }
    try {
      return new InstaticSession(connection.url, await withRetry(attempt, isTransient), rejectedMessage)
    } catch (err) {
      throw classifyFailure(err, connection.url, rejectedMessage)
    }
  }

  /** The build rules the server advertises to every agent. */
  instructions(): string {
    return this.client.getInstructions() ?? ''
  }

  serverVersion(): { name: string; version: string } | undefined {
    return this.client.getServerVersion()
  }

  async listTools(): Promise<Tool[]> {
    try {
      const { tools } = await withRetry(
        () => this.client.listTools(undefined, { timeout: READ_TIMEOUT_MS }),
        isTransient,
      )
      return tools
    } catch (err) {
      throw classifyFailure(err, this.siteUrl, this.rejectedMessage)
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ): Promise<ToolCallResult> {
    try {
      const result = await withRetry(
        () => this.client.callTool(
          { name, arguments: args },
          { timeout: options.timeoutMs ?? TOOL_CALL_TIMEOUT_MS },
        ),
        neverSent,
      )
      const content = Array.isArray(result.content) ? (result.content as ToolCallResult['content']) : []
      const meta = typeof result._meta === 'object' && result._meta !== null
        ? (result._meta as Record<string, unknown>)
        : undefined
      return {
        isError: result.isError === true,
        content,
        workspaceNotConnected: result.isError === true && meta?.['instatic/error'] === WORKSPACE_NOT_CONNECTED,
        ...(meta ? { _meta: meta } : {}),
      }
    } catch (err) {
      throw classifyFailure(err, this.siteUrl, this.rejectedMessage)
    }
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => {})
  }
}

/** The text payload of a tool result, joined. */
export function resultText(result: ToolCallResult): string {
  return result.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}
