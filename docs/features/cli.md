# `instatic` CLI

> Unofficial: published from this fork, not by the Instatic project. The npm README (`packages/cli/README.md`) says so at the top, and so does `instatic --help`.

A command-line client for an Instatic site, published to npm as `instatic` and run with `npx instatic` or `bunx instatic`. It lets a person in a terminal, or an AI agent that works through a shell, use the same tools MCP clients get: inspect the site, run editing tools in the open editor, upload media, and publish. `instatic mcp` also runs it as a local stdio MCP server for desktop clients.

The CLI is a thin client of the [MCP endpoint](mcp-connectors.md). It holds no editing logic and no second protocol: every command is an authenticated MCP request to `/_instatic/mcp`, so capability checks, the editor bridge, and drafts-until-publish all behave exactly as they do for any MCP client. Anything an agent needs that the tools cannot do belongs in a new MCP tool on the server, so every client gets it, not in CLI-only logic.

## Why a CLI next to MCP

- **Shell-based agents.** Many coding agents are most reliable with a command that prints JSON and returns an exit code. `instatic call <tool> '<json>'` gives them that without an MCP client.
- **Build rules in the terminal.** MCP clients receive the server instructions automatically; shell agents do not. `instatic guide` prints them (the CSS/JS build rules from `server/ai/mcp/instructions.ts`) plus CLI usage notes.
- **Waiting for the editor.** Editing tools need the Site editor open in a browser. `instatic wait-editor` blocks until it is, so an agent can ask the user once instead of failing call after call.
- **One connection for many calls.** `instatic batch` runs a list of tool calls in one process, instead of one handshake per `call`.
- **A first-party stdio bridge.** `instatic mcp` replaces the generic `mcp-remote` bridge for desktop clients and adds safe retries.

## Commands

| Command | What it does |
|---|---|
| `login --url <site> [--profile <name>] [--no-browser] [--port <n>]` | Browser sign-in (OAuth, see below), then verifies it with `get_context` and saves the profile as current. |
| `login --url <site> (--with-token \| --token <t>) [--profile <name>]` | Same with a personal access token. `--with-token` prompts without echo in a terminal, else reads stdin. |
| `logout [--profile <name>]` | Forgets a saved profile. Does not revoke the sign-in or token server-side (revoke it under AI → MCP). |
| `profiles [use <name>]` | Lists saved profiles (current marked `*`, with `token` or `oauth`) or switches the current one. |
| `status [--json]` | Site name, URL, profile, whether the Site editor and Content workspace are connected, tool count. |
| `guide` | Prints the server's build rules and CLI usage notes. |
| `wait-editor [--scope site\|content] [--timeout <s>]` | Polls `get_context` every 2 s until the workspace is connected (default timeout 120 s). |
| `tools [<name>] [--json [--schemas]]` | Lists tools, or prints one tool's description and input schema. `--json --schemas` prints every tool with its schema. |
| `call <tool> [<json> \| --input <file> \| -] [--json] [--images-dir <dir>] [--timeout <s>]` | Runs a tool. Text results print to stdout (pretty-printed JSON); error results print to stderr. Image results (e.g. `site_render_snapshot`) are saved to `--images-dir`. |
| `batch [<file> \| -] [--keep-going] [--images-dir <dir>] [--timeout <s>]` | Runs a JSON array, or one `{"tool", "args"}` object per line, over one session. Prints one JSON line per call (`{index, tool, ok, result}` or `{index, tool, ok: false, error, editorNotOpen}`). Stops at the first failure unless `--keep-going`; exits with the first failure's code. |
| `publish` | Runs `site_publish`. |
| `upload <file> [--alt <text>] [--name <filename>]` | Uploads a file with `media_upload` (inline base64). Accepted types are the site's upload policy (Settings → Uploads). |
| `mcp` | Runs a stdio MCP server that forwards `tools/list` and `tools/call` to the site and advertises the site's own instructions. |

