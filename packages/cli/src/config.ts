/**
 * Saved connection profiles.
 *
 * One JSON file (`$INSTATIC_CONFIG`, else `$XDG_CONFIG_HOME/instatic/config.json`,
 * else `~/.config/instatic/config.json`) holds named profiles — one per site —
 * and the current one. A profile signs in either with a personal access token
 * or with OAuth (browser sign-in; the access token is refreshed automatically).
 * It holds credentials, so it is written with owner-only permissions.
 *
 * Several `instatic` processes may share the file (an agent running calls in
 * parallel next to a long-lived `instatic mcp`), so every write goes through
 * `updateConfig`: a lock file serializes writers, and the new content replaces
 * the old with an atomic rename, so a reader never sees a half-written file.
 *
 * Resolution for every command, highest priority first: `--url` / `--token`
 * flags, then `INSTATIC_URL` / `INSTATIC_TOKEN`, then the selected profile
 * (`--profile`, `INSTATIC_PROFILE`, or the saved current one).
 */
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { UsageError } from './args'

const TokenProfileSchema = Type.Object({
  url: Type.String({ minLength: 1 }),
  token: Type.String({ minLength: 1 }),
})

const OAuthSessionSchema = Type.Object({
  /** Authorization server (the site's issuer) the tokens come from. */
  authorizationServerUrl: Type.String({ minLength: 1 }),
  /** The exact MCP resource the tokens are bound to. */
  resource: Type.String({ minLength: 1 }),
  /** Where refresh requests go (from the server's RFC 8414 metadata). */
  tokenEndpoint: Type.String({ minLength: 1 }),
  clientId: Type.String({ minLength: 1 }),
  accessToken: Type.String({ minLength: 1 }),
  refreshToken: Type.Optional(Type.String({ minLength: 1 })),
  /** Epoch milliseconds when the access token expires. */
  expiresAt: Type.Number(),
  scope: Type.Optional(Type.String()),
})
export type OAuthSession = Static<typeof OAuthSessionSchema>

const OAuthProfileSchema = Type.Object({
  url: Type.String({ minLength: 1 }),
  oauth: OAuthSessionSchema,
})

const ProfileSchema = Type.Union([TokenProfileSchema, OAuthProfileSchema])
export type Profile = Static<typeof ProfileSchema>

const ConfigFileSchema = Type.Object({
  current: Type.Optional(Type.String()),
  profiles: Type.Record(Type.String(), ProfileSchema),
})
export type ConfigFile = Static<typeof ConfigFileSchema>

export type Env = Readonly<Record<string, string | undefined>>

export const DEFAULT_PROFILE = 'default'
const MCP_PATH = '/_instatic/mcp'

export function configPath(env: Env): string {
  if (env.INSTATIC_CONFIG) return env.INSTATIC_CONFIG
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'instatic', 'config.json')
}

export async function readConfig(path: string): Promise<ConfigFile> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: {} }
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Config file ${path} is not valid JSON. Fix or delete it.`, { cause: err })
  }
  if (!Value.Check(ConfigFileSchema, parsed)) {
    throw new Error(`Config file ${path} has an unexpected shape. Fix or delete it.`)
  }
  return parsed
}

/** Replace the config file atomically. Callers hold the lock (see `updateConfig`). */
export async function writeConfigFile(path: string, config: ConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  // `mode` only applies when a file is created (and is advisory on Windows,
  // where the user-profile directory's ACL protects the file instead).
  await chmod(temp, 0o600)
  await rename(temp, path)
}

/** A lock older than this is from a crashed process; refreshes time out well before. */
const LOCK_STALE_MS = 120_000
const LOCK_WAIT_MS = 60_000
const LOCK_POLL_MS = 50

/** Run `fn` while holding the config file's lock (one writer at a time across processes). */
export async function withConfigLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const lockPath = `${path}.lock`
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      await handle.writeFile(String(process.pid))
      await handle.close()
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const age = await stat(lockPath).then((info) => Date.now() - info.mtimeMs, () => 0)
      if (age > LOCK_STALE_MS) {
        await rm(lockPath, { force: true })
        continue
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${lockPath}. If no other instatic command is running, delete it.`, { cause: err })
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS))
    }
  }
  try {
    return await fn()
  } finally {
    await rm(lockPath, { force: true })
  }
}

/**
 * Read, change, and write the config under the lock. `mutate` receives the
 * latest content on disk, so concurrent processes never overwrite each
 * other's changes.
 */
export async function updateConfig<T>(path: string, mutate: (config: ConfigFile) => Promise<T> | T): Promise<T> {
  return withConfigLock(path, async () => {
    const config = await readConfig(path)
    const result = await mutate(config)
    await writeConfigFile(path, config)
    return result
  })
}

/**
 * Normalize what a user pastes — `https://site.com`, `site.com/`, or the full
 * `https://site.com/_instatic/mcp` from the admin UI — to the site origin.
 */
export function normalizeSiteUrl(input: string): string {
  const trimmed = input.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new UsageError(`Not a valid URL: ${input}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UsageError(`URL must be http(s): ${input}`)
  }
  let path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith(MCP_PATH)) path = path.slice(0, -MCP_PATH.length)
  return `${url.origin}${path}`
}

export function mcpEndpoint(siteUrl: string): URL {
  return new URL(`${siteUrl}${MCP_PATH}`)
}

/** True when a token would travel in clear text to a non-local host. */
export function isInsecureRemote(siteUrl: string): boolean {
  const url = new URL(siteUrl)
  if (url.protocol === 'https:') return false
  return !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

export function selectedProfileName(flagProfile: string | undefined, env: Env, config: ConfigFile): string {
  return flagProfile ?? env.INSTATIC_PROFILE ?? config.current ?? DEFAULT_PROFILE
}

/** How a command authenticates. OAuth credentials live in the profile and are refreshed in place. */
export type ConnectionAuth =
  | { kind: 'token'; token: string }
  | { kind: 'oauth'; configPath: string; profile: string }

export interface ResolvedConnection {
  url: string
  auth: ConnectionAuth
  /** Profile the values came from, when any did. */
  profile: string | null
}

export function resolveConnection(
  flags: { url?: string; token?: string; profile?: string },
  env: Env,
  config: ConfigFile,
  path: string,
): ResolvedConnection {
  const name = selectedProfileName(flags.profile, env, config)
  const saved = config.profiles[name]
  if (flags.profile && !saved) {
    throw new UsageError(`No saved profile "${flags.profile}". Run: instatic login --profile ${flags.profile} --url <site>`)
  }
  const url = flags.url ?? env.INSTATIC_URL ?? saved?.url
  const token = flags.token ?? env.INSTATIC_TOKEN
  if (url && token) return { url: normalizeSiteUrl(url), auth: { kind: 'token', token }, profile: null }
  if (!url || !saved) {
    throw new UsageError(
      'Not logged in. Run: instatic login --url <site> (signs in through the browser), ' +
        'or set INSTATIC_URL and INSTATIC_TOKEN (a token from Instatic → AI → MCP).',
    )
  }
  const siteUrl = normalizeSiteUrl(url)
  if (siteUrl !== normalizeSiteUrl(saved.url)) {
    throw new UsageError(`Profile "${name}" is for ${saved.url}, not ${siteUrl}. Pass a token or run instatic login --url ${siteUrl}.`)
  }
  const auth: ConnectionAuth = 'token' in saved
    ? { kind: 'token', token: saved.token }
    : { kind: 'oauth', configPath: path, profile: name }
  return { url: siteUrl, auth, profile: name }
}
