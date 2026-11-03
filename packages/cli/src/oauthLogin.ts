/**
 * `instatic login` through the browser (OAuth 2.1 authorization code + PKCE).
 *
 * The site is its own authorization server. The CLI:
 *
 *   1. discovers it from the MCP endpoint (RFC 9728 → RFC 8414) and takes the
 *      `resource` from the site's own metadata, so a URL typed differently
 *      from the site's public address (www vs bare domain) is caught up front
 *      instead of failing at the token exchange;
 *   2. listens on 127.0.0.1 for the redirect and registers itself as a public
 *      client with that loopback callback (dynamic client registration);
 *   3. opens the consent page; the user approves in the Instatic admin;
 *   4. checks `state` (constant-time) and `iss` (RFC 9207, inside the SDK's
 *      code exchange), then trades the code for tokens.
 *
 * Nothing secret is printed: the authorize URL carries only the PKCE challenge.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { hostname } from 'node:os'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  registerClient,
  startAuthorization,
  type FetchLike,
} from '@modelcontextprotocol/client'
import { mcpEndpoint, type OAuthSession } from './config'
import { UsageError } from './args'
import { ConnectionError } from './errors'

const SCOPE = 'mcp offline_access'
/** Long enough to sign in and pass a step-up prompt on the consent page. */
export const LOGIN_TIMEOUT_MS = 10 * 60_000

export interface OAuthLoginOptions {
  fetch?: FetchLike
  /** Open the consent page. Returns false when no browser could be started. */
  openBrowser?: (url: string) => Promise<boolean>
  log: (text: string) => void
  /** Fixed loopback port (for SSH port forwarding); 0 picks a free one. */
  port?: number
  timeoutMs?: number
}

/** The callback page the browser lands on. Plain text; nothing from the query is echoed. */
function finish(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(`${message}\n`)
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

interface CallbackResult {
  code: string
  iss?: string
}

interface LoopbackListener {
  redirectUrl: string
  /** Resolves with the first callback that carries the expected `state`. */
  result: Promise<CallbackResult>
  close: () => void
}

async function listenForCallback(state: string, port: number, timeoutMs: number): Promise<LoopbackListener> {
  // Not Promise.withResolvers: the package supports Node 20.
  let resolveResult!: (value: CallbackResult) => void
  let rejectResult!: (reason: unknown) => void
  const result = new Promise<CallbackResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  // A timeout can fire before anyone awaits `result`; that is not unhandled.
  result.catch(() => {})
  const outcome = { resolve: resolveResult, reject: rejectResult }
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== '/callback') return finish(res, 404, 'Not found.')
    const returnedState = url.searchParams.get('state') ?? ''
    // Anything without our state is not the redirect we started: ignore it
    // without revealing why, and keep waiting for the real one.
    if (!sameSecret(returnedState, state)) return finish(res, 400, 'This sign-in link is not for the waiting instatic command.')
    const error = url.searchParams.get('error')
    if (error) {
      finish(res, 200, 'Sign-in was cancelled. You can close this tab.')
      const reason = error === 'access_denied' ? 'Sign-in was denied in the browser.' : `Sign-in failed (${error}).`
      outcome.reject(new ConnectionError('auth', reason))
      return
    }
    const code = url.searchParams.get('code')
    if (!code) return finish(res, 400, 'The sign-in response had no authorization code.')
    finish(res, 200, 'Signed in to Instatic. You can close this tab and return to the terminal.')
    const iss = url.searchParams.get('iss')
    outcome.resolve({ code, ...(iss ? { iss } : {}) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'EADDRINUSE'
        ? new UsageError(`Port ${port} is already in use. Pick another with --port.`)
        : err)
    })
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const { port: bound } = server.address() as AddressInfo
  const timer = setTimeout(() => {
    outcome.reject(new ConnectionError('auth', `Timed out after ${Math.round(timeoutMs / 60_000)} minutes waiting for the browser sign-in.`))
  }, timeoutMs)
  const close = () => {
    clearTimeout(timer)
    server.close()
    server.closeAllConnections?.()
  }
  return { redirectUrl: `http://127.0.0.1:${bound}/callback`, result, close }
}

/** Run the browser sign-in for `siteUrl` and return the session to save. */
export async function oauthLogin(siteUrl: string, options: OAuthLoginOptions): Promise<OAuthSession> {
  const fetchFn = options.fetch
  const serverUrl = mcpEndpoint(siteUrl)

  let info
  try {
    info = await discoverOAuthServerInfo(serverUrl, { fetchFn })
  } catch (err) {
    throw new ConnectionError('server', `Could not start the browser sign-in for ${siteUrl}: ${(err as Error).message}`, { cause: err })
  }
  const metadata = info.authorizationServerMetadata
  const advertised = info.resourceMetadata?.resource
  if (!metadata || !advertised) {
    throw new ConnectionError(
      'server',
      `${siteUrl} does not offer browser sign-in (the server needs PUBLIC_ORIGIN configured). ` +
        'Use a token instead: instatic login --url <site> --with-token',
    )
  }
  const resource = new URL(advertised)
  if (resource.href !== serverUrl.href) {
    throw new UsageError(
      `${siteUrl} says its public address is ${resource.origin}. Run: instatic login --url ${resource.origin}`,
    )
  }

  const state = randomBytes(32).toString('base64url')
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS
  const listener = await listenForCallback(state, options.port ?? 0, timeoutMs)
  try {
    const clientInformation = await registerClient(info.authorizationServerUrl, {
      metadata,
      clientMetadata: {
        client_name: `instatic CLI (${hostname()})`,
        redirect_uris: [listener.redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: SCOPE,
      },
      fetchFn,
    })
    const { authorizationUrl, codeVerifier } = await startAuthorization(info.authorizationServerUrl, {
      metadata,
      clientInformation,
      redirectUrl: listener.redirectUrl,
      scope: SCOPE,
      state,
      resource,
    })

    const opened = options.openBrowser ? await options.openBrowser(authorizationUrl.href) : false
    options.log(
      opened
        ? `Opened your browser to approve access. If it did not open, visit:\n  ${authorizationUrl.href}\n`
        : `Open this URL in a browser on this machine to approve access:\n  ${authorizationUrl.href}\n`,
    )
    options.log('Waiting for you to approve in the browser…\n')

    const callback = await listener.result
    const tokens = await exchangeAuthorization(info.authorizationServerUrl, {
      metadata,
      clientInformation,
      authorizationCode: callback.code,
      ...(callback.iss ? { iss: callback.iss } : {}),
      codeVerifier,
      redirectUri: listener.redirectUrl,
      resource,
      fetchFn,
    })
    return {
      authorizationServerUrl: info.authorizationServerUrl,
      resource: resource.href,
      tokenEndpoint: metadata.token_endpoint,
      clientId: clientInformation.client_id,
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ...(tokens.scope ? { scope: tokens.scope } : {}),
    }
  } finally {
    listener.close()
  }
}
