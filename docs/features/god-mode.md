# God Mode

A per-user editor mode for the Site editor: the docked right properties sidebar is
hidden and a **Code Dock** — three code panels, **HTML | CSS | JS** — docks at the
bottom of the editor. The mode gives structure editors direct code control over the
page while the page tree stays the single source of truth. Spec history:
`.scratch/god-mode/` (local); vocabulary: `CONTEXT.md`.

Current status: the **shell** (toggle, dock layout, persistence), the
**editable HTML projection render** (`RenderConfig.projection`, see
[`publisher.md`](publisher.md) → "Editable HTML projection"), and the
**uid-preserving HTML import** (`importProjectionHtml`, see
[`html-import.md`](html-import.md) → "Uid-preserving projection import") are
implemented. The three panels are placeholders; the HTML/CSS/JS editors and
autocomplete land in follow-up changes.

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

## Planned panel semantics (follow-up tickets)

The panels are projections, not storage: the HTML panel renders/edits the page
tree via a uid-preserving import; the CSS panel projects the style-rule registry;
the JS panel edits a page-scoped script code asset. Selection in the layer panel
scopes all views; autocomplete covers tags, classes, published-site CSS variables,
and dynamic-data tokens. See `.scratch/god-mode/spec.md` for the full design.

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
