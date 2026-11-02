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
  writeConfig,
  type Env,
  type ResolvedConnection,
} from './config'
import { ConnectionError, InstaticSession, resultText, type ToolCallResult } from './connection'
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
  /** `wait-editor` timed out. */
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
  /** Test seam: replaces the network. */
  fetch?: FetchLike
  /** Test seam for `wait-editor` polling. */
  sleep?: (ms: number) => Promise<void>
}

const HELP = `instatic ${CLI_VERSION} — drive an Instatic site from the terminal or an AI agent

Usage: instatic <command> [options]

Setup
  login --url <site> [--token <t> | --token-stdin]   Save and verify a connection
  logout                                             Forget the selected profile
  profiles [use <name>]                              List or switch saved profiles
  status                                             Site, editor connection, tool count

Agent workflow
  guide                         Print the site's build rules (read this first)
  wait-editor [--scope site|content] [--timeout <s>]
                                Wait until the editor tab is open and connected
  tools [<name>]                List tools, or show one tool's input schema
  call <tool> [<json> | --input <file> | -]
                                Run a tool; prints its JSON result
  publish                       Publish the site (drafts go live)
  upload <file> [--alt <text>] [--name <filename>]
                                Add an image to the Media library

Integrations
  mcp                           Run as a local stdio MCP server (Claude Desktop,
                                Cursor, …) that forwards to the site

Global options
  --profile <name>   Saved profile to use (default: the current one)
  --url <site>       Site URL, overrides the profile (env INSTATIC_URL)
  --token <token>    Access token, overrides the profile (env INSTATIC_TOKEN)
  --json             Machine-readable output where supported
  -h, --help         Show help    --version  Show version

Exit codes: 0 ok · 1 tool error · 2 usage · 3 auth · 4 unreachable ·
            5 editor not connected · 6 server error

Create a token in Instatic under AI → MCP → Create access token.`

const CLI_GUIDE_NOTE = `

Using these tools from the instatic CLI:
- instatic call <tool> '<json args>' runs one tool and prints its JSON result.
- instatic tools <tool> shows a tool's input schema.
- Editing tools (site_*) need the Site editor open in a browser:
  run instatic wait-editor before a batch of edits.
- Exit code 1 means the tool reported an error (message on stderr); read it
  before retrying.`

function globalConnectionFlags(args: ParsedArgs) {
  return {
    url: stringFlag(args, 'url'),
    token: stringFlag(args, 'token'),
    profile: stringFlag(args, 'profile'),
  }
}

