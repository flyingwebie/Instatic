# instatic

> **Unofficial.** This CLI is a community project. It is **not** made, endorsed, or supported by the [Instatic](https://github.com/CoreBunch/Instatic) project or its maintainers. Please report problems with it to [this fork](https://github.com/flyingwebie/Instatic), not upstream.

Command-line client for Instatic sites. Drive the visual editor, upload media, and publish from a terminal, or let an AI agent do it.

```sh
npx instatic login --url https://your-site.com
# or: bunx instatic login --url https://your-site.com
```

`login` opens your browser on the site's consent page. Approve access there; you need to be an Instatic admin. The CLI keeps the sign-in fresh by itself for 90 days. Browser sign-in needs `PUBLIC_ORIGIN` set on the server.

To use an access token instead (Instatic → **AI → MCP → Create access token**):

```sh
instatic login --url https://your-site.com --with-token   # prompts, or reads stdin
```

On a remote machine over SSH, pass `--no-browser --port 8765`, forward the port (`ssh -L 8765:127.0.0.1:8765 <host>`), and open the printed URL locally. In CI, skip `login` and set `INSTATIC_URL` and `INSTATIC_TOKEN`.

## For AI agents

```sh
instatic guide                       # the site's build rules: read first
instatic wait-editor                 # block until the Site editor is open in a browser
instatic tools                       # list tools
instatic tools site_insert_html      # one tool's input schema
instatic call site_read_document '{}'
instatic call site_insert_html --input section.json
instatic batch steps.jsonl           # many calls over one connection
instatic publish                     # drafts go live
```

`call` prints the tool's JSON result to stdout. `batch` reads a JSON array, or one `{"tool": …, "args": {…}}` object per line, and prints one JSON result line per call. It stops at the first failure unless you pass `--keep-going`. Exit codes are stable:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | The tool reported an error (message on stderr) |
| 2 | Usage error / not logged in |
| 3 | Sign-in or token rejected (expired or revoked) |
| 4 | Site unreachable |
| 5 | The Site editor is not open (`wait-editor` timed out, or a tool needed it) |
| 6 | Other server error |

Editing tools run inside the Site editor, which must be open in a browser and signed in as the token's owner. Reads, `upload`, and `publish` work without it.

## Tools

`instatic tools` lists what your connection may use. A token or sign-in only sees the tools its granted capabilities allow. With every capability, a site offers these 54:

| Area | Tools |
|---|---|
| Orientation | `get_context`, `site_list_documents`, `site_read_document`, `site_open_document`, `site_list_modules`, `site_list_breakpoints`, `site_list_post_types`, `site_list_loop_sources` |
| Page structure | `site_insert_html`, `site_get_node_html`, `site_replace_node_html`, `site_update_node_props`, `site_move_node`, `site_duplicate_node`, `site_rename_node`, `site_delete_node` |
| Pages and templates | `site_add_page`, `site_duplicate_page`, `site_rename_page`, `site_delete_page`, `site_set_page_template`, `site_clear_page_template` |
| CSS and design tokens | `site_read_styles`, `site_apply_css`, `site_assign_class`, `site_remove_class`, `site_set_color_tokens`, `site_set_font_tokens`, `site_set_type_scale`, `site_set_spacing_scale` |
| Scripts and code files | `site_write_page_script`, `site_list_code_assets`, `site_read_code_asset`, `site_write_code_asset`, `site_patch_code_asset`, `site_inspect_code_runtime` |
| Verify and publish | `site_render_snapshot`, `site_publish` |
| Content | `content_list_collections`, `content_get_collection_schema`, `content_list_documents`, `content_get_document`, `content_search_documents`, `content_create_document`, `content_set_document_field`, `content_set_document_fields`, `content_set_document_status`, `content_set_document_author`, `content_delete_document`, `content_set_active_document`, `content_set_active_collection`, `content_list_users` |
| Media | `media_upload`, `content_list_media` |

Every tool runs through `instatic call <tool>` or `instatic batch`. `publish` and `upload` are shortcuts for `site_publish` and `media_upload`. `upload` accepts whatever file types the site's **Settings → Uploads** allows.

## Desktop MCP clients

`instatic mcp` runs a local stdio MCP server that forwards to your site, for clients such as Claude Desktop or Cursor. Log in once, then:

```json
{
  "mcpServers": {
    "instatic": {
      "command": "npx",
      "args": ["-y", "instatic", "mcp"]
    }
  }
}
```

Add `"--profile", "<name>"` to `args` for a non-default profile. You can also skip `login` and pass `"env": { "INSTATIC_URL": "https://your-site.com", "INSTATIC_TOKEN": "imcp_pat_…" }`.

## Commands

```text
login --url <site> [--profile <name>] [--no-browser] [--port <n>]
login --url <site> (--with-token | --token <t>) [--profile <name>]
logout [--profile <name>]
profiles [use <name>]
status [--json]
guide
wait-editor [--scope site|content] [--timeout <seconds>]
tools [<name>] [--json [--schemas]]
call <tool> [<json> | --input <file> | -] [--json] [--images-dir <dir>] [--timeout <seconds>]
batch [<file> | -] [--keep-going] [--images-dir <dir>] [--timeout <seconds>]
publish
upload <file> [--alt <text>] [--name <filename>]
mcp
```

`instatic <command> --help` explains one command. Global options: `--profile <name>`, `--url <site>`, `--token <token>`, `--json`.

Connections resolve from `--token` / `INSTATIC_TOKEN` (with `--url` / `INSTATIC_URL`), then the saved profile. A profile's credentials are only ever sent to that profile's site. Profiles are stored in `~/.config/instatic/config.json` (or `$XDG_CONFIG_HOME/instatic/`, or `$INSTATIC_CONFIG`). On macOS and Linux the file is readable only by you. On Windows it relies on your user folder's permissions.

Requires Node 20+ or Bun.
