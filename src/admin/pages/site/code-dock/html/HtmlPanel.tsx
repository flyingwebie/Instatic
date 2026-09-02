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
 * with unapplied edits keeps them, and switching back restores them.
 * External changes to a clean scope re-sync the buffer (`useDocumentSync`);
 * a dirty scope keeps its draft AND its buffer untouched.
 */
import { lazy, Suspense, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { importProjectionHtml } from '@core/htmlImport'
import { getErrorMessage } from '@core/utils/errorMessage'
import { useEditorStore } from '@site/store/store'
import { formatShortcut, getKeybindingForCommand } from '@admin/spotlight/keybindings'
import type { EditorChangeInfo } from '@site/code-editor/CodeMirrorEditor'
import { Button } from '@ui/components/Button'
import { pushToast } from '@ui/components/Toast'
import { cn } from '@ui/cn'
import { useDocumentSync, type DocumentSyncSource } from '../useDocumentSync'
import { deriveHtmlPanelDocument } from './htmlPanelDocument'
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
}

type ApplyReport =
  | { kind: 'idle' }
  | { kind: 'applied'; docKey: string; created: number; patched: number; deleted: number }

function describeApply(report: Extract<ApplyReport, { kind: 'applied' }>): string {
  const parts = [
    report.patched > 0 ? `${report.patched} patched` : null,
    report.created > 0 ? `${report.created} created` : null,
    report.deleted > 0 ? `${report.deleted} deleted` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? `Applied · ${parts.join(' · ')}` : 'Applied · no changes'
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
  // A dirty scope keeps its buffer (caret, history) through unrelated store
  // changes; the stale-draft banner on top of that is ticket 07.
  const { revision, runOwnWrite } = useDocumentSync(syncSource, { holdRemounts: scopeDirty })
  // Bumped when an apply's fresh projection differs from what was typed, so
  // the buffer shows the normalised result.
  const [applyRevision, setApplyRevision] = useState(0)
  const [report, setReport] = useState<ApplyReport>({ kind: 'idle' })

  if (!document) {
    return <p className={styles.empty}>Open a page to edit its HTML.</p>
  }

  const { docKey, html, rootId, tree, readOnly, definitionVcId } = document
  const draft = scopeDraft
  const dirty = scopeDirty
  const syntaxErrorCount = draft?.syntaxErrorCount ?? 0
  const canApply = dirty && syntaxErrorCount === 0 && !readOnly

  const onChange = (text: string, info: EditorChangeInfo) => {
    setDrafts((current) => {
      if (text === html) {
        if (!(docKey in current)) return current
        const { [docKey]: _clean, ...rest } = current
        return rest
      }
      const { [docKey]: _previous, ...others } = current
      const keys = Object.keys(others)
      // Bounded: the oldest abandoned drafts go first (insertion order).
      const kept = keys.length >= MAX_DRAFTS ? keys.slice(keys.length - MAX_DRAFTS + 1) : keys
      const next: Record<string, Draft> = {}
      for (const key of kept) next[key] = others[key]
      next[docKey] = { text, syntaxErrorCount: info.syntaxErrorCount }
      return next
    })
  }

  const apply = () => {
    if (!canApply || !draft) return
    const site = inputs.site
    if (!site) return
    try {
      const result = importProjectionHtml(draft.text, { tree, rootId, styleRules: site.styleRules })
      const applied = runOwnWrite(() => applyProjectionImport(result))
      if (!applied) {
        pushToast({ kind: 'error', title: 'Could not apply HTML', body: 'The edited element is no longer in the document.' })
        return
      }
      setDrafts((current) => {
        const { [docKey]: _applied, ...rest } = current
        return rest
      })
      setReport({
        kind: 'applied',
        docKey,
        created: result.diff.createdIds.length,
        patched: result.diff.patchedIds.length,
        deleted: result.diff.deletedIds.length,
      })
      const fresh = deriveHtmlPanelDocument(selectSelectionScope(useEditorStore.getState()))
      if (fresh && fresh.html !== draft.text) setApplyRevision((r) => r + 1)
    } catch (err) {
      console.error('[HtmlPanel] apply failed:', err)
      pushToast({ kind: 'error', title: 'Could not apply HTML', body: getErrorMessage(err, 'Unknown import error') })
    }
  }

  const note = readOnly
    ? 'Component instance — read-only here'
    : syntaxErrorCount > 0
      ? `${syntaxErrorCount} syntax error${syntaxErrorCount === 1 ? '' : 's'} — fix before applying`
      : dirty
        ? 'Unapplied changes'
        : report.kind === 'applied' && report.docKey === docKey
          ? describeApply(report)
          : `Apply with ${APPLY_SHORTCUT}`

  return (
    <div className={styles.panel} data-testid="html-panel" data-dirty={dirty ? 'true' : 'false'}>
      <div className={styles.toolbar}>
        <span
          className={cn(styles.toolbarNote, dirty && !readOnly && styles.dirty, syntaxErrorCount > 0 && styles.statusError)}
          role="status"
          data-testid="html-panel-status"
          data-status={readOnly ? 'read-only' : syntaxErrorCount > 0 ? 'syntax' : dirty ? 'dirty' : 'clean'}
        >
          {note}
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
      <div className={styles.editor}>
        <Suspense fallback={<div className={styles.loading}>Loading editor</div>}>
          <CodeMirrorEditor
            docKey={`${docKey}#${revision}#${applyRevision}`}
            value={draft?.text ?? html}
            language="html"
            changeDelayMs={0}
            lintSyntax
            readOnly={readOnly}
            onChange={onChange}
            onSubmit={apply}
          />
        </Suspense>
      </div>
    </div>
  )
}