async function connect(args: ParsedArgs, io: CliIo): Promise<{ session: InstaticSession; connection: ResolvedConnection }> {
  const config = await readConfig(configPath(io.env))
  const connection = resolveConnection(globalConnectionFlags(args), io.env, config)
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

async function emitToolResult(io: CliIo, args: ParsedArgs, result: ToolCallResult): Promise<number> {
  if (booleanFlag(args, 'json')) {
    printJson(io, result)
    return result.isError ? EXIT.toolError : EXIT.ok
  }

  const imagesDir = stringFlag(args, 'images-dir')
  let imageIndex = 0
  for (const block of result.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = formatResultText(block.text)
      if (result.isError) io.stderr(`${text}\n`)
      else io.stdout(`${text}\n`)
      continue
    }
    if (block.type === 'image' && typeof block.data === 'string') {
      imageIndex++
      const extension = block.mimeType?.split('/')[1]?.split('+')[0] ?? 'bin'
      if (imagesDir) {
        await mkdir(imagesDir, { recursive: true })
        const path = join(imagesDir, `image-${imageIndex}.${extension}`)
        await writeFile(path, Buffer.from(block.data, 'base64'))
        io.stderr(`Saved image to ${path}\n`)
      } else {
        io.stderr(`[image ${imageIndex}: ${block.mimeType ?? 'unknown type'}; pass --images-dir <dir> to save it]\n`)
      }
    }
  }
  return result.isError ? EXIT.toolError : EXIT.ok
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

async function readToken(args: ParsedArgs, io: CliIo): Promise<string> {
  const flag = stringFlag(args, 'token')
  if (flag) return flag
  if (booleanFlag(args, 'token-stdin')) return (await io.readStdin()).trim()
  if (io.env.INSTATIC_TOKEN) return io.env.INSTATIC_TOKEN
  if (io.stdinIsTty && io.promptSecret) {
    return (await io.promptSecret('Access token (Instatic → AI → MCP → Create access token): ')).trim()
  }
  throw new UsageError('No token given. Pass --token <token>, --token-stdin, or set INSTATIC_TOKEN.')
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdLogin(args: ParsedArgs, io: CliIo): Promise<number> {
  const rawUrl = stringFlag(args, 'url') ?? args.positionals[1] ?? io.env.INSTATIC_URL
  if (!rawUrl) throw new UsageError('Pass the site URL: instatic login --url https://your-site.com')
  const url = normalizeSiteUrl(rawUrl)
  const token = await readToken(args, io)
  if (!token) throw new UsageError('The token is empty.')
  if (isInsecureRemote(url)) {
    io.stderr(`Warning: ${url} is not HTTPS, so the token travels unencrypted.\n`)
  }

  const session = await InstaticSession.open({ url, token, profile: null }, { clientVersion: CLI_VERSION, fetch: io.fetch })
  let context: EditorContext | null
  try {
    context = await readContext(session)
  } finally {
    await session.close()
  }

  const path = configPath(io.env)
  const config = await readConfig(path)
  const name = stringFlag(args, 'profile') ?? DEFAULT_PROFILE
  config.profiles[name] = { url, token }
  config.current = name
  await writeConfig(path, config)

  io.stdout(`Logged in to ${url}${context?.site ? ` (${context.site.name})` : ''} as profile "${name}".\n`)
  if (context && !context.editor.siteConnected) {
    io.stdout('The Site editor is not open yet: editing tools need it open in a browser.\n')
  }
  io.stdout('Next: instatic guide\n')
  return EXIT.ok
}

async function cmdLogout(args: ParsedArgs, io: CliIo): Promise<number> {
  const path = configPath(io.env)
  const config = await readConfig(path)
  const name = selectedProfileName(stringFlag(args, 'profile'), io.env, config)
  if (!config.profiles[name]) {
    io.stderr(`No saved profile "${name}".\n`)
    return EXIT.usage
  }
  delete config.profiles[name]
  if (config.current === name) delete config.current
  await writeConfig(path, config)
  io.stdout(`Removed profile "${name}". Revoke its token in Instatic under AI → MCP if it is no longer needed.\n`)
  return EXIT.ok
}

async function cmdProfiles(args: ParsedArgs, io: CliIo): Promise<number> {
  const path = configPath(io.env)
  const config = await readConfig(path)

  if (args.positionals[1] === 'use') {
    const name = args.positionals[2]
    if (!name) throw new UsageError('Usage: instatic profiles use <name>')
    if (!config.profiles[name]) throw new UsageError(`No saved profile "${name}".`)
    config.current = name
    await writeConfig(path, config)
    io.stdout(`Now using profile "${name}" (${config.profiles[name].url}).\n`)
    return EXIT.ok
  }

  const names = Object.keys(config.profiles).sort()
  if (booleanFlag(args, 'json')) {
    printJson(io, names.map((name) => ({ name, url: config.profiles[name].url, current: name === config.current })))
    return EXIT.ok
  }
  if (names.length === 0) {
    io.stdout('No saved profiles. Run: instatic login --url <site>\n')
    return EXIT.ok
  }
  for (const name of names) {
    io.stdout(`${name === config.current ? '*' : ' '} ${name}  ${config.profiles[name].url}\n`)
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
      printJson(io, tools.map((tool) => ({ name: tool.name, description: tool.description ?? '' })))
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
  return withSession(args, io, async (session) => emitToolResult(io, args, await session.callTool(name, input)))
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
  const config = await readConfig(configPath(io.env))
  const connection = resolveConnection(globalConnectionFlags(args), io.env, config)
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
  if (!command || booleanFlag(args, 'help') || command === 'help') {
    io.stdout(`${HELP}\n`)
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
