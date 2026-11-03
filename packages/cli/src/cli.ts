/**
 * Command dispatch for the `instatic` CLI.
 *
 * Everything the commands touch — argv, env, streams, stdin, the network — is
 * injected through `CliIo`, so the whole CLI runs in-process under test
 * against the real MCP handler. `index.ts` wires the real process.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { FetchLike } from '@modelcontextprotocol/client'
import { booleanFlag, parseArgs, stringFlag, UsageError, type ParsedArgs } from './args'
import {
  configPath,
  DEFAULT_PROFILE,
  isInsecureRemote,
  normalizeSiteUrl,
  readConfig,
  resolveConnection,
  selectedProfileName,
  updateConfig,
  type Env,
  type ResolvedConnection,
} from './config'
import { InstaticSession, resultText, type ToolCallResult } from './connection'
import { saveOAuthProfile } from './credentials'
import { ConnectionError } from './errors'
import { oauthLogin } from './oauthLogin'
import { runStdioProxy } from './stdioProxy'
import pkg from '../package.json' with { type: 'json' }

export const CLI_VERSION: string = pkg.version

export const EXIT = {
  ok: 0,
  /** The tool ran and reported an error. */
  toolError: 1,
  usage: 2,
  auth: 3,
  unreachable: 4,
  /** The Site editor / Content workspace is not open: `wait-editor` timed out, or a tool needed it. */
  editorMissing: 5,
  server: 6,
} as const

export interface CliIo {
  argv: readonly string[]
  env: Env
  stdout: (text: string) => void
  stderr: (text: string) => void
  readStdin: () => Promise<string>
  stdinIsTty: boolean
  /** Ask for a secret without echoing it. Absent when there is no terminal. */
  promptSecret?: (question: string) => Promise<string>
  /** Open a URL in the user's browser; false when none could be started. */
  openBrowser?: (url: string) => Promise<boolean>
  /** Test seam: replaces the network. */
  fetch?: FetchLike
  /** Test seam for `wait-editor` polling. */
  sleep?: (ms: number) => Promise<void>
}

const HELP = `instatic ${CLI_VERSION} — drive an Instatic site from the terminal or an AI agent
Unofficial community tool; not affiliated with the Instatic project.

Usage: instatic <command> [options]      instatic <command> --help for details

Setup
  login --url <site>            Sign in through the browser (OAuth)
  login --url <site> --with-token
                                Sign in with an access token instead
  logout                        Forget the selected profile
  profiles [use <name>]         List or switch saved profiles
  status                        Site, editor connection, tool count

Agent workflow
  guide                         Print the site's build rules (read this first)
  wait-editor                   Wait until the editor tab is open and connected
  tools [<name>]                List tools, or show one tool's input schema
  call <tool> [<json> | --input <file> | -]
                                Run a tool; prints its JSON result
  batch [<file> | -]            Run many tool calls over one connection
  publish                       Publish the site (drafts go live)
  upload <file>                 Add a file to the Media library

Integrations
  mcp                           Run as a local stdio MCP server (Claude Desktop,
                                Cursor, …) that forwards to the site

Global options
  --profile <name>   Saved profile to use (default: the current one)
  --url <site>       Site URL (env INSTATIC_URL)
  --token <token>    Access token, overrides the profile (env INSTATIC_TOKEN)
  --json             Machine-readable output where supported
  -h, --help         Show help    --version  Show version

Exit codes: 0 ok · 1 tool error · 2 usage · 3 auth · 4 unreachable ·
            5 editor not open · 6 server error`

