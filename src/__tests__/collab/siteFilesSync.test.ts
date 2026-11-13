/**
 * Site files sync per file.
 *
 * `site.files` used to be one whole-value slot in the site doc, so saving one
 * stylesheet re-sent every script and stylesheet of the site in a single sync
 * frame. A site whose files totalled more than the frame ceiling could then
 * save no file at all: the server undid every write that grew the total.
 *
 * Under test: an edit to one file produces an update sized like that file,
 * not like the whole file layer; projection round-trips the array in order;
 * and a doc stored in the old layout upgrades in place.
 */
import { describe, expect, it } from 'bun:test'
import { create, type Patches } from 'mutative'
import * as Y from 'yjs'
import '@modules/base'
import type { SiteDocument } from '@core/page-tree'
import {
  applySitePatchesToDocs,
  createCollabDocSet,
  LOCAL_ORIGIN,
  projectSiteDoc,
  seedSiteDoc,
  shellMap,
  upgradeSiteDocLayout,
  type CollabDocSet,
} from '@core/collab'
import { makeSite } from '../fixtures'

const BIG = 'x'.repeat(600_000)

function file(id: string, content: string): SiteDocument['files'][number] {
  return { id, path: `src/scripts/${id}.js`, type: 'script', content, createdAt: 1, updatedAt: 1 }
}

function fixtureSite(): SiteDocument {
  return makeSite({ files: [file('big-a', BIG), file('big-b', BIG), file('small', 'let a = 1') ] })
}

function seeded(site: SiteDocument): CollabDocSet {
  const docs = createCollabDocSet()
  seedSiteDoc(docs.ensure('site:main'), site)
  return docs
}

/** Run a store-style mutation and return the bytes the site doc would send. */
function mutate(
  docs: CollabDocSet,
  site: SiteDocument,
  recipe: (draft: SiteDocument) => void,
): { next: SiteDocument; sentBytes: number } {
  const doc = docs.ensure('site:main')
  let sentBytes = 0
  const onUpdate = (update: Uint8Array): void => { sentBytes += update.byteLength }
  doc.on('update', onUpdate)
  const [next, patches] = create(site, recipe, { enablePatches: true }) as [SiteDocument, Patches, Patches]
  applySitePatchesToDocs(patches, site, next, docs, LOCAL_ORIGIN, 'main')
  doc.off('update', onUpdate)
  return { next, sentBytes }
}

describe('site files sync per file', () => {
  it('projects the seeded files back in order', () => {
    const site = fixtureSite()
    expect(projectSiteDoc(seeded(site).ensure('site:main')).shell.files).toEqual(site.files)
  })

  it('sends only the edited file, not the whole file layer', () => {
    const site = fixtureSite()
    const docs = seeded(site)
    const { next, sentBytes } = mutate(docs, site, (draft) => {
      draft.files[2].content = 'let a = 2'
      draft.files[2].updatedAt = 2
    })
    expect(sentBytes).toBeLessThan(2_000)
    expect(projectSiteDoc(docs.ensure('site:main')).shell.files).toEqual(next.files)
  })

  it('adds, removes and reorders files', () => {
    const site = fixtureSite()
    const docs = seeded(site)
    const added = mutate(docs, site, (draft) => { draft.files.push(file('new', 'let b = 1')) })
    expect(added.sentBytes).toBeLessThan(2_000)
    const removed = mutate(docs, added.next, (draft) => { draft.files.splice(0, 1) })
    expect(removed.sentBytes).toBeLessThan(2_000)
    const reordered = mutate(docs, removed.next, (draft) => { draft.files.reverse() })
    expect(reordered.next.files.map((f) => f.id)).toEqual(['new', 'small', 'big-b'])
    expect(projectSiteDoc(docs.ensure('site:main')).shell.files).toEqual(reordered.next.files)
  })

  it('merges two editors changing different files', () => {
    const site = fixtureSite()
    const a = seeded(site)
    const b = createCollabDocSet()
    Y.applyUpdate(b.ensure('site:main'), Y.encodeStateAsUpdate(a.ensure('site:main')))
    mutate(a, site, (draft) => { draft.files[2].content = 'from a' })
    mutate(b, site, (draft) => { draft.files[0].content = 'from b' })
    Y.applyUpdate(a.ensure('site:main'), Y.encodeStateAsUpdate(b.ensure('site:main')))
    const files = projectSiteDoc(a.ensure('site:main')).shell.files as SiteDocument['files']
    expect(files.map((f) => f.content)).toEqual(['from b', BIG, 'from a'])
  })

  it('upgrades a doc stored with files as one plain array', () => {
    const site = fixtureSite()
    const doc = new Y.Doc()
    shellMap(doc).set('files', site.files)
    expect(upgradeSiteDocLayout(doc)).toBe(true)
    expect(shellMap(doc).get('files')).toBeInstanceOf(Y.Map)
    expect(projectSiteDoc(doc).shell.files).toEqual(site.files)
    expect(upgradeSiteDocLayout(doc)).toBe(false)
  })
})
