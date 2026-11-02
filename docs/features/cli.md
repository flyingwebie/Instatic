# `instatic` CLI

A command-line client for an Instatic site, published to npm as `instatic` and run with `npx instatic` or `bunx instatic`. It lets a person in a terminal, or an AI agent that works through a shell, use the same tools MCP clients get: inspect the site, run editing tools in the open editor, upload media, and publish. `instatic mcp` also runs it as a local stdio MCP server for desktop clients.

The CLI is a thin client of the [MCP endpoint](mcp-connectors.md). It holds no editing logic and no second protocol: every command is an authenticated MCP request to `/_instatic/mcp`, so capability checks, the editor bridge, and drafts-until-publish all behave exactly as they do for any MCP client.

## Why a CLI next to MCP

- **Shell-based agents.** Many coding agents are most reliable with a command that prints JSON and returns an exit code. `instatic call <tool> '<json>'` gives them that without an MCP client.
- **Build rules in the terminal.** MCP clients receive the server instructions automatically; shell agents do not. `instatic guide` prints them (the CSS/JS build rules from `server/ai/mcp/instructions.ts`) plus CLI usage notes.
- **Waiting for the editor.** Editing tools need the Site editor open in a browser. `instatic wait-editor` blocks until it is, so an agent can ask the user once instead of failing call after call.
- **A first-party stdio bridge.** `instatic mcp` replaces the generic `mcp-remote` bridge for desktop clients and adds safe retries.

## Commands

| Command | What it does |
|---|---|
| `login --url <site> [--token <t> \| --token-stdin] [--profile <name>]` | Verifies the token against the site (`get_context`), then saves the profile and makes it current. Prompts for the token without echo when run in a terminal. |
| `logout [--profile <name>]` | Forgets a saved profile. Does not revoke the token server-side. |
| `profiles [use <name>]` | Lists saved profiles (current marked `*`) or switches the current one. |
| `status [--json]` | Site name, URL, profile, whether the Site editor and Content workspace are connected, tool count. |
| `guide` | Prints the server's build rules and CLI usage notes. |
| `wait-editor [--scope site\|content] [--timeout <s>]` | Polls `get_context` every 2 s until the workspace is connected (default timeout 120 s). |
| `tools [<name>] [--json]` | Lists tools, or prints one tool's description and input schema. |
| `call <tool> [<json> \| --input <file> \| -] [--json] [--images-dir <dir>]` | Runs a tool. Text results print to stdout (pretty-printed JSON); error results print to stderr. Image results (e.g. `site_render_snapshot`) are saved to `--images-dir`. |
| `publish` | Runs `site_publish`. |
| `upload <file> [--alt <text>] [--name <filename>]` | Uploads an image with `media_upload` (inline base64). |
| `mcp` | Runs a stdio MCP server that forwards `tools/list` and `tools/call` to the site and advertises the site's own instructions. |

Global options: `--profile`, `--url`, `--token`, `--json`, `--help`, `--version`.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | The tool ran and reported an error (message on stderr). |
| 2 | Usage error: bad arguments, not logged in, unknown command. |
| 3 | Authentication failed: token expired, revoked, or wrong. |
| 4 | The site could not be reached. |
| 5 | `wait-editor` timed out. |
| 6 | Any other server or protocol failure. |

## Configuration

Profiles live in one JSON file, written with owner-only permissions (`0600`) because it holds personal access tokens:

1. `$INSTATIC_CONFIG`, else
2. `$XDG_CONFIG_HOME/instatic/config.json`, else
3. `~/.config/instatic/config.json`.

The shape is `{ current?, profiles: { <name>: { url, token } } }`, validated with TypeBox on read. Every command resolves its connection as: `--url` / `--token` flags, then `INSTATIC_URL` / `INSTATIC_TOKEN`, then the selected profile (`--profile`, `INSTATIC_PROFILE`, or the saved current one). URLs are normalized, so a site origin and the full `…/_instatic/mcp` URL copied from the admin UI both work. `login` warns when a non-local URL is plain HTTP.

Tokens are the same personal access tokens as any MCP client: **AI → MCP → Create access token**. Hosted OAuth is not used by the CLI.

## Reliability rules

`packages/cli/src/connection.ts` wraps the MCP SDK client:

- The client pins MCP `2026-07-28` (the only revision Instatic serves as modern), so there is no version probe or fallback.
- Failures are classified as `auth`, `unreachable`, or `server`. The SDK nests the real network error under `data.cause` as well as `cause`; the classifier walks both.
- **Discovery and reads** (`connect`, `tools/list`) retry twice (500 ms, then 1.5 s) on network failures and gateway statuses (502/503/504). Each attempt builds a fresh client, since an SDK transport starts once.
- **Tool calls retry only when the request never reached the server**: connection refused, DNS failure, or a gateway status. A connection reset after sending is not retried, so a write is never applied twice.
- Tool calls use a 150 s timeout, above the server's own budget (up to 15 s waiting for the editor tab plus 90 s for the editor to run the tool). The SDK default of 60 s would cut slow editor calls off.

`instatic mcp` (`stdioProxy.ts`) opens the remote session lazily and reopens it after an `unreachable` failure, so the desktop client keeps a live stdio server through site restarts. Connection failures during `tools/call` come back as tool errors with the classified message instead of protocol errors. The proxy exits cleanly when the desktop client closes its stdin.

## Package layout

```text
packages/cli/
  package.json        name "instatic", bin "instatic" → dist/instatic.js, Node >= 20
  tsconfig.json       own strict project, referenced from the root tsconfig (tsc -b)
  README.md           npm package page
  src/index.ts        executable: wires process streams, hidden token prompt
  src/cli.ts          command dispatch; all I/O injected through CliIo
  src/args.ts         minimal argv parser
  src/config.ts       profiles, URL normalization, connection resolution
  src/connection.ts   MCP session, failure classification, safe retries
  src/stdioProxy.ts   `instatic mcp`
  src/cli.test.ts     end-to-end tests against the real handleMcpHttp
```

`scripts/build-cli.ts` (`bun run cli:build`) bundles `src/index.ts` with `Bun.build` into a single minified `dist/instatic.js` for Node. Every dependency (the MCP SDK packages, TypeBox) is inlined, so the published package has no runtime dependencies and `npx` installs one file. `bun run cli` runs the TypeScript source directly during development.

The MCP SDK packages are allowed here as well as under `server/ai/mcp/`: the CLI is a client of that server. `ai-driver-isolation.test.ts` scans `packages/` and allows the `packages/cli/` prefix.

## Tests

`packages/cli/src/cli.test.ts` runs every command in-process with `fetch` routed into `handleMcpHttp` over an in-memory SQLite site: login and the `0600` config file, auth/unreachable/usage exit codes, gateway retries, `guide`, `tools`, headless and editor-relayed `call` (with a simulated editor bridge), stdin arguments, `wait-editor`, profiles, and the stdio proxy over an in-memory transport.

## Publishing

Publishing is a manual step:

```sh
cd packages/cli
npm version <patch|minor|major>   # bumps packages/cli/package.json
npm publish --access public        # prepublishOnly builds dist/ first
```

The CLI is versioned independently of the Instatic server. It depends only on the MCP wire protocol and the tool names it shortcuts (`get_context`, `site_publish`, `media_upload`).
