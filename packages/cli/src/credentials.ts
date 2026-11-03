/**
 * The bearer token for each request.
 *
 * A personal access token is used as is. An OAuth profile holds a one-hour
 * access token plus a refresh token, and the server treats a refresh token
 * presented twice as stolen: it revokes the whole sign-in. Several CLI
 * processes can share one profile, so refreshing follows one protocol:
 *
 *   1. read the profile from disk on every request (never trust a copy held
 *      in memory — another process may have rotated the tokens since);
 *   2. refresh only while holding the config lock, and only after re-reading
 *      the profile inside the lock: if another process already refreshed,
 *      use its tokens instead of refreshing again.
 *
 * Refresh happens ahead of expiry, and once more after a 401 in case the
 * server revoked the access token early.
 */
import type { FetchLike } from '@modelcontextprotocol/client'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  readConfig,
  updateConfig,
  withConfigLock,
  writeConfigFile,
  type ConnectionAuth,
  type OAuthSession,
  type Profile,
} from './config'
import { ConnectionError } from './errors'

/** Refresh when the access token has less than this left. */
const REFRESH_MARGIN_MS = 60_000
/** Well under the config lock's stale threshold, so a lock is never stolen mid-refresh. */
const REFRESH_TIMEOUT_MS = 30_000

export interface Credentials {
  /** The token for the next request, refreshed first when it is about to expire. */
  bearer(): Promise<string>
  /**
   * The server rejected `rejected`. Returns true when a different token is now
   * available to retry with.
   */
  renew(rejected: string): Promise<boolean>
  /** What to tell the user when the server keeps rejecting the credentials. */
  rejectedMessage(siteUrl: string): string
}

export function createCredentials(auth: ConnectionAuth, options: { fetch?: FetchLike } = {}): Credentials {
  if (auth.kind === 'token') {
    return {
      bearer: async () => auth.token,
      renew: async () => false,
      rejectedMessage: (siteUrl) =>
        `${siteUrl} rejected the access token. It may be expired or revoked: create a new one in Instatic under AI → MCP, or run instatic login --url ${siteUrl} to sign in through the browser.`,
    }
  }
  return new OAuthCredentials(auth.configPath, auth.profile, options.fetch)
}

function oauthSessionOf(profile: Profile | undefined, name: string): OAuthSession {
  if (!profile || !('oauth' in profile)) {
    throw new ConnectionError('auth', `Profile "${name}" is no longer signed in. Run instatic login.`)
  }
  return profile.oauth
}

function needsRefresh(session: OAuthSession, now: number): boolean {
  return session.expiresAt - now < REFRESH_MARGIN_MS
}

class OAuthCredentials implements Credentials {
  private readonly configPath: string
  private readonly profile: string
  private readonly fetchFn: FetchLike | undefined

  constructor(configPath: string, profile: string, fetchFn: FetchLike | undefined) {
    this.configPath = configPath
    this.profile = profile
    this.fetchFn = fetchFn
  }

  private async current(): Promise<OAuthSession> {
    const config = await readConfig(this.configPath)
    return oauthSessionOf(config.profiles[this.profile], this.profile)
  }

  async bearer(): Promise<string> {
    const session = await this.current()
    if (!needsRefresh(session, Date.now())) return session.accessToken
    return (await this.refresh(null)).accessToken
  }

  async renew(rejected: string): Promise<boolean> {
    const session = await this.refresh(rejected)
    return session.accessToken !== rejected
  }

  rejectedMessage(siteUrl: string): string {
    return `${siteUrl} no longer accepts this sign-in (it expired or was revoked in AI → MCP). Run: instatic login --url ${siteUrl}`
  }

  /**
   * Refresh under the lock. `rejected` is an access token the server just
   * refused: refresh even if it has not expired yet — unless the profile on
   * disk already holds a different one.
   */
  private async refresh(rejected: string | null): Promise<OAuthSession> {
    return withConfigLock(this.configPath, async () => {
      const config = await readConfig(this.configPath)
      const session = oauthSessionOf(config.profiles[this.profile], this.profile)
      const stillGood = rejected === null
        ? !needsRefresh(session, Date.now())
        : session.accessToken !== rejected
      if (stillGood) return session
      if (!session.refreshToken) {
        throw new ConnectionError('auth', `The sign-in for profile "${this.profile}" expired. Run instatic login.`)
      }

      const tokens = await requestRefresh(session, this.profile, this.fetchFn ?? fetch)

      const next: OAuthSession = {
        ...session,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? session.refreshToken,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        ...(tokens.scope ? { scope: tokens.scope } : {}),
      }
      // Already inside the lock: write directly rather than re-entering it.
      config.profiles[this.profile] = { url: config.profiles[this.profile]!.url, oauth: next }
      await writeConfigFile(this.configPath, config)
      return next
    })
  }
}

const TokenResponseSchema = Type.Object({
  access_token: Type.String({ minLength: 1 }),
  refresh_token: Type.Optional(Type.String({ minLength: 1 })),
  expires_in: Type.Optional(Type.Number()),
  scope: Type.Optional(Type.String()),
})

const TokenErrorSchema = Type.Object({ error: Type.String() })

/** One refresh-token grant against the site's token endpoint (public client, RFC 6749 §6 + RFC 8707). */
async function requestRefresh(session: OAuthSession, profile: string, fetchFn: FetchLike) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken ?? '',
    client_id: session.clientId,
    resource: session.resource,
  })
  let response: Response
  try {
    response = await fetchFn(session.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    })
  } catch (err) {
    throw new ConnectionError('unreachable', `Could not reach ${session.tokenEndpoint} to refresh the sign-in.`, { cause: err })
  }
  const json: unknown = await response.json().catch(() => null)
  if (response.ok && Value.Check(TokenResponseSchema, json)) return json
  // The token we sent is the latest on disk (we hold the lock), so a rejected
  // grant means the sign-in itself is gone, not that another process won a race.
  if (Value.Check(TokenErrorSchema, json) && json.error === 'invalid_grant') {
    throw new ConnectionError('auth', `The sign-in for profile "${profile}" expired or was revoked. Run instatic login.`)
  }
  if (response.status >= 502 && response.status <= 504) {
    throw new ConnectionError('unreachable', `Could not reach ${session.tokenEndpoint} to refresh the sign-in.`)
  }
  const reason = Value.Check(TokenErrorSchema, json) ? json.error : `HTTP ${response.status}`
  throw new ConnectionError('server', `Refreshing the sign-in failed (${reason}).`)
}

/** Save a freshly signed-in OAuth session as profile `name` and make it current. */
export async function saveOAuthProfile(
  configPath: string,
  name: string,
  url: string,
  session: OAuthSession,
): Promise<void> {
  await updateConfig(configPath, (config) => {
    config.profiles[name] = { url, oauth: session }
    config.current = name
  })
}
