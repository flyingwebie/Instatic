# God Mode

A per-user editor mode for the Site editor: the docked right properties sidebar is
hidden and a **Code Dock** — three code panels, **HTML | CSS | JS** — docks at the
bottom of the editor. The mode gives structure editors direct code control over the
page while the page tree stays the single source of truth. Spec history:
`.scratch/god-mode/` (local); vocabulary: `CONTEXT.md`.

Current status: the **shell** (toggle, dock layout, persistence), the
**editable HTML projection render** (`RenderConfig.projection`, see
[`publisher.md`](publisher.md) → "Editable HTML projection"), the
**uid-preserving HTML import** (`importProjectionHtml`, see
[`html-import.md`](html-import.md) → "Uid-preserving projection import"), and
all three panels — **HTML**, **CSS**, **JS** (below) — are implemented,
including the HTML panel's apply guardrails (destructive-diff confirm,
stale-draft banner). Reverse selection sync and the panels' autocomplete land
in follow-up changes.

## Enabling and entering

Two gates, both required:

1. **Capability** — the user must pass `canEditStructure` (`src/admin/access.ts`):
   God Mode's HTML panel will bypass per-module guardrails, so only structure
   editors may use it. Users without the capability never see the preference, the
   toolbar button, or the shortcut.
2. **Preference** — `godMode` in the editor-preference catalog
   (`src/admin/pages/site/preferences/catalog.ts`), off by default, rendered into
   Settings → Preferences. Per-browser, like every catalog preference. The
   catalog's `gate: 'structure-edit'` field is what hides it from ineligible
   users (`PreferencesSection` filters on it).

With both gates passed, the mode is **unlocked** (`useGodModeUnlocked`,
`src/admin/pages/site/hooks/useGodModeUnlocked.ts`) and can be toggled:

- Toolbar: `GodModeToggleButton` (`src/admin/pages/site/toolbar/`), a pressed-state
  ghost button in the site editor's right toolbar slot.
- Keyboard: **⌘⇧G** / Ctrl+Shift+G — spotlight command `godMode.toggle`
  (`src/admin/spotlight/commands/godMode.ts`) + keybinding, also runnable from ⌘K.

The active flag (`godModeActive`) is plain layout state in the editor store's
`codeDockSlice` (`src/admin/pages/site/store/slices/codeDockSlice.ts`) —
persisted per workspace, restored on reload. If a persisted flag
outlives the entitlement (preference turned off, capability revoked), an effect in
`AdminCanvasEditorBody` clears it so the properties sidebar returns.

## What the mode changes

- **Right sidebar hidden** — `selectRightSidebarExpanded`
  (`src/admin/pages/site/store/store.ts`) returns false while `godModeActive`.
  Only the *docked* sidebar is suppressed: the Properties panel can still be
  opened as a **floating window** (the Code Dock header's "Properties" button
  switches `propertiesPanelMode` to floating), because module-specific controls
  (image pickers, form settings, loop source pickers) have no code
  representation.
- **Code Dock shown** — `CodeDock` (`src/admin/pages/site/code-dock/`), mounted
  lazily by `AdminCanvasEditorBody` below the editor row, spanning the full
  shell width.

## Code Dock layout

- **Columns** — HTML | CSS | JS side by side. Header buttons toggle each column's
  visibility; dividers between columns drag to redistribute width (stored as flex
  weights); the top edge drags to resize the dock height (clamped
  `CODE_DOCK_MIN_HEIGHT`–`CODE_DOCK_MAX_HEIGHT`). Both resize gestures write CSS
  custom properties imperatively during the drag and commit to the store once on
  pointer-up, so the layout-persistence subscriber writes localStorage once per
  gesture. Keyboard: the handles are focusable `role="separator"` elements;
  arrow keys resize in discrete steps.
- **Tabbed fallback** — a ResizeObserver on the dock watches its width; when the
  visible columns can't all fit at their minimum width the dock switches to one
  editor with HTML/CSS/JS tabs (`codeDockActiveTab`), and back automatically.
- **Persistence** — `godModeActive`, `codeDockHeight`, `codeDockPanels`,
  `codeDockActiveTab`, and `codeDockColumnWeights` are projected into the
  per-workspace layout storage (`siteEditorLayoutPersistence.ts` →
  `workspaceLayoutStorage.ts`, localStorage key `instatic-editor-layout-v2`) and
  restored (validated, clamped) at store hydration.
- **Bundle** — the dock is behind a `React.lazy` boundary; nothing God-Mode-
  specific loads until the mode is activated. The future CodeMirror panels stay
  behind the same boundary.

## HTML panel

The HTML column (`src/admin/pages/site/code-dock/html/`) is the editable
projection of the current selection, applied back to the tree on demand.