const COMMAND_HELP: Record<string, string> = {
  login: `instatic login --url <site> [--profile <name>] [--no-browser] [--port <n>]
instatic login --url <site> --with-token [--profile <name>]
instatic login --url <site> --token <token> [--profile <name>]

Signs in and saves the connection as a profile (default "default"), then makes
it the current one.

Without a token, login signs in through the browser: approve access on the
Instatic consent page (you need to be an admin there). The CLI keeps the
sign-in fresh by itself for 90 days. Browser sign-in needs PUBLIC_ORIGIN set
on the server.

  --no-browser   Print the sign-in URL instead of opening a browser
  --port <n>     Fixed local callback port, e.g. to forward it over SSH:
                 ssh -L <n>:127.0.0.1:<n> <remote>, then open the URL locally
  --with-token   Use an access token (Instatic → AI → MCP → Create access
                 token): prompted for in a terminal, else read from stdin
  --token <t>    Pass the access token directly (visible in shell history)

For CI and scripts, skip login: set INSTATIC_URL and INSTATIC_TOKEN.`,
  logout: `instatic logout [--profile <name>]

Forgets a saved profile. The sign-in or token stays valid on the server until
you revoke it in Instatic under AI → MCP.`,
  profiles: `instatic profiles [--json]
instatic profiles use <name>

Lists saved profiles (the current one is marked *), or switches the current one.`,
  status: `instatic status [--json]

Shows the site, the profile, whether the Site editor and Content workspace are
open, and how many tools the connection may use.`,
  guide: `instatic guide

Prints the site's build rules for agents (where CSS and JS belong, how to
verify work) and notes on using them from this CLI. Read it before editing.`,
  'wait-editor': `instatic wait-editor [--scope site|content] [--timeout <seconds>]

Waits until the Site editor (default) or Content workspace is open in a
browser, signed in as the token's owner. Default timeout 120 s; exit code 5 on
timeout. Editing tools need it open; reads, upload and publish do not.`,
  tools: `instatic tools [--json [--schemas]]
instatic tools <name> [--json]

Lists the tools this connection may use, or shows one tool's description and
input schema. --json --schemas prints every tool with its schema at once.`,
  call: `instatic call <tool> [<json> | --input <file> | -] [--json] [--images-dir <dir>] [--timeout <seconds>]

Runs one tool. Arguments are a JSON object: inline, from a file (--input), or
from stdin (- or --input -). Prefer a file or stdin for large HTML.

Prints the result's JSON to stdout. A tool error prints to stderr with exit
code 1; exit code 5 means the tool needs the editor open (run wait-editor,
then retry). Images (site_render_snapshot) are saved with --images-dir.
--json prints the raw MCP result instead. Default timeout 150 s.`,
  batch: `instatic batch [<file> | -] [--keep-going] [--images-dir <dir>] [--timeout <seconds>]

Runs several tool calls over one connection, in order. The input (a file, or
stdin) is a JSON array, or one JSON object per line:

  {"tool": "site_add_page", "args": {"title": "About"}}
  {"tool": "site_insert_html", "args": {"parentId": "root", "html": "<section>…</section>"}}

Prints one JSON line per call: {"index", "tool", "ok", "result"} on success,
{"index", "tool", "ok": false, "error", "editorNotOpen"} on failure.
Stops at the first failure unless --keep-going. The exit code is the first
failure's (1 tool error, 5 editor not open), or 0.`,
  publish: `instatic publish

Publishes the saved site draft: every edit so far goes live.`,
  upload: `instatic upload <file> [--alt <text>] [--name <filename>]

Uploads a file to the Media library and prints its id and public path. Allowed
types follow the site's Settings → Uploads (by default images, MP4/WebM, web
fonts, PDF and office documents).`,
  mcp: `instatic mcp

Runs a local stdio MCP server that forwards to the site, for desktop MCP
clients such as Claude Desktop or Cursor. Uses the selected profile (log in
first) or INSTATIC_URL / INSTATIC_TOKEN.`,
}

const CLI_GUIDE_NOTE = `

Using these tools from the instatic CLI:
- instatic call <tool> '<json args>' runs one tool and prints its JSON result.
  Pass large arguments from a file (--input args.json) or stdin (-).
- instatic batch runs many calls over one connection (instatic batch --help).
- instatic tools <tool> shows a tool's input schema.
- Editing tools (site_*) need the Site editor open in a browser:
  run instatic wait-editor before a batch of edits.
- Exit code 1 means the tool reported an error (message on stderr); read it
  before retrying. Exit code 5 means the editor is not open: run
  instatic wait-editor, then retry.`