Global options: `--profile`, `--url`, `--token`, `--json`, `--help`, `--version`. `instatic <command> --help` (or `instatic help <command>`) prints one command's usage.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | The tool ran and reported an error (message on stderr). |
| 2 | Usage error: bad arguments, not logged in, unknown command. |
| 3 | Authentication failed: the token or sign-in expired, was revoked, or is wrong. |
| 4 | The site could not be reached. |
| 5 | The Site editor / Content workspace is not open: `wait-editor` timed out, or a `call` / `batch` step needed it (the server marks that result with `_meta["instatic/error"] = "workspace_not_connected"`). |
| 6 | Any other server or protocol failure. |

## Configuration

Profiles live in one JSON file, with owner-only permissions (`0600`) on macOS and Linux because it holds credentials. On Windows the mode is advisory and the user-profile folder's ACL protects it.

1. `$INSTATIC_CONFIG`, else
2. `$XDG_CONFIG_HOME/instatic/config.json`, else
3. `~/.config/instatic/config.json`.

The shape is `{ current?, profiles: { <name>: { url, token } | { url, oauth } } }`, validated with TypeBox on read. `oauth` holds the issuer, the exact `resource`, the token endpoint, the dynamically registered `clientId`, the access and refresh tokens, and the access token's expiry.

Every command resolves its connection as follows. `--token` / `INSTATIC_TOKEN`, together with `--url` / `INSTATIC_URL`, wins. Otherwise the selected profile is used (`--profile`, `INSTATIC_PROFILE`, or the saved current one). A `--url` that differs from the profile's site is a usage error rather than a reason to send that profile's credentials elsewhere. URLs are normalized, so a site origin and the full `…/_instatic/mcp` URL copied from the admin UI both work. `login` warns when a non-local URL is plain HTTP.

Several processes may share the file: an agent running calls in parallel next to a long-lived `instatic mcp`. So every write goes through `updateConfig`: a lock file (`config.json.lock`, created exclusively, treated as stale after 120 s) serializes writers, and the new content replaces the old by atomic rename.

### Browser sign-in (OAuth)

`login` without a token uses the site's own OAuth authorization server ([MCP connectors](mcp-connectors.md) → "Hosted OAuth flow"), in `packages/cli/src/oauthLogin.ts`:

1. **Discover** the authorization server from the MCP endpoint (RFC 9728, then RFC 8414). The `resource` comes from the site's metadata, and it must equal the URL the user typed; otherwise `login` names the site's real public address (for example `www.` against the bare domain). A site without `PUBLIC_ORIGIN` offers no metadata, so `login` says so and points to `--with-token`.
2. **Listen** on `127.0.0.1` (random port, or `--port` for SSH forwarding). Register a public client for that loopback callback (dynamic client registration, `token_endpoint_auth_method: none`).
3. **Open** the consent page (PKCE S256, scope `mcp offline_access`, a 32-byte random `state`). The browser is started without a shell (`open`, `rundll32 url.dll,FileProtocolHandler`, or `xdg-open`) and is skipped on a display-less Linux. The URL is always printed as well.
4. **Check the callback.** It must carry the same `state`, compared in constant time; any other request is refused without ending the wait. The SDK's code exchange validates `iss` (RFC 9207) against the issuer, and the server always sends it. The wait lasts 10 minutes, long enough for a step-up prompt on the consent page.

### Refreshing without self-revocation

The server rotates refresh tokens and treats a reused one as stolen, revoking the whole grant. `credentials.ts` follows one protocol so parallel processes can never trigger that:

- The profile is read from disk on every request, never cached in memory. A long-lived `instatic mcp` therefore picks up tokens rotated by other processes.
- The access token is refreshed 60 s before expiry, and once more after a `401`. A `401` means nothing ran, so the request is safely re-sent once.
- A refresh runs only while holding the config lock, and only after re-reading the profile inside it. If another process already rotated the tokens, those are used and no second refresh is sent. A refresh request times out after 30 s, well under the lock's stale threshold, so a lock is never stolen mid-refresh.
- `invalid_grant` therefore means the sign-in itself is gone (revoked or past its 90 days), not that a race was lost. The CLI exits `3` and asks to run `login` again.

## Reliability rules

`packages/cli/src/connection.ts` wraps the MCP SDK client:

