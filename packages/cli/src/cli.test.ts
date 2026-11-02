/**
 * The CLI end to end against the real MCP handler: every command runs
 * in-process with `fetch` routed straight into `handleMcpHttp` over an
 * in-memory SQLite site, so the wire protocol, auth, and tool engine are the
 * production ones.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { createSqliteClient } from '../../../server/db/sqlite'
import { sqliteMigrations } from '../../../server/db/migrations-sqlite'
import { runMigrations } from '../../../server/db/runMigrations'
import type { DbClient } from '../../../server/db/client'
import { handleMcpHttp } from '../../../server/ai/mcp'
import { createBearerConnection } from '../../../server/ai/mcp/connectors/store'
import { generatePersonalAccessToken, hashMcpSecret } from '../../../server/ai/mcp/connectors/token'
import { createEditorBridgeStream } from '../../../server/ai/mcp/editorBridge'
import { resolveBridgeToolResult } from '../../../server/ai/runtime'
import { EXIT, runCli, type CliIo } from './cli'
import { classifyFailure } from './connection'
import { createProxyServer } from './stdioProxy'

const SITE = 'http://localhost'

let db: DbClient
let token: string
let configDir: string
let userId: string

beforeEach(async () => {
  db = createSqliteClient(':memory:')
  await runMigrations(db, sqliteMigrations)
  userId = `cli-user-${Math.random().toString(36).slice(2)}`
  await db`
    insert into users (id, email, email_normalized, display_name, password_hash, role_id)
    values (${userId}, ${`${userId}@example.com`}, ${`${userId}@example.com`}, 'CLI User', 'x', 'owner')
  `
  token = generatePersonalAccessToken()
  await createBearerConnection(db, {
    userId,
    label: 'CLI test',
    capabilities: ['ai.chat', 'ai.tools.write', 'site.read', 'site.structure.edit', 'content.manage', 'pages.edit'],
    tokenHash: await hashMcpSecret(token),
  })
  configDir = await mkdtemp(join(tmpdir(), 'instatic-cli-'))
})

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true })
})

const handlerFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const res = await handleMcpHttp(new Request(input, init), db)
  return res ?? new Response(null, { status: 404 })
}

async function run(argv: string[], overrides: Partial<CliIo> = {}) {
  let stdout = ''
  let stderr = ''
  const code = await runCli({
    argv,
    env: { INSTATIC_CONFIG: join(configDir, 'config.json') },
    stdout: (text) => { stdout += text },
    stderr: (text) => { stderr += text },
    readStdin: async () => '',
    stdinIsTty: false,
    fetch: handlerFetch,
    sleep: async () => {},
    ...overrides,
  })
  return { code, stdout, stderr }
}

async function login() {
  const result = await run(['login', '--url', SITE, '--token', token])
  expect(result.code).toBe(EXIT.ok)
}

/** Play the Site editor: answer every relayed tool request with `answer`. */
async function openSiteEditor(answer: (toolName: string) => unknown) {
  const controller = new AbortController()
  const reader = createEditorBridgeStream(userId, 'site', controller.signal)
    .pipeThrough(new TextDecoderStream())
    .getReader()
  let bridgeId = ''
  let buffer = ''
  const ready = Promise.withResolvers<void>()
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += value
        let nl: number
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          const event = JSON.parse(line)
          if (event.type === 'bridgeReady') {
            bridgeId = event.bridgeId
            ready.resolve()
          }
          if (event.type === 'toolRequest') {
            resolveBridgeToolResult(bridgeId, event.requestId, { ok: true, data: answer(event.toolName) })
          }
        }
      }
    } catch {
      /* torn down by the test */
    }
  })()
  await ready.promise
  return () => controller.abort()
}

