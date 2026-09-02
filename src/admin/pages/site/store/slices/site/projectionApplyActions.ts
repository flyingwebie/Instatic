/**
 * Site slice — `applyProjectionImport`, the God Mode HTML panel's write path.
 *
 * Splices a uid-preserving import result (`importProjectionHtml`) into the
 * active tree: every node of the projected subtree is replaced by the
 * result's nodes — matched nodes keep their ids and metadata, new tags get
 * fresh nodes, vanished uids disappear — in ONE undoable mutation. Class
 * names typed in the HTML link to registry classes exactly as the lossy
 * import does (`insertImportedNodes`), and nodes the apply deleted are
 * pruned from the canvas selection.
 */
import { collectSubtreeIds, reindexNodeParents } from '@core/page-tree'
import { pruneCanvasSelectionDraft } from '../selectionSlice'
import {
  createStyleRuleOrderAllocator,
  indexStyleRulesByName,
  linkImportedClassNames,
} from './importLinking'
import type { SiteSlice, SiteSliceHelpers } from './types'

type ProjectionApplyActions = Pick<SiteSlice, 'applyProjectionImport'>

export function createProjectionApplyActions({
  set,
  mutateActiveTreeAndSite,
}: SiteSliceHelpers): ProjectionApplyActions {
  return {
    applyProjectionImport: (result) => {
      const applied = mutateActiveTreeAndSite((tree, site) => {
        if (!tree.nodes[result.rootId] || !result.nodes[result.rootId]) return false

        const classesByName = indexStyleRulesByName(site.styleRules)
        const allocateStyleRuleOrder = createStyleRuleOrderAllocator(site.styleRules)

        // Replace the projected subtree wholesale: the result already holds
        // the patched survivors under their old ids, so anything left over
        // from the old subtree is a deletion.
        for (const id of collectSubtreeIds(tree.nodes, result.rootId)) delete tree.nodes[id]
        for (const [id, node] of Object.entries(result.nodes)) {
          tree.nodes[id] = {
            ...node,
            classIds: linkImportedClassNames(
              node.classIds,
              site.styleRules,
              classesByName,
              allocateStyleRuleOrder,
            ),
          }
        }
        reindexNodeParents(tree.nodes)
        return true
      })
      if (applied) {
        set((state) => {
          pruneCanvasSelectionDraft(state)
        })
      }
      return applied
    },
  }
}