function globalConnectionFlags(args: ParsedArgs) {
  return {
    url: stringFlag(args, 'url'),
    token: stringFlag(args, 'token'),
    profile: stringFlag(args, 'profile'),
  }
}

async function resolve(args: ParsedArgs, io: CliIo): Promise<ResolvedConnection> {
  const path = configPath(io.env)
  return resolveConnection(globalConnectionFlags(args), io.env, await readConfig(path), path)
}

async function connect(args: ParsedArgs, io: CliIo): Promise<{ session: InstaticSession; connection: ResolvedConnection }> {
  const connection = await resolve(args, io)
  const session = await InstaticSession.open(connection, { clientVersion: CLI_VERSION, fetch: io.fetch })
  return { session, connection }
}

async function withSession<T>(
  args: ParsedArgs,
  io: CliIo,
  run: (session: InstaticSession, connection: ResolvedConnection) => Promise<T>,
): Promise<T> {
  const { session, connection } = await connect(args, io)
  try {
    return await run(session, connection)
  } finally {
    await session.close()
  }
}

function printJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`)
}

/** A tool result's text, pretty-printed when it is JSON. */
function formatResultText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

interface EditorContext {
  site: { name: string } | null
  editor: { siteConnected: boolean; contentConnected: boolean }
}

function parseContext(result: ToolCallResult): EditorContext | null {
  if (result.isError) return null
  try {
    const parsed: unknown = JSON.parse(resultText(result))
    if (typeof parsed !== 'object' || parsed === null || !('editor' in parsed)) return null
    const { site, editor } = parsed as { site?: unknown; editor?: unknown }
    if (typeof editor !== 'object' || editor === null) return null
    const flags = editor as Record<string, unknown>
    return {
      site: typeof site === 'object' && site !== null && typeof (site as { name?: unknown }).name === 'string'
        ? { name: (site as { name: string }).name }
        : null,
      editor: {
        siteConnected: flags.siteConnected === true,
        contentConnected: flags.contentConnected === true,
      },
    }
  } catch {
    return null
  }
}

async function readContext(session: InstaticSession): Promise<EditorContext | null> {
  return parseContext(await session.callTool('get_context', {}))
}

function resultExitCode(result: ToolCallResult): number {
  if (result.workspaceNotConnected) return EXIT.editorMissing
  return result.isError ? EXIT.toolError : EXIT.ok
}

/** Save a result's image blocks to `dir`; returns the paths. */
async function saveImages(result: ToolCallResult, dir: string, prefix: string): Promise<string[]> {
  const paths: string[] = []
  for (const block of result.content) {
    if (block.type !== 'image' || typeof block.data !== 'string') continue
    const extension = block.mimeType?.split('/')[1]?.split('+')[0] ?? 'bin'
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${prefix}${paths.length + 1}.${extension}`)
    await writeFile(path, Buffer.from(block.data, 'base64'))
    paths.push(path)
  }
  return paths
}

async function emitToolResult(io: CliIo, args: ParsedArgs, result: ToolCallResult): Promise<number> {
  if (booleanFlag(args, 'json')) {
    printJson(io, result)
    return resultExitCode(result)
  }

  for (const block of result.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = formatResultText(block.text)
      if (result.isError) io.stderr(`${text}\n`)
      else io.stdout(`${text}\n`)
    }
  }
  const imagesDir = stringFlag(args, 'images-dir')
  const imageCount = result.content.filter((block) => block.type === 'image').length
  if (imagesDir) {
    for (const path of await saveImages(result, imagesDir, 'image-')) io.stderr(`Saved image to ${path}\n`)
  } else if (imageCount > 0) {
    io.stderr(`[${imageCount} image(s) in the result; pass --images-dir <dir> to save them]\n`)
  }
  return resultExitCode(result)
}

