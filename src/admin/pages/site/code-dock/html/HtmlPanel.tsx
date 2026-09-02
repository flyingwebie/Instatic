/**
 * HtmlPanel — the Code Dock's HTML column: the editable projection of the
 * current selection (or the whole document), applied back to the tree on
 * demand (docs/features/god-mode.md → "HTML panel").
 *
 * Read side: `deriveHtmlPanelDocument` renders the scoped subtree in the
 * projection dialect. Write side: Apply (button or Mod-Enter) runs the
 * uid-preserving `importProjectionHtml` and `applyProjectionImport` — one
 * apply, one tree-undo step. Apply is EXPLICIT and gated: nothing touches
 * the tree while the document has syntax errors, and never for a read-only
 * view of a Component instance's internals (those jump to the definition).
 *
 * Drafts are kept per scope (bounded, oldest first out): switching selection
 * with unapplied edits keeps them, and switching back restores them. Each
 * draft remembers the projection it started from, which is what makes the
 * guardrails derivable rather than tracked:
 *
 *   - STALE: the projection for a dirty scope no longer matches the draft's
 *     baseline — a co-editor, an agent, or a tree undo changed the subtree.
 *     The draft and its buffer stay verbatim (`holdRemounts`), a banner says
 *     so, and Apply becomes overwrite-with-confirm. The only ways out are
 *     explicit: apply over it, or discard the draft.
 *   - DESTRUCTIVE: the import's diff removes locked nodes or Component/slot
 *     structures — summarised by `summarizeDestructiveApply` and confirmed
 *     before anything mutates. Every other apply is silent. The confirm is
 *     re-validated when accepted: if the tree moved while the dialog was
 *     open, the dialog shows the new summary instead of committing.
 *   - ORPHANED: the element a draft was scoped to was removed (remotely, or
 *     by a canvas undo), so the draft can never be applied. The panel moves
 *     on to the new scope but names the lost draft in a banner, with its
 *     text one click from the clipboard — never a silent loss.
 */
