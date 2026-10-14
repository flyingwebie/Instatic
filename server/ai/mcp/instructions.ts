/**
 * Server instructions advertised to MCP clients at `initialize`. External
 * agents never see the in-app system prompt, so the rules that keep a site
 * editable in the visual editor have to travel with the connection.
 */
export const MCP_SERVER_INSTRUCTIONS = [
  'Instatic is a visual editor: every style should stay editable per class in the Selectors and CSS panels.',
  'Style pages and components through site_insert_html / site_replace_node_html (class= attributes plus a <style> block in the same call) and site_apply_css. These become reusable style rules, one per class, attached to the elements that wear them.',
  'Do NOT put page or component styling in a stylesheet file with site_write_code_asset type:"style". Those files load site-wide but are opaque to the editor: the CSS panel and class pills show empty rules, and editing one element means editing a minified file. Reserve file stylesheets for third-party or vendor CSS you must keep verbatim.',
  'Before restyling, call site_read_document and reuse the existing classes instead of adding a second rule for the same element.',
].join('\n')