/** `--timeout <seconds>` for tool calls, in milliseconds. */
function callTimeoutMs(args: ParsedArgs): number | undefined {
  const raw = stringFlag(args, 'timeout')
  if (raw === undefined) return undefined
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError('--timeout must be a positive number of seconds.')
  return seconds * 1000
}

async function readToolInput(args: ParsedArgs, io: CliIo): Promise<Record<string, unknown>> {
  const inline = args.positionals[2]
  const inputFile = stringFlag(args, 'input')
  if (inline !== undefined && inputFile !== undefined) {
    throw new UsageError('Pass tool arguments either inline or with --input, not both.')
  }

  let raw: string
  if (inputFile === '-' || inline === '-') raw = await io.readStdin()
  else if (inputFile !== undefined) raw = await readFile(inputFile, 'utf8')
  else if (inline !== undefined) raw = inline
  else return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UsageError('Tool arguments must be a JSON object, e.g. \'{"pageId":"abc"}\'.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UsageError('Tool arguments must be a JSON object, e.g. \'{"pageId":"abc"}\'.')
  }
  return parsed as Record<string, unknown>
}

/** The access token for `login`, or null to sign in through the browser. */
async function readLoginToken(args: ParsedArgs, io: CliIo): Promise<string | null> {
  const flag = stringFlag(args, 'token')
  if (flag) return flag
  if (booleanFlag(args, 'with-token')) {
    if (io.stdinIsTty && io.promptSecret) {
      return (await io.promptSecret('Access token (Instatic → AI → MCP → Create access token): ')).trim()
    }
    return (await io.readStdin()).trim()
  }
  if (io.env.INSTATIC_TOKEN) return io.env.INSTATIC_TOKEN
  return null
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdLogin(args: ParsedArgs, io: CliIo): Promise<number> {
  const rawUrl = stringFlag(args, 'url') ?? args.positionals[1] ?? io.env.INSTATIC_URL
  if (!rawUrl) throw new UsageError('Pass the site URL: instatic login --url https://your-site.com')
  const url = normalizeSiteUrl(rawUrl)
  const name = stringFlag(args, 'profile') ?? DEFAULT_PROFILE
  const path = configPath(io.env)
  const token = await readLoginToken(args, io)
  if (token === '') throw new UsageError('The token is empty.')
  if (isInsecureRemote(url)) {
    io.stderr(`Warning: ${url} is not HTTPS, so credentials travel unencrypted.\n`)
  }

  if (token === null) {
    const portRaw = stringFlag(args, 'port')
    const port = portRaw === undefined ? 0 : Number(portRaw)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError('--port must be a port number.')
    const session = await oauthLogin(url, {
      fetch: io.fetch,
      openBrowser: booleanFlag(args, 'no-browser') ? undefined : io.openBrowser,
      log: io.stderr,
      port,
    })
    await saveOAuthProfile(path, name, url, session)
  }

  // Verify the saved credentials end to end (and read the site name).
  const connection: ResolvedConnection = token === null
    ? { url, auth: { kind: 'oauth', configPath: path, profile: name }, profile: name }
    : { url, auth: { kind: 'token', token }, profile: name }
  const session = await InstaticSession.open(connection, { clientVersion: CLI_VERSION, fetch: io.fetch })
  let context: EditorContext | null
  try {
    context = await readContext(session)
  } finally {
    await session.close()
  }
  if (token !== null) {
    await updateConfig(path, (config) => {
      config.profiles[name] = { url, token }
      config.current = name
    })
  }

  const method = token === null ? 'browser sign-in' : 'access token'
  io.stdout(`Logged in to ${url}${context?.site ? ` (${context.site.name})` : ''} as profile "${name}" (${method}).\n`)
  if (context && !context.editor.siteConnected) {
    io.stdout('The Site editor is not open yet: editing tools need it open in a browser.\n')
  }
  io.stdout('Next: instatic guide\n')
  return EXIT.ok
}

async function cmdLogout(args: ParsedArgs, io: CliIo): Promise<number> {
  const path = configPath(io.env)
  const removed = await updateConfig(path, (config) => {
    const name = selectedProfileName(stringFlag(args, 'profile'), io.env, config)
    const profile = config.profiles[name]
    if (!profile) return { name, kind: null }
    delete config.profiles[name]
    if (config.current === name) delete config.current
    return { name, kind: 'token' in profile ? 'token' : 'sign-in' }
  })
  if (!removed.kind) {
    io.stderr(`No saved profile "${removed.name}".\n`)
    return EXIT.usage
  }
  io.stdout(`Removed profile "${removed.name}". Its ${removed.kind} stays valid on the server: revoke it in Instatic under AI → MCP if it is no longer needed.\n`)
  return EXIT.ok
}

async function cmdProfiles(args: ParsedArgs, io: CliIo): Promise<number> {
  const path = configPath(io.env)
  const config = await readConfig(path)

  if (args.positionals[1] === 'use') {
    const name = args.positionals[2]
    if (!name) throw new UsageError('Usage: instatic profiles use <name>')
    if (!config.profiles[name]) throw new UsageError(`No saved profile "${name}".`)
    await updateConfig(path, (latest) => {
      if (!latest.profiles[name]) throw new UsageError(`No saved profile "${name}".`)
      latest.current = name
    })
    io.stdout(`Now using profile "${name}" (${config.profiles[name].url}).\n`)
    return EXIT.ok
  }

  const names = Object.keys(config.profiles).sort()
  const authOf = (name: string) => ('token' in config.profiles[name] ? 'token' : 'oauth')
  if (booleanFlag(args, 'json')) {
    printJson(io, names.map((name) => ({
      name,
      url: config.profiles[name].url,
      auth: authOf(name),
      current: name === config.current,
    })))
    return EXIT.ok
  }
  if (names.length === 0) {
    io.stdout('No saved profiles. Run: instatic login --url <site>\n')
    return EXIT.ok
  }
  for (const name of names) {
    io.stdout(`${name === config.current ? '*' : ' '} ${name}  ${config.profiles[name].url}  (${authOf(name)})\n`)
  }
  return EXIT.ok
}

async function cmdStatus(args: ParsedArgs, io: CliIo): Promise<number> {
  return withSession(args, io, async (session, connection) => {
    const [context, tools] = await Promise.all([readContext(session), session.listTools()])
    const status = {
      url: connection.url,
      profile: connection.profile,
      server: session.serverVersion() ?? null,
      site: context?.site?.name ?? null,
      siteEditorConnected: context?.editor.siteConnected ?? null,
      contentWorkspaceConnected: context?.editor.contentConnected ?? null,
      tools: tools.length,
    }
    if (booleanFlag(args, 'json')) {
      printJson(io, status)
      return EXIT.ok
    }
    const yesNo = (value: boolean | null) => (value === null ? 'unknown' : value ? 'connected' : 'not open')
    io.stdout(
      [
        `Site:              ${status.site ?? '(unknown)'} — ${status.url}`,
        `Profile:           ${status.profile ?? '(from flags/env)'}`,
        `Site editor:       ${yesNo(status.siteEditorConnected)}`,
        `Content workspace: ${yesNo(status.contentWorkspaceConnected)}`,
        `Tools available:   ${status.tools}`,
      ].join('\n') + '\n',
    )
    return EXIT.ok
  })
}

async function cmdGuide(args: ParsedArgs, io: CliIo): Promise<number> {
  return withSession(args, io, async (session) => {
    io.stdout(`${session.instructions()}${CLI_GUIDE_NOTE}\n`)
    return EXIT.ok
  })
}

async function cmdTools(args: ParsedArgs, io: CliIo): Promise<number> {
  return withSession(args, io, async (session) => {
    const tools = await session.listTools()
    const name = args.positionals[1]
    if (name) {
      const tool = tools.find((candidate) => candidate.name === name)
      if (!tool) {
        io.stderr(`Unknown tool "${name}". Run instatic tools to list them.\n`)
        return EXIT.usage
      }
      if (booleanFlag(args, 'json')) printJson(io, tool)
      else io.stdout(`${tool.name}\n\n${tool.description ?? ''}\n\nInput schema:\n${JSON.stringify(tool.inputSchema, null, 2)}\n`)
      return EXIT.ok
    }
    if (booleanFlag(args, 'json')) {
      const withSchemas = booleanFlag(args, 'schemas')
      printJson(io, tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        ...(withSchemas ? { inputSchema: tool.inputSchema } : {}),
      })))
      return EXIT.ok
    }
    const width = Math.max(...tools.map((tool) => tool.name.length))
    for (const tool of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
      const summary = (tool.description ?? '').split(/(?<=\.)\s/)[0] ?? ''
      io.stdout(`${tool.name.padEnd(width)}  ${summary}\n`)
    }
    return EXIT.ok
  })
}