import { lazy, Suspense, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { importProjectionHtml, type ProjectionImportResult } from '@core/htmlImport'
import { registry } from '@core/module-engine'
import { getNodeDisplayName } from '@core/page-tree'
import { getErrorMessage } from '@core/utils/errorMessage'
import { useEditorStore } from '@site/store/store'
import type { EditorStore } from '@site/store/types'
import { formatShortcut, getKeybindingForCommand } from '@admin/spotlight/keybindings'
import type { EditorChangeInfo } from '@site/code-editor/CodeMirrorEditor'
import { Button } from '@ui/components/Button'
import { pushToast } from '@ui/components/Toast'
import { cn } from '@ui/cn'
import { useDocumentSync, type DocumentSyncSource } from '../useDocumentSync'
import { deriveHtmlCompletionCatalog, useDataMeta } from '../completions'
import { deriveHtmlPanelDocument, type HtmlPanelDocument } from './htmlPanelDocument'
import { summarizeDestructiveApply, type DestructiveRemoval } from './applyGuardrails'
import { HtmlApplyConfirmDialog } from './HtmlApplyConfirmDialog'
import { selectSelectionScope, selectionScopeEqual, type SelectionScopeInputs } from '../selectionScope'
import styles from '../EditorColumn.module.css'

const CodeMirrorEditor = lazy(() => import('@site/code-editor/CodeMirrorEditor'))

const APPLY_SHORTCUT = formatShortcut(getKeybindingForCommand('godMode.applyHtml')!.shortcut)

/** Unapplied drafts kept across scope changes; the oldest go first past this. */
const MAX_DRAFTS = 20

const syncSource: DocumentSyncSource<SelectionScopeInputs> = {
  select: selectSelectionScope,
  equal: selectionScopeEqual,
  read: (inputs) => {
    const next = deriveHtmlPanelDocument(inputs)
    return next ? { docKey: next.docKey, text: next.html } : null
  },
}

interface Draft {
  text: string
  syntaxErrorCount: number
  /** The projection the draft was started from — differs once stale. */
  baseHtml: string
  /** The node the draft is scoped to — gone once orphaned. */
  rootId: string
  /** The scope's layer-panel name when the draft started, for the orphan banner. */
  name: string
}

interface AppliedReport {
  docKey: string
  /** The projection the apply produced — the report is shown while it lasts. */
  html: string
  created: number
  patched: number
  deleted: number
}

type PanelStatus =
  | { kind: 'read-only' }
  | { kind: 'syntax'; count: number }
  | { kind: 'stale' }
  | { kind: 'dirty' }
  | { kind: 'clean'; applied: AppliedReport | null }

function statusText(status: PanelStatus): string {
  switch (status.kind) {
    case 'read-only':
      return 'Component instance — read-only here'
    case 'syntax':
      return `${status.count} syntax error${status.count === 1 ? '' : 's'} — fix before applying`
    case 'stale':
      return 'Draft is out of date — Apply overwrites'
    case 'dirty':
      return 'Unapplied changes'
    case 'clean':
      return status.applied ? describeApply(status.applied) : `Apply with ${APPLY_SHORTCUT}`
  }
}

function describeApply(report: AppliedReport): string {
  const parts = [
    report.patched > 0 ? `${report.patched} patched` : null,
    report.created > 0 ? `${report.created} created` : null,
    report.deleted > 0 ? `${report.deleted} deleted` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? `Applied · ${parts.join(' · ')}` : 'Applied · no changes'
}

/** What an apply held for confirmation would do — compared on re-validation. */
interface PendingApply {
  stale: boolean
  removals: DestructiveRemoval[]
}

function pendingEqual(a: PendingApply, b: PendingApply): boolean {
  return (
    a.stale === b.stale
    && a.removals.length === b.removals.length
    && a.removals.every((removal, i) => removal.id === b.removals[i].id && removal.retyped === b.removals[i].retyped)
  )
}

function scopeName(document: HtmlPanelDocument, site: NonNullable<EditorStore['site']>): string {
  const node = document.tree.nodes[document.rootId]
  return node ? getNodeDisplayName(node, registry.get(node.moduleId), site.visualComponents) : document.rootId
}

function nodeExistsInSite(site: NonNullable<EditorStore['site']>, nodeId: string): boolean {
  return site.pages.some((page) => nodeId in page.nodes) || site.visualComponents.some((vc) => nodeId in vc.tree.nodes)
}

export function HtmlPanel() {
  const inputs = useEditorStore(useShallow(selectSelectionScope))
  const applyProjectionImport = useEditorStore((s) => s.applyProjectionImport)
  const setActiveDocument = useEditorStore((s) => s.setActiveDocument)
  const document = deriveHtmlPanelDocument(inputs)
  // Unapplied edits, per scope: switching selection never discards them.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const scopeDraft = document ? drafts[document.docKey] : undefined
  const scopeDirty = scopeDraft !== undefined && scopeDraft.text !== document?.html
  // A dirty scope keeps its buffer (caret, history) through every store
  // change, including the remote ones the stale banner reports.
  const { revision, runOwnWrite } = useDocumentSync(syncSource, { holdRemounts: scopeDirty })
  // Bumped when the buffer must show something other than what was typed:
  // an apply whose fresh projection differs from the draft, or a discard.
  const [bufferRevision, setBufferRevision] = useState(0)
  const [applied, setApplied] = useState<AppliedReport | null>(null)
  const [pending, setPending] = useState<PendingApply | null>(null)
  const dataMeta = useDataMeta()

  if (!document || !inputs.site) {
    return <p className={styles.empty}>Open a page to edit its HTML.</p>
  }

  const site = inputs.site
  const { docKey, html, rootId, tree, readOnly, definitionVcId } = document
  const activePage =
    inputs.activeDocument?.kind === 'visualComponent'
      ? null
      : site.pages.find((page) => page.id === inputs.activePageId) ?? null
  const completions = deriveHtmlCompletionCatalog({ site, tree, rootId, activePage, dataMeta })
  const draft = scopeDraft
  const dirty = scopeDirty
  const stale = draft !== undefined && dirty && draft.baseHtml !== html
  const syntaxErrorCount = draft?.syntaxErrorCount ?? 0
  const canApply = dirty && syntaxErrorCount === 0 && !readOnly
  const orphaned = Object.entries(drafts).find(([, d]) => !nodeExistsInSite(site, d.rootId)) ?? null

  const status: PanelStatus = readOnly
    ? { kind: 'read-only' }
    : syntaxErrorCount > 0
      ? { kind: 'syntax', count: syntaxErrorCount }
      : stale
        ? { kind: 'stale' }
        : dirty
          ? { kind: 'dirty' }
          : { kind: 'clean', applied: applied?.docKey === docKey && applied.html === html ? applied : null }

  const onChange = (text: string, info: EditorChangeInfo) => {
    setDrafts((current) => {
      const previous = current[docKey]
      if (text === html) {
        if (!previous) return current
        const { [docKey]: _clean, ...rest } = current
        return rest
      }
      const { [docKey]: _previous, ...others } = current
      const keys = Object.keys(others)
      // Bounded: the oldest abandoned drafts go first (insertion order).
      const kept = keys.length >= MAX_DRAFTS ? keys.slice(keys.length - MAX_DRAFTS + 1) : keys
      const next: Record<string, Draft> = {}
      for (const key of kept) next[key] = others[key]
      next[docKey] = previous
        ? { ...previous, text, syntaxErrorCount: info.syntaxErrorCount }
        : { text, syntaxErrorCount: info.syntaxErrorCount, baseHtml: html, rootId, name: scopeName(document, site) }
      return next
    })
  }

  const dropDraft = (key: string) => {
    setDrafts((current) => {
      const { [key]: _dropped, ...rest } = current
      return rest
    })
  }

  const buildImport = (): ProjectionImportResult | null => {
    if (!canApply || !draft) return null
    return importProjectionHtml(draft.text, { tree, rootId, styleRules: site.styleRules })
  }

  const summarize = (result: ProjectionImportResult): PendingApply => ({
    stale,
    removals: summarizeDestructiveApply(result.diff, tree, site.visualComponents),
  })

  const commit = (result: ProjectionImportResult) => {
    if (!draft) return
    const ok = runOwnWrite(() => applyProjectionImport(result))
    if (!ok) {
      pushToast({ kind: 'error', title: 'Could not apply HTML', body: 'The edited element is no longer in the document.' })
      return
    }
    dropDraft(docKey)
    const fresh = deriveHtmlPanelDocument(selectSelectionScope(useEditorStore.getState()))
    setApplied({
      docKey,
      html: fresh?.html ?? draft.text,
      created: result.diff.createdIds.length,
      patched: result.diff.patchedIds.length,
      deleted: result.diff.deletedIds.length,
    })
    if (fresh && fresh.html !== draft.text) setBufferRevision((r) => r + 1)
  }

  const reportFailure = (err: unknown) => {
    console.error('[HtmlPanel] apply failed:', err)
    pushToast({ kind: 'error', title: 'Could not apply HTML', body: getErrorMessage(err, 'Unknown import error') })
  }

  const apply = () => {
    try {
      const result = buildImport()
      if (!result) return
      const summary = summarize(result)
      if (summary.stale || summary.removals.length > 0) {
        setPending(summary)
        return
      }
      commit(result)
    } catch (err) {
      reportFailure(err)
    }
  }

  // Confirmed: re-import against the tree as it is NOW. If what the apply
  // would do no longer matches what the dialog showed (the tree moved while
  // it was open), show the new summary instead of committing — a confirm
  // only ever covers the summary the user actually read.
  const confirmPending = () => {
    if (!pending) return
    try {
      const result = buildImport()
      if (!result) {
        setPending(null)
        return
      }
      const summary = summarize(result)
      const harmless = !summary.stale && summary.removals.length === 0
      if (harmless || pendingEqual(pending, summary)) {
        setPending(null)
        commit(result)
      } else {
        setPending(summary)
      }
    } catch (err) {
      setPending(null)
      reportFailure(err)
    }
  }

  const discardDraft = () => {
    dropDraft(docKey)
    setBufferRevision((r) => r + 1)
  }

  const copyOrphanedDraft = async () => {
    if (!orphaned) return
    try {
      await navigator.clipboard.writeText(orphaned[1].text)
      pushToast({ kind: 'success', title: 'Draft copied', body: `The unapplied HTML for “${orphaned[1].name}” is on the clipboard.` })
    } catch (err) {
      console.error('[HtmlPanel] copy draft failed:', err)
      pushToast({ kind: 'error', title: 'Could not copy the draft', body: getErrorMessage(err, 'Clipboard unavailable') })
    }
  }

  return (
    <div className={styles.panel} data-testid="html-panel" data-dirty={dirty ? 'true' : 'false'}>
      <div className={styles.toolbar}>
        <span
          className={cn(styles.toolbarNote, dirty && !readOnly && styles.dirty, status.kind === 'syntax' && styles.statusError)}
          role="status"
          data-testid="html-panel-status"
          data-status={status.kind}
        >
          {statusText(status)}
        </span>
        {readOnly && definitionVcId ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setActiveDocument({ kind: 'visualComponent', vcId: definitionVcId })}
            data-testid="html-panel-open-definition"
          >
            Open component definition
          </Button>
        ) : (
          <Button
            variant="primary"
            size="xs"
            disabled={!canApply}
            onClick={apply}
            tooltip={`Apply the edited HTML to the page tree (${APPLY_SHORTCUT})`}
            data-testid="html-panel-apply"
          >
            Apply
          </Button>
        )}
      </div>
      {stale ? (
        <div className={styles.banner} role="alert" data-testid="html-panel-stale">
          <span className={styles.bannerText}>
            Content changed remotely. Your draft is kept; Apply overwrites the remote version.
          </span>
          <Button variant="ghost" size="xs" onClick={discardDraft} data-testid="html-panel-discard">
            Discard draft
          </Button>
        </div>
      ) : null}
      {orphaned ? (
        <div className={styles.banner} role="alert" data-testid="html-panel-orphaned">
          <span className={styles.bannerText}>
            Unapplied edits to “{orphaned[1].name}” cannot be applied: the element was removed.
          </span>
          <span className={styles.bannerActions}>
            <Button variant="ghost" size="xs" onClick={copyOrphanedDraft} data-testid="html-panel-orphan-copy">
              Copy draft
            </Button>
            <Button variant="ghost" size="xs" onClick={() => dropDraft(orphaned[0])} data-testid="html-panel-orphan-dismiss">
              Dismiss
            </Button>
          </span>
        </div>
      ) : null}
      <div className={styles.editor}>
        <Suspense fallback={<div className={styles.loading}>Loading editor</div>}>
          <CodeMirrorEditor
            docKey={`${docKey}#${revision}#${bufferRevision}`}
            value={draft?.text ?? html}
            language="html"
            changeDelayMs={0}
            lintSyntax
            foldUidAttributes
            readOnly={readOnly}
            completions={completions}
            onChange={onChange}
            onSubmit={apply}
          />
        </Suspense>
      </div>
      {pending ? (
        <HtmlApplyConfirmDialog
          stale={pending.stale}
          removals={pending.removals}
          onCancel={() => setPending(null)}
          onConfirm={confirmPending}
        />
      ) : null}
    </div>
  )
}