- **Read side** — `deriveHtmlPanelDocument` (`htmlPanelDocument.ts`) renders
  the scoped subtree with the publisher's projection mode
  (`RenderConfig.projection`, see [`publisher.md`](publisher.md) → "Editable
  HTML projection"): every element carries `uid`, dynamic tokens stay
  verbatim, and loops / Component refs / slots render as `instatic-*`
  markers. Scope: an element selected in the active tree → that subtree;
  nothing selected → the whole active document (the page, or the Component
  **definition** in VC canvas mode, both fully editable, slot outlets
  visible); a node selected **inside a Component instance** on the consumer
  side (the canvas renders definition internals, so their ids are
  selectable while a page is active) → that subtree from the definition,
  **read-only**, with an "Open component definition" button that switches
  the active document to the Component.
- **Write side** — Apply is explicit: the Apply button or **⌘↩** (the
  editor's `onSubmit`) runs `importProjectionHtml` against the projected
  tree and `applyProjectionImport` (site slice,
  `site/projectionApplyActions.ts`), which replaces the projected subtree
  with the result's nodes in ONE `mutateActiveTreeAndSite` recipe: matched
  uids keep their ids and metadata, new tags become nodes, vanished uids are
  deleted and pruned from the canvas selection, class names link to registry
  classes exactly as the lossy import does. One apply = one tree-undo step;
  canvas and layer panel repaint from the store. Apply is **gated**: nothing
  touches the tree while the document has syntax errors (`lintSyntax`
  diagnostics inline, error count in the toolbar), and never in the
  read-only view.
- **Drafts** — unapplied edits are kept per scope (keyed by the projected
  document, bounded to the 20 most recent), so changing selection never
  discards them and switching back restores them; the toolbar shows "Unapplied changes" and the apply result
  ("Applied · 2 patched · 1 created"). An apply whose fresh projection differs
  from the typed text re-keys the buffer to the normalised output.
- **Sync** — a clean scope re-syncs its buffer on external tree changes
  (canvas undo, a co-editor) through the shared `useDocumentSync`, with no
  banner; a dirty scope keeps its draft verbatim and its buffer mounted
  (`holdRemounts`), so caret and text history survive every store change —
  including the remote ones the stale banner reports.
- **Guardrails** — two, and every other apply is silent. Each draft records
  the projection it started from (`baseHtml`), so both are *derived* from
  state rather than tracked by subscriptions:
  - **Stale draft.** A dirty scope whose current projection differs from
    the draft's baseline — a co-editor, an MCP agent, or a canvas undo
    changed the projected subtree — shows a "Content changed remotely"
    banner (`html-panel-stale`), keeps the draft and buffer untouched, and
    turns Apply into overwrite-with-confirm. The only exits are explicit:
    confirm the overwrite (the draft is re-imported against the tree as it
    is at confirm time and wins), or **Discard draft**, which drops the draft
    and re-keys the buffer to the remote projection. Undoing a tree change
    under a dirty panel takes the same path: drafts are never silently
    discarded or silently applied over remote work.
  - **Destructive diff.** Before committing, `summarizeDestructiveApply`
    (`html/applyGuardrails.ts`) turns the import diff's `deletedLockedIds`,
    `deletedStructuralIds`, and `retypedStructuralIds` into a list of
    top-level removals — locked nodes, Component instances, slots, slot
    outlets — named as the layer panel names them, with removed descendants
    folded into their ancestor (deleting one Component instance reads as one
    line, not one per slot). A non-empty list opens the confirm; cancel
    leaves the tree and the draft untouched.
  - Both concerns share one dialog, `HtmlApplyConfirmDialog` (built on the
    `Dialog` primitive, `tone="danger"`): the stale paragraph, the removal
    list, or both, with a single confirm button. Confirming **re-validates**:
    the draft is re-imported against the tree as it is then, and if what the
    apply would do no longer matches the summary the user read (the tree
    moved while the dialog was open) the dialog shows the new summary instead
    of committing. A re-validation that finds nothing left to confirm
    commits directly.
  - **Orphaned draft.** When the element a draft is scoped to is removed
    (remotely, or by a canvas undo), the selection is pruned and the panel
    moves on to the new scope — but the draft can never be applied. Rather
    than vanish, it is named in a banner (`html-panel-orphaned`) with
    **Copy draft** (clipboard) and **Dismiss**; each draft records its
    `rootId` and scope name for this.

## CSS panel

The CSS column (`src/admin/pages/site/code-dock/css/`) is a two-way editor
over the style-rule registry — a projection, never a second store. The engine
is `@core/cssProjection` (`src/core/cssProjection/`), pure and DOM-free:

- **`projectStylesheet`** renders an ordered list of blocks into one annotated
  stylesheet text. Rules go through `createStyleRuleCssEmitter` — the same
  emitter the publisher and canvas use — so `@media`/`@container`/`@supports`
  folding, `!important` and property sanitisation cannot drift from a publish.
  Every block is prefixed by an origin comment (`/* .card · class · used by 3
  elements */`, `/* h1 · ambient rule · matches 2 elements on this page */`,
  `/* .text-m · framework utility · read-only · used by 12 elements */`,
  `/* element · inline styles · this element only */`) and its character
  range is reported so the editor can lock and fold framework blocks. A rule
  with no declarations still emits `.card {\n}` so it stays editable.
- **`planStylesheetEdit`** parses edited text with `cssToStyleRules`
  (breakpoint-aware `@media` folding, custom conditions preserved) and diffs
  it against the projection it came from: parsed rules are exact-selector
  upserts with **replace** semantics; a projected **class** block that
  vanished is *cleared* (declarations go, the class and its `class=`
  assignments stay — the CSS panel edits CSS, never assignments); a vanished
  **ambient** block is *deleted*; the reserved `element { … }` block becomes
  the node's `inlineStyles` (base-only — any `@media` on it is dropped with a
  warning); a rule addressed at a locked framework block is reported as
  blocked and never applied.

**Scope** (`cssPanelDocument.ts` → `deriveCssPanelDocument`): with an element
selected, the sheet holds its assigned class rules (assignment order), the
ambient rules matching it — via the Properties panel's own selector model
(`deriveSelectorPickerModel` pills, editor-attribute-stripped canvas clone), so
pills and panel never disagree — its inline styles as the `element` block,
and the framework utilities it wears, last. With nothing selected it holds
every rule the page uses: classes assigned anywhere in the active tree plus
ambient rules matching any rendered element. Class usage counts assignments
site-wide (`buildSelectorUsageMap`, pages **and** Visual Component trees);
ambient usage counts matches on the current page. In Visual Component canvas
mode the active tree is the definition tree.

**Write path** — `applyStylesheetEdit` on the style-rule slice
(`styleRule/stylesheetEditActions.ts`) applies one plan atomically in a single
`mutateSiteState` recipe: upserts (`rulePayload.ts` → `upsertRulesIntoSite`,
shared with the agent/MCP `applyCssRules`), cleared class blocks, deleted
ambient blocks, and the projected node's inline styles (page or active VC
tree). One debounced flush (300 ms, `CSS_PANEL_APPLY_DELAY_MS`) is therefore
exactly one tree-undo step; consecutive flushes are separate steps. The
canvas repaints from the registry as you type. **Editing a shared class edits
it site-wide by design** — the "used by N elements" annotation is the safety
rail; there is no silent forking. A new selector typed in the panel creates a
real class or ambient rule; a new `.class` is **not** auto-assigned to the
selection (assignment stays explicit — the HTML panel's `class` attribute).

**Editor** — `CodeMirrorEditor` gained two opt-in props for this panel:
`lockedRanges` (`code-editor/lockedRegions.ts`: read-only ranges that follow
edits above them, folded on mount, `.cm-lockedLine` styling) and `lintSyntax`
(`code-editor/syntaxDiagnostics.ts`: lezer parse errors as inline lint
markers, with the error count passed to `onChange`). The panel holds applies
back while the document has syntax errors — the CSS parser silently swallows
everything after a missing brace, and a live "replace" apply would otherwise
read that as deletions. The theme moved to `code-editor/codeMirrorTheme.ts`;
the `codemirror-lazy-only` gate now allowlists the lazy chunk's helper modules
and pins that nothing outside the chunk imports them.

**Sync** — the editor is remounted only when the projected text changes for a
reason other than the panel's own apply (selection change, canvas Cmd+Z, a
co-editor's edit): the panel remembers the projection text its last apply
produced and re-keys the editor when the store projects something else. Undo
with focus in the panel is CodeMirror's text history; undo in the canvas or
layer panel is tree undo, which re-syncs the panel.

## JS panel

The JS column (`src/admin/pages/site/code-dock/js/`) edits the **page
script**: an ordinary script code asset scoped to exactly the current page.
Nothing else marks it — it is found by its runtime config
(`findPageScript` in `@core/site-runtime`: a `type: 'script'` file whose
scope is `{ type: 'pages', pageIds: [<this page>] }`; several qualify → the
one that loads first, ascending priority then path). It shows in the Explorer
Code tab like any script, its settings (scope, placement, timing, canvas) stay
editable there, and it rides the existing build/inject pipeline
(`collectRuntimeScripts`), so it runs in the canvas and on the published page
with no new publish path.

- **Lazy creation** — no asset exists until the first real edit. The first
  non-empty flush calls `createPageScript(pageId, content)` (file slice): one
  `mutateSiteState` recipe adds `scripts/pages/<slug>.js` (`pageScriptPath`,
  stepping past an occupied path with `-2`, `-3`, …) AND its page-only
  runtime config to both the persisted `site.runtime` and the store mirror
  (`writeSiteRuntimeDraft`, the one place every runtime writer goes
  through), so file + scope are one undo step and the Code tab settings
  agree at once.
- **Saves** — live-debounced (250 ms, `JS_PANEL_SAVE_DELAY_MS`) through
  `updateFileContent`, the same path the Code editor panel uses; the compiler
  diagnostics for the file (`fileRuntimeDiagnostics`, shared with that panel)
  show inline, threaded down as `runtimeValidation` from the canvas layout.
  Language follows the file's path (`fileLanguage`, shared with the Code
  editor panel); `.ts` page scripts get the TypeScript language service.
