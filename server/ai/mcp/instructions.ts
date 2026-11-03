/**
 * Server instructions advertised to MCP clients at `initialize`. External
 * agents never see the in-app system prompt, so the rules that keep a site
 * editable in the visual editor — and lean on the published page — have to
 * travel with the connection.
 */
export const MCP_SERVER_INSTRUCTIONS = [
  'Instatic is a visual editor: every style and script should stay editable in the editor panels (Selectors, CSS, JS), and published pages should load only the code they use.',
  'Start with get_context: it reports whether the Site editor is open. Editing tools (site_*) run in that open editor tab; if none connects within 15 seconds the call fails, so ask the user to open the Site editor. Short reconnects are absorbed automatically: do not treat one failed call as a lost connection.',
  'If a call reports the editor disconnected while it was running, the edit may or may not have applied: re-read the document (site_read_document) before retrying instead of repeating the write blindly.',
  'CSS: style pages and components through site_insert_html / site_replace_node_html (class= attributes plus a <style> block in the same call) and site_apply_css. These become reusable style rules, one per class, shown in the CSS panel; the publisher only ships rules for classes the site actually uses.',
  'Do NOT put page or component styling in a stylesheet file with site_write_code_asset type:"style". Those files are opaque to the editor: the CSS panel and class pills show empty rules. Reserve file stylesheets for third-party or vendor CSS you must keep verbatim.',
  'JS: behavior for one page (sliders, tabs, accordions, forms, animations) goes in site_write_page_script — the page script the JS panel edits, loaded only on that page. Shared behavior uses site_write_code_asset type:"script" with the narrowest runtime.scope (pages or templates); { type:"all-pages" } only for code every page needs. Never put <script> or on* handlers in HTML: they are stripped.',
  'Scripts run at DOM-ready as modules: select the elements they drive by class or data attribute and return early when none are present.',
  'Before restyling, call site_read_document and reuse the existing classes instead of adding a second rule for the same element. Edits stay drafts until site_publish.',
].join('\n')
