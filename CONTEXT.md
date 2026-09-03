# Instatic

A self-hosted CMS with a built-in visual editor and plugin system. This glossary covers terms specific to Instatic's domain; start with the God Mode feature vocabulary settled during design.

## Language

### God Mode

**God Mode**:
A per-user editor mode that replaces the right properties panel with code panels, giving direct HTML/CSS/JS control over the page.
_Avoid_: Code mode, developer mode, expert mode

**Code Dock**:
The bottom region of the site editor that hosts the HTML, CSS, and JS panels while God Mode is active.
_Avoid_: Bottom bar, code drawer

**Code Panel**:
One of the three editors (HTML, CSS, or JS) inside the Code Dock. HTML and CSS panels are projections of the page tree and style-rule registry — never a separate storage; the JS panel edits a script code asset.
_Avoid_: Code tab, code view

**Uid-preserving import**:
Parsing edited HTML back into the page tree by matching `uid` annotations to existing nodes, so node identity, metadata, and collab state survive an HTML edit. Nodes without a `uid` are new; nodes whose `uid` disappears are deleted.
_Avoid_: HTML round-trip (ambiguous — the lossy replace-subtree import also round-trips)

**Token-preserving render**:
Rendering page-tree HTML with dynamic data tokens (`{source.field}`) left as source text instead of interpolated values, so code panels show editable token syntax.

**Page script**:
The lazily-created, page-scoped script code asset that the JS panel edits — an ordinary code asset (visible in the Explorer Code tab) whose runtime scope is the current page.

### Existing concepts God Mode builds on

**Code asset**:
A site-level `SiteFile` of type `script` or `style`, with runtime config (scope, placement, timing) in `siteRuntime`.

**Loop source**:
A registered entity source (`data.rows`, `site.pages`, …) that a loop node iterates over, declaring its fields, filters, and ordering.

**Dynamic token**:
A single-brace inline binding `{source.field}` (sources: `currentEntry`, `parentEntry`, `page`, `site`, `route`) interpolated at render time.
_Avoid_: `{{ }}` mustache syntax (not Instatic's)