- **Scope** — follows the active page, never the element selection; in
  Visual Component canvas mode the panel shows an empty state (a VC has no
  page script).
- **Sync** — page switches re-key the buffer; the editor's flush-on-switch
  lands a pending edit on the page it was typed for. External content
  changes (undo, the Code editor panel, a co-editor) re-sync the buffer via
  the same `useDocumentSync` hook the CSS panel uses (`code-dock/
  useDocumentSync.ts`).

## Planned follow-ups

HTML apply guardrails (destructive-diff confirm, stale-draft banner),
reverse selection sync from the HTML panel, and autocomplete (tags, classes,
published-site CSS variables, dynamic-data tokens). See
`.scratch/god-mode/spec.md` for the full design.

## Tests

- `src/__tests__/god-mode/godModeDockState.test.ts` — codeDockSlice state/actions,
  right-sidebar suppression, persistence projection/restore, catalog entry,
  spotlight command + keybinding.
- `src/__tests__/god-mode/codeDockTabFallback.test.tsx` — narrow-window tab
  fallback behavior (mocked ResizeObserver).
- `src/__tests__/publisher/projectionRender.test.ts` — the editable HTML
  projection dialect (tokens, uid/hidden, loop/component/slot/outlet markers,
  publish path unchanged).
- `src/__tests__/htmlImport/projectionImport.test.ts` — the uid-preserving
  import (round-trip identity, patch/create/delete/move semantics, partial
  loop-filters patching, destructive-deletion diff flags).