describe('instatic CLI', () => {
  it('logs in, saves an owner-only profile, and reports status', async () => {
    const login = await run(['login', '--url', `${SITE}/_instatic/mcp`, '--token', token])
    expect(login.code).toBe(EXIT.ok)
    expect(login.stdout).toContain('Logged in to http://localhost')
    expect(login.stdout).toContain('Site editor is not open')

    const configFile = join(configDir, 'config.json')
    const saved = JSON.parse(await readFile(configFile, 'utf8'))
    expect(saved).toEqual({ current: 'default', profiles: { default: { url: SITE, token } } })
    expect((await stat(configFile)).mode & 0o777).toBe(0o600)

    const status = await run(['status', '--json'])
    expect(status.code).toBe(EXIT.ok)
    const parsed = JSON.parse(status.stdout)
    expect(parsed).toMatchObject({ url: SITE, profile: 'default', siteEditorConnected: false })
    expect(parsed.tools).toBeGreaterThan(10)
  })

  it('exits with the auth code when the token is rejected', async () => {
    const result = await run(['login', '--url', SITE, '--token', 'imcp_pat_wrong'])
    expect(result.code).toBe(EXIT.auth)
    expect(result.stderr).toContain('rejected the access token')
  })

  it('retries, then exits with the unreachable code when a gateway says the site is down', async () => {
    let requests = 0
    const result = await run(['status', '--url', SITE, '--token', token], {
      fetch: async () => {
        requests++
        return new Response('upstream down', { status: 503 })
      },
    })
    expect(result.code).toBe(EXIT.unreachable)
    expect(result.stderr).toContain('Could not reach')
    expect(requests).toBe(3)
  })

  it('classifies Node\'s refused-connection error as unreachable', () => {
    const refused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), { code: 'ECONNREFUSED' }),
    })
    expect(classifyFailure(refused, SITE).kind).toBe('unreachable')
    expect(classifyFailure(new Error('boom'), SITE).kind).toBe('server')
  })

  it('tells the user to log in when no connection is configured', async () => {
    const result = await run(['status'])
    expect(result.code).toBe(EXIT.usage)
    expect(result.stderr).toContain('instatic login')
  })

  it('prints the build rules plus CLI usage in guide', async () => {
    await login()
    const result = await run(['guide'])
    expect(result.code).toBe(EXIT.ok)
    expect(result.stdout).toContain('site_write_page_script')
    expect(result.stdout).toContain('instatic call <tool>')
  })

  it('lists tools and shows one tool\'s schema', async () => {
    await login()
    const list = await run(['tools'])
    expect(list.stdout).toContain('get_context')
    const one = await run(['tools', 'site_write_page_script'])
    expect(one.code).toBe(EXIT.ok)
    expect(one.stdout).toContain('Input schema')
    expect((await run(['tools', 'no_such_tool'])).code).toBe(EXIT.usage)
  })

  it('calls a headless tool and prints its JSON result', async () => {
    await login()
    const result = await run(['call', 'get_context', '{}'])
    expect(result.code).toBe(EXIT.ok)
    expect(JSON.parse(result.stdout)).toHaveProperty('editor')
  })

  it('relays a browser tool through the open editor', async () => {
    await login()
    const close = await openSiteEditor((toolName) => ({ ran: toolName }))
    try {
      const result = await run(['call', 'site_write_page_script', '{"content":"console.info(1)"}'])
      expect(result.code).toBe(EXIT.ok)
      expect(JSON.parse(result.stdout)).toEqual({ ran: 'site_write_page_script' })
    } finally {
      close()
    }
  })

  it('reports tool errors on stderr with exit code 1', async () => {
    await login()
    const result = await run(['call', 'not_a_tool'])
    expect(result.code).toBe(EXIT.toolError)
    expect(result.stderr).toContain('Unknown tool')
  })

  it('rejects tool arguments that are not a JSON object', async () => {
    await login()
    expect((await run(['call', 'get_context', '[1]'])).code).toBe(EXIT.usage)
    expect((await run(['call', 'get_context', '{bad'])).code).toBe(EXIT.usage)
  })

  it('reads tool arguments from stdin', async () => {
    await login()
    const result = await run(['call', 'get_context', '-'], { readStdin: async () => '{"entryId":"x"}' })
    expect(result.code).toBe(EXIT.ok)
    expect(JSON.parse(result.stdout).page).toMatchObject({ found: false })
  })

  it('wait-editor times out when no editor opens, and succeeds once one is open', async () => {
    await login()
    const missing = await run(['wait-editor', '--timeout', '0'])
    expect(missing.code).toBe(EXIT.editorMissing)

    const close = await openSiteEditor(() => null)
    try {
      const ready = await run(['wait-editor', '--timeout', '0'])
      expect(ready.code).toBe(EXIT.ok)
      expect(ready.stdout).toContain('Site editor connected')
    } finally {
      close()
    }
  })

  it('switches and forgets profiles', async () => {
    await login()
    expect((await run(['login', '--profile', 'staging', '--url', SITE, '--token', token])).code).toBe(EXIT.ok)
    expect((await run(['profiles'])).stdout).toContain('* staging')
    expect((await run(['profiles', 'use', 'default'])).code).toBe(EXIT.ok)
    expect((await run(['profiles'])).stdout).toContain('* default')
    expect((await run(['logout', '--profile', 'staging'])).code).toBe(EXIT.ok)
    expect((await run(['profiles', '--json'])).stdout).not.toContain('staging')
  })

  it('serves the site over a local MCP proxy with the site\'s own instructions and tools', async () => {
    const { server, close } = await createProxyServer(
      { url: SITE, token, profile: null },
      { clientVersion: 'test', fetch: handlerFetch, log: () => {} },
    )
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'desktop', version: '0' })
    await client.connect(clientTransport)
    try {
      expect(client.getInstructions()).toContain('site_write_page_script')
      const { tools } = await client.listTools()
      expect(tools.some((tool) => tool.name === 'get_context')).toBe(true)
      const result = await client.callTool({ name: 'get_context', arguments: {} })
      expect(result.isError).toBeFalsy()
    } finally {
      await client.close()
      await close()
    }
  })
})
