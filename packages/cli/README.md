# instatic

Command-line client for [Instatic](https://github.com/flyingwebie/Instatic) sites. Drive the visual editor, upload media, and publish from a terminal — or let an AI agent do it.

```sh
npx instatic login --url https://your-site.com
# or: bunx instatic login --url https://your-site.com
```

Create the access token in Instatic under **AI → MCP → Create access token**. `login` asks for it without echoing, or takes `--token` / `--token-stdin`.

## For AI agents

```sh
instatic guide                       # the site's build rules — read first
instatic wait-editor                 # block until the Site editor is open in a browser
instatic tools                       # list tools
instatic tools site_insert_html      # one tool's input schema
instatic call site_read_document '{}'
instatic call site_insert_html --input section.json
instatic publish                     # drafts go live
```

`call` prints the tool's JSON result to stdout. Exit codes are stable:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | The tool reported an error (message on stderr) |
| 2 | Usage error / not logged in |
| 3 | Token rejected (expired or revoked) |
| 4 | Site unreachable |
| 5 | `wait-editor` timed out |
| 6 | Other server error |

Editing tools run inside the Site editor, which must be open in a browser and signed in as the token's owner. Reads, `upload`, and `publish` work without it.

## Desktop MCP clients

`instatic mcp` runs a local stdio MCP server that forwards to your site, for clients such as Claude Desktop or Cursor:

```json
{
  "mcpServers": {
    "instatic": {
      "command": "npx",
      "args": ["-y", "instatic", "mcp"],
      "env": {
        "INSTATIC_URL": "https://your-site.com",
        "INSTATIC_TOKEN": "imcp_pat_…"
      }
    }
  }
}
```

## Commands

```text
login --url <site> [--token <t> | --token-stdin] [--profile <name>]
logout [--profile <name>]
profiles [use <name>]
status [--json]
guide
wait-editor [--scope site|content] [--timeout <seconds>]
tools [<name>] [--json]
call <tool> [<json> | --input <file> | -] [--json] [--images-dir <dir>]
publish
upload <file> [--alt <text>] [--name <filename>]
mcp
```

Global options: `--profile <name>`, `--url <site>`, `--token <token>`, `--json`.

Connections resolve from flags, then `INSTATIC_URL` / `INSTATIC_TOKEN`, then the saved profile. Profiles are stored in `~/.config/instatic/config.json` (or `$XDG_CONFIG_HOME/instatic/`, or `$INSTATIC_CONFIG`) with owner-only permissions.

Requires Node 20+ or Bun.