- `src/__tests__/settings/settingsSections.test.tsx` — capability-gated
  preference hidden for non-structure editors.
- `src/__tests__/cssProjection/projectStylesheet.test.ts` /
  `planStylesheetEdit.test.ts` — the CSS projection engine (annotations,
  `@media` round-trip, cleared vs deleted blocks, `element` block, locked
  framework selectors, new selectors).
- `src/__tests__/editor-store/stylesheetEdit.test.ts` — `applyStylesheetEdit`
  as one undo step, locked-rule refusal, no-op contract, VC-tree inline styles.
- `src/__tests__/god-mode/cssPanelDocument.test.ts` — selection vs page scope,
  usage counts, unrendered selection.
- `src/__tests__/god-mode/cssPanel.test.tsx` — the panel over real
  CodeMirror: live apply, canvas-undo re-sync, syntax gating, new selector
  without auto-assignment, selection swaps.
- `src/__tests__/code-editor/lockedRegions.test.tsx` — locked ranges reject
  edits, fold on mount, and syntax error counts ride along with changes.
- `src/__tests__/site-runtime/pageScript.test.ts` — page-script resolution
  (exact page scope, load-order tie-break, `scripts/pages/<slug>.js` naming).
- `src/__tests__/editor-store/pageScriptActions.test.ts` — `createPageScript`
  as one undo step; the script runs for its page only in canvas and publish.
- `src/__tests__/god-mode/jsPanel.test.tsx` — the panel over real
  CodeMirror: lazy creation on first edit, live saves, selection-independent,
  page switch with flushed pending edit, undo re-sync.
- `src/__tests__/editor-store/applyProjectionImport.test.ts` —
  `applyProjectionImport`: patch in place with identity/metadata kept,
  create/delete with selection pruning, page-root apply, one undo step.
- `src/__tests__/god-mode/htmlPanelDocument.test.ts` — scope derivation:
  selection, page, VC definition, read-only Component internals.
- `src/__tests__/god-mode/htmlPanel.test.tsx` — the panel over real
  CodeMirror: explicit apply as one undo step, syntax gating, per-scope
  drafts, read-only internals + jump to definition, token / `instatic-*`
  round trip.
- `src/__tests__/code-editor/editorSubmitReadOnly.test.tsx` — `onSubmit`
  (Mod-Enter after flush) and `readOnly`.