async function cmdCall(args: ParsedArgs, io: CliIo): Promise<number> {
  const name = args.positionals[1]
  if (!name) throw new UsageError('Usage: instatic call <tool> [<json> | --input <file> | -]')
  const input = await readToolInput(args, io)
  const timeoutMs = callTimeoutMs(args)
  return withSession(args, io, async (session) =>
    emitToolResult(io, args, await session.callTool(name, input, { timeoutMs })))
}

interface BatchStep {
  tool: string
  args: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBatchStep(value: unknown, position: string): BatchStep {
  if (!isRecord(value) || typeof value.tool !== 'string' || !value.tool) {
    throw new UsageError(`${position}: each step must be {"tool": "<name>", "args": {…}}.`)
  }
  if (value.args !== undefined && !isRecord(value.args)) {
    throw new UsageError(`${position}: "args" must be a JSON object.`)
  }
  return { tool: value.tool, args: value.args ?? {} }
}

/** A JSON array of steps, or one JSON object per line. */
export function parseBatch(raw: string): BatchStep[] {
  const trimmed = raw.trim()
  if (!trimmed) throw new UsageError('The batch is empty.')
  if (trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new UsageError('The batch is not valid JSON.')
    }
    if (!Array.isArray(parsed)) throw new UsageError('The batch must be a JSON array of steps.')
    return parsed.map((step, index) => parseBatchStep(step, `Step ${index}`))
  }
  return trimmed.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new UsageError(`Line ${index + 1} is not valid JSON.`)
    }
    return [parseBatchStep(parsed, `Line ${index + 1}`)]
  })
}

