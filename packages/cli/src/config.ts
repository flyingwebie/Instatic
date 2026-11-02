/**
 * Saved connection profiles.
 *
 * One JSON file (`$INSTATIC_CONFIG`, else `$XDG_CONFIG_HOME/instatic/config.json`,
 * else `~/.config/instatic/config.json`) holds named profiles — one per site —
 * and the current one. It stores personal access tokens, so it is written with
 * owner-only permissions.
 *
 * Resolution for every command, highest priority first: `--url` / `--token`
 * flags, then `INSTATIC_URL` / `INSTATIC_TOKEN`, then the selected profile
 * (`--profile`, `INSTATIC_PROFILE`, or the saved current one).
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { UsageError } from './args'

const ProfileSchema = Type.Object({
  url: Type.String({ minLength: 1 }),
  token: Type.String({ minLength: 1 }),
})
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

export async function writeConfig(path: string, config: ConfigFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  // `mode` only applies when the file is created; tighten an existing one too.
  await chmod(path, 0o600)
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

export interface ResolvedConnection {
  url: string
  token: string
  /** Profile the values came from, when any did. */
  profile: string | null
}

export function resolveConnection(
  flags: { url?: string; token?: string; profile?: string },
  env: Env,
  config: ConfigFile,
): ResolvedConnection {
  const name = selectedProfileName(flags.profile, env, config)
  const saved = config.profiles[name]
  if (flags.profile && !saved) {
    throw new UsageError(`No saved profile "${flags.profile}". Run: instatic login --profile ${flags.profile} --url <site>`)
  }
  const url = flags.url ?? env.INSTATIC_URL ?? saved?.url
  const token = flags.token ?? env.INSTATIC_TOKEN ?? saved?.token
  if (!url || !token) {
    throw new UsageError(
      'Not logged in. Run: instatic login --url <site> (create a token in Instatic under AI → MCP), ' +
        'or set INSTATIC_URL and INSTATIC_TOKEN.',
    )
  }
  return { url: normalizeSiteUrl(url), token, profile: saved ? name : null }
}
