import type { DbClient } from '../db/client'
import type {
  PublicationListOptions,
  PublicationListResult,
  PublicationRenderOptions,
  PublishedDocument,
  PublishedRoute,
} from '@core/plugin-sdk'
import { contentHash } from '../branches/contentHash'
import { listPublishedRouteCandidates } from '../repositories/publication'
import { resolvePublicRoute } from './publicRouter'
import {
  renderPublishedSnapshot,
  renderPublishedDataRowTemplate,
} from './publicRenderer'
import { getPublishVersion, registerVersionedCacheReset } from './publishState'

function routePath(base: string, slug: string): string {
  const combined = `${base.replace(/\/+$/g, '')}/${slug}`
  return (
    '/' + combined.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  )
}

let inventories = new WeakMap<
  DbClient,
  { version: number; promise: Promise<PublicationListResult> }
>()
registerVersionedCacheReset(() => {
  inventories = new WeakMap()
})

function inventory(db: DbClient): Promise<PublicationListResult> {
  const version = getPublishVersion()
  const cached = inventories.get(db)
  if (cached?.version === version) return cached.promise
  const promise = loadInventory(db).catch((error: unknown) => {
    if (inventories.get(db)?.promise === promise) inventories.delete(db)
    throw error
  })
  inventories.set(db, { version, promise })
  return promise
}

async function loadInventory(db: DbClient): Promise<PublicationListResult> {
  const version = getPublishVersion()
  const candidates = await listPublishedRouteCandidates(db)
  const revision = contentHash(candidates)
  const templateRevision = contentHash(
    candidates
      .filter((item) => item.tableId === 'pages')
      .map((item) => [item.rowId, item.snapshotId]),
  )
  const paths = new Set<string>()
  const routes: PublishedRoute[] = []
  // Pages win over entry routes, matching the visitor resolver.
  for (const candidate of candidates.toSorted(
    (a, b) => Number(b.tableId === 'pages') - Number(a.tableId === 'pages'),
  )) {
    if (candidate.tableId === 'layouts' || candidate.tableId === 'components')
      continue
    const path =
      candidate.tableId === 'pages'
        ? candidate.slug === 'index'
          ? '/'
          : routePath('', candidate.slug)
        : routePath(candidate.routeBase, candidate.slug)
    if (
      paths.has(path) ||
      /^\/(?:admin|uploads|_instatic|health|\.well-known)(?:\/|$)/.test(
        decodeURIComponent(path),
      )
    )
      continue
    const resolution = await resolvePublicRoute(
      db,
      new URL(path, 'https://publication.invalid'),
    )
    if (resolution.kind !== 'page' && resolution.kind !== 'row') continue
    const id =
      resolution.kind === 'page'
        ? resolution.snapshot.pageRowId
        : resolution.row.rowId
    if (id !== candidate.rowId) continue
    paths.add(path)
    const title =
      resolution.kind === 'page'
        ? (resolution.snapshot.site.pages.find((page) => page.id === id)
            ?.title ?? '')
        : typeof resolution.row.cells.title === 'string'
          ? resolution.row.cells.title
          : ''
    routes.push({
      path,
      id,
      kind: resolution.kind === 'page' ? 'page' : 'entry',
      tableSlug: candidate.tableSlug,
      title,
      publishedAt: candidate.publishedAt,
      firstPublishedAt: candidate.firstPublishedAt,
      revision: contentHash([
        candidate,
        candidate.tableId === 'pages' ? null : templateRevision,
      ]),
    })
  }
  if (getPublishVersion() !== version)
    throw new Error(
      'Publication changed during inventory; retry against the current revision.',
    )
  return {
    version,
    revision,
    totalCount: routes.length,
    routes: routes.toSorted((a, b) => a.path.localeCompare(b.path)),
  }
}

export async function listPluginPublishedRoutes(
  db: DbClient,
  options: PublicationListOptions = {},
): Promise<PublicationListResult> {
  const result = await inventory(db)
  if (options.revision !== undefined && options.revision !== result.revision)
    throw new Error('Publication revision changed; restart generation.')
  const offset = options.offset ?? 0
  return {
    ...result,
    routes: result.routes.slice(offset, offset + (options.limit ?? 100)),
  }
}

export function publicationOrigin(value: string): URL {
  const origin = new URL(value)
  if (
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      'Publication origin must be an HTTP(S) origin without credentials, path, query, or fragment.',
    )
  }
  return origin
}

/** Raw visitor render, without plugin filters, cookies, preview branches, or request data. */
export async function renderPluginPublishedDocument(
  db: DbClient,
  options: PublicationRenderOptions,
): Promise<PublishedDocument | null> {
  const origin = publicationOrigin(options.origin)
  if (!options.path.startsWith('/') || options.path.startsWith('//'))
    throw new Error('Publication path must be site-relative.')
  const url = new URL(options.path, origin)
  if (url.origin !== origin.origin || url.search || url.hash)
    throw new Error(
      'Publication path must identify a canonical route without query or fragment.',
    )
  const result = await inventory(db)
  if (options.revision !== undefined && options.revision !== result.revision)
    throw new Error('Publication revision changed; restart generation.')
  const route = result.routes.find(
    (candidate) => candidate.path === url.pathname,
  )
  if (!route) return null
  const resolution = await resolvePublicRoute(db, url)
  if (resolution.kind !== 'page' && resolution.kind !== 'row') return null
  const rendered =
    resolution.kind === 'page'
      ? await renderPublishedSnapshot(resolution.snapshot, { db, url })
      : await renderPublishedDataRowTemplate(
          resolution.snapshot,
          resolution.row,
          { db, url },
        )
  if (!rendered) return null
  if (getPublishVersion() !== result.version)
    throw new Error('Publication changed during render; restart generation.')
  return {
    route,
    html: rendered.html,
    siteId: rendered.siteId,
    siteName: resolution.snapshot.site.name,
    language: resolution.snapshot.site.settings.language ?? 'en',
    revision: result.revision,
    version: result.version,
  }
}