/** The result payload as a value: parsed JSON when the text is JSON. */
function resultValue(result: ToolCallResult): unknown {
  const text = resultText(result)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function cmdBatch(args: ParsedArgs, io: CliIo): Promise<number> {
  const source = args.positionals[1] ?? stringFlag(args, 'input') ?? '-'
  const steps = parseBatch(source === '-' ? await io.readStdin() : await readFile(source, 'utf8'))
  const keepGoing = booleanFlag(args, 'keep-going')
  const imagesDir = stringFlag(args, 'images-dir')
  const timeoutMs = callTimeoutMs(args)

  return withSession(args, io, async (session) => {
    let firstFailure: number = EXIT.ok
    for (const [index, step] of steps.entries()) {
      const result = await session.callTool(step.tool, step.args, { timeoutMs })
      const images = imagesDir ? await saveImages(result, imagesDir, `step-${index}-image-`) : []
      const line = result.isError
        ? { index, tool: step.tool, ok: false, error: resultText(result), editorNotOpen: result.workspaceNotConnected }
        : { index, tool: step.tool, ok: true, result: resultValue(result), ...(images.length ? { images } : {}) }
      io.stdout(`${JSON.stringify(line)}\n`)
      if (!result.isError) continue
      if (firstFailure === EXIT.ok) firstFailure = resultExitCode(result)
      if (!keepGoing) break
    }
    return firstFailure
  })
}

async function cmdPublish(args: ParsedArgs, io: CliIo): Promise<number> {
  return withSession(args, io, async (session) => emitToolResult(io, args, await session.callTool('site_publish', {})))
}

async function cmdUpload(args: ParsedArgs, io: CliIo): Promise<number> {
  const file = args.positionals[1]
  if (!file) throw new UsageError('Usage: instatic upload <file> [--alt <text>] [--name <filename>]')
  const bytes = await readFile(file)
  const input: Record<string, unknown> = {
    filename: stringFlag(args, 'name') ?? basename(file),
    data: bytes.toString('base64'),
  }
  const alt = stringFlag(args, 'alt')
  if (alt !== undefined) input.altText = alt
  return withSession(args, io, async (session) => emitToolResult(io, args, await session.callTool('media_upload', input)))
}

async function cmdWaitEditor(args: ParsedArgs, io: CliIo): Promise<number> {
  const scope = stringFlag(args, 'scope') ?? 'site'
  if (scope !== 'site' && scope !== 'content') throw new UsageError('--scope must be site or content.')
  const timeoutRaw = stringFlag(args, 'timeout') ?? '120'
  const timeoutSeconds = Number(timeoutRaw)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) throw new UsageError('--timeout must be a number of seconds.')
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const label = scope === 'site' ? 'Site editor' : 'Content workspace'

  return withSession(args, io, async (session) => {
    const deadline = Date.now() + timeoutSeconds * 1000
    let announced = false
    for (;;) {
      const context = await readContext(session)
      if (!context) {
        io.stderr('This token cannot read the editor status (get_context is unavailable).\n')
        return EXIT.server
      }
      const connected = scope === 'site' ? context.editor.siteConnected : context.editor.contentConnected
      if (connected) {
        io.stdout(`${label} connected.\n`)
        return EXIT.ok
      }
      if (Date.now() >= deadline) {
        io.stderr(`${label} did not connect within ${timeoutSeconds}s. Open it in a browser, signed in as the token's owner.\n`)
        return EXIT.editorMissing
      }
      if (!announced) {
        io.stderr(`Waiting for the ${label} to be opened in a browser…\n`)
        announced = true
      }
      await sleep(2000)
    }
  })
}

