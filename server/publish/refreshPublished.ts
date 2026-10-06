import type { DbClient } from '../db/client'
import type { PublicationRefreshOptions } from '@core/plugin-sdk'
import {
  listPluginPublishedRoutes,
  publicationOrigin,
} from './pluginPublication'
import { resolvePublicRoute } from './publicRouter'
import {
  renderPublishedSnapshot,
  renderPublishedDataRowTemplate,
} from './publicRenderer'
import { applyPublishedHtmlPipeline } from './publishedHtmlPipeline'
import { getPublishVersion, withPublishLock } from './publishState'
import { invalidateRenderCache } from './renderCache'
import {
  getActiveSlot,
  getSlotDir,
  updateArtefactInPlace,
  writeStaticAsset,
} from './staticArtefact'

/** Rebuild derived HTML from existing public versions. Never reads or publishes drafts. */
export function refreshPublishedHtml(
  db: DbClient,
  uploadsDir: string | undefined,
  options: PublicationRefreshOptions,
): Promise<{ count: number; version: number }> {
  return withPublishLock(async () => {
    const origin = publicationOrigin(options.origin)
    const first = await listPluginPublishedRoutes(db, {
      limit: 200,
      revision: options.revision,
    })
    const published = new Set(first.routes.map((route) => route.path))
    for (let offset = 200; offset < first.totalCount; offset += 200) {
      for (const route of (
        await listPluginPublishedRoutes(db, {
          offset,
          limit: 200,
          revision: first.revision,
        })
      ).routes)
        published.add(route.path)
    }
    if (options.paths.some((path) => !published.has(path)))
      throw new Error('Only currently published routes can be refreshed.')
    const version = getPublishVersion()
    let count = 0
    try {
      for (const path of options.paths) {
        const url = new URL(path, origin)
        const resolution = await resolvePublicRoute(db, url)
        if (resolution.kind !== 'page' && resolution.kind !== 'row') continue
        const rendered =
          resolution.kind === 'page'
            ? await renderPublishedSnapshot(resolution.snapshot, {
                db,
                url,
                publishVersion: version,
              })
            : await renderPublishedDataRowTemplate(
                resolution.snapshot,
                resolution.row,
                { db, url, publishVersion: version },
              )
        if (!rendered) continue
        const html = await applyPublishedHtmlPipeline(rendered, db)
        if (uploadsDir) {
          const dir = getSlotDir(uploadsDir, await getActiveSlot(uploadsDir))
          for (const file of [
            rendered.cssBundle.reset,
            rendered.cssBundle.framework,
            rendered.cssBundle.style,
            rendered.cssBundle.userStyles,
          ])
            await writeStaticAsset(
              dir,
              '/_instatic/css/' + file.filename,
              new TextEncoder().encode(file.content),
            )
          await updateArtefactInPlace(uploadsDir, path, html)
        }
        count++
      }
    } finally {
      // Filter-only refreshes must not advance the content version: existing
      // baked pages and holes still describe the same published snapshots.
      invalidateRenderCache()
    }
    return { count, version: getPublishVersion() }
  })
}

export async function refreshAllPublishedHtml(
  db: DbClient,
  origin: string,
  uploadsDir?: string,
): Promise<number> {
  const first = await listPluginPublishedRoutes(db, { limit: 200 })
  const paths = first.routes.map((route) => route.path)
  for (let offset = 200; offset < first.totalCount; offset += 200) {
    const page = await listPluginPublishedRoutes(db, {
      offset,
      limit: 200,
      revision: first.revision,
    })
    paths.push(...page.routes.map((route) => route.path))
  }
  return (
    await refreshPublishedHtml(db, uploadsDir, {
      paths,
      origin,
      revision: first.revision,
    })
  ).count
}
