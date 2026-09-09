import { Annotation } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { documentChanges } from './documentDiff'
import { syncProjectionFormatting } from './syncProjectionFormatting'

export type ValueSyncMode = boolean | 'html-projection'

/** Projection refreshes must not re-enter the author's live-change handler. */
export const valueSync = Annotation.define<boolean>()

export function syncEditorValue(view: EditorView, value: string, mode: ValueSyncMode): void {
  const current = view.state.doc.toString()
  if (!mode || current === value) return
  const next = mode === 'html-projection' ? syncProjectionFormatting(current, value) : value
  if (current !== next) {
    view.dispatch({ changes: documentChanges(current, next), annotations: [valueSync.of(true)] })
  }
}