async function cmdMcp(args: ParsedArgs, io: CliIo): Promise<number> {
  const connection = await resolve(args, io)
  await runStdioProxy(connection, { clientVersion: CLI_VERSION, fetch: io.fetch, log: io.stderr })
  return EXIT.ok
}

const COMMANDS: Record<string, (args: ParsedArgs, io: CliIo) => Promise<number>> = {
  login: cmdLogin,
  logout: cmdLogout,
  profiles: cmdProfiles,
  status: cmdStatus,
  guide: cmdGuide,
  tools: cmdTools,
  call: cmdCall,
  batch: cmdBatch,
  publish: cmdPublish,
  upload: cmdUpload,
  'wait-editor': cmdWaitEditor,
  mcp: cmdMcp,
}

const EXIT_FOR_FAILURE = {
  auth: EXIT.auth,
  unreachable: EXIT.unreachable,
  server: EXIT.server,
} as const

export async function runCli(io: CliIo): Promise<number> {
  let args: ParsedArgs
  try {
    args = parseArgs(io.argv)
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`)
    return EXIT.usage
  }

  if (booleanFlag(args, 'version')) {
    io.stdout(`${CLI_VERSION}\n`)
    return EXIT.ok
  }
  const command = args.positionals[0]
  const helpTopic = command === 'help' ? args.positionals[1] : booleanFlag(args, 'help') ? command : undefined
  if (!command || command === 'help' || booleanFlag(args, 'help')) {
    io.stdout(`${(helpTopic && COMMAND_HELP[helpTopic]) || HELP}\n`)
    return EXIT.ok
  }
  const run = COMMANDS[command]
  if (!run) {
    io.stderr(`Unknown command "${command}". Run instatic --help.\n`)
    return EXIT.usage
  }

  try {
    return await run(args, io)
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`${err.message}\n`)
      return EXIT.usage
    }
    if (err instanceof ConnectionError) {
      io.stderr(`${err.message}\n`)
      return EXIT_FOR_FAILURE[err.kind]
    }
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.server
  }
}