- The client pins MCP `2026-07-28` (the only revision Instatic serves as modern), so there is no version probe or fallback.
- Failures are classified as `auth`, `unreachable`, or `server`. The SDK nests the real network error under `data.cause` as well as `cause`; the classifier walks both.
- The bearer token comes from `credentials.ts` per request, through a `fetch` wrapper. Errors raised by the credentials (for example an expired sign-in) are already classified and are found anywhere in the SDK's error chain.
- **Discovery and reads** (`connect`, `tools/list`) retry twice (500 ms, then 1.5 s) on network failures and gateway statuses (502/503/504). Each attempt builds a fresh client, since an SDK transport starts once.
- **Tool calls retry only when the request never reached the server**: connection refused, DNS failure, or a gateway status. A connection reset after sending is not retried, so a write is never applied twice.
- Tool calls use a 150 s timeout (`--timeout` overrides it), above the server's own budget (up to 15 s waiting for the editor tab plus 90 s for the editor to run the tool). The SDK default of 60 s would cut slow editor calls off.

`instatic mcp` (`stdioProxy.ts`) opens the remote session lazily and reopens it after an `unreachable` failure, so the desktop client keeps a live stdio server through site restarts. Connection failures during `tools/call` come back as tool errors with the classified message instead of protocol errors. The proxy exits cleanly when the desktop client closes its stdin.

## Package layout

```text
packages/cli/
  package.json        name "instatic", bin "instatic" → dist/instatic.js, Node >= 20
  tsconfig.json       own strict project, referenced from the root tsconfig (tsc -b)
  README.md           npm package page
  src/index.ts        executable: wires process streams, hidden token prompt, browser opener
  src/cli.ts          command dispatch and per-command help; all I/O injected through CliIo
  src/args.ts         minimal argv parser
  src/config.ts       profiles, lock + atomic writes, URL normalization, connection resolution
  src/credentials.ts  bearer tokens; OAuth refresh under the lock
  src/oauthLogin.ts   browser sign-in (discovery, loopback callback, PKCE, code exchange)
  src/errors.ts       ConnectionError (auth / unreachable / server)
  src/connection.ts   MCP session, failure classification, safe retries
  src/stdioProxy.ts   `instatic mcp`
  src/cli.test.ts     end-to-end tests against the real handleMcpHttp
```

`scripts/build-cli.ts` (`bun run cli:build`) bundles `src/index.ts` with `Bun.build` into a single minified `dist/instatic.js` for Node. Every dependency (the MCP SDK packages, TypeBox) is inlined, so the published package has no runtime dependencies and `npx` installs one file. `bun run cli` runs the TypeScript source directly during development.

The MCP SDK packages are allowed here as well as under `server/ai/mcp/`: the CLI is a client of that server. `ai-driver-isolation.test.ts` scans `packages/` and allows the `packages/cli/` prefix.

## Tests

`packages/cli/src/cli.test.ts` runs every command in-process, with `fetch` routed into `handleMcpHttp` and the OAuth endpoints over an in-memory SQLite site. It covers:

- **Logging in:** token login and the `0600` config file; browser sign-in end to end, with the test approving consent and following the redirect to the real loopback listener, and a forged-`state` callback that is refused.
- **Refreshing:** an expired token refreshed by five parallel commands without revoking the sign-in; renewal after a `401`; a revoked sign-in exiting `3`.
- **Credentials:** a profile's credentials never going to another `--url`.
- **Exit codes and retries:** auth, unreachable, and usage exit codes; gateway retries.
- **Tool calls:** `guide`, `tools`, headless and editor-relayed `call` (with a simulated editor bridge), stdin arguments, `batch` (stop and `--keep-going`), and exit `5` when no editor is open.
- **The rest:** `wait-editor`, profiles, per-command help, and the stdio proxy over an in-memory transport.

## Publishing

Publishing is a manual step:

```sh
cd packages/cli
npm version <patch|minor|major>   # bumps packages/cli/package.json
npm publish --access public        # prepublishOnly builds dist/ first
```

The CLI is versioned independently of the Instatic server. It depends only on:

- the MCP wire protocol and the OAuth endpoints;
- the tool names it shortcuts (`get_context`, `site_publish`, `media_upload`);
- the `instatic/error` result marker.
