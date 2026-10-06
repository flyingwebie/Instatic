import type { DbClient } from '../db/client'
import { isoDate } from '@core/utils/isoDate'

export interface PublishedRouteCandidate {
  rowId: string
  tableId: string
  tableSlug: string
  routeBase: string
  slug: string
  versionId: string
  snapshotId: string | null
  publishedAt: string
  firstPublishedAt: string
}

/** Only active main versions; draft cells and private field values never leave SQL. */
export async function listPublishedRouteCandidates(
  db: DbClient,
): Promise<PublishedRouteCandidate[]> {
  const { rows } = await db<{
    row_id: string
    table_id: string
    table_slug: string
    route_base: string
    slug: string
    version_id: string
    snapshot_id: string | null
    published_at: string | Date
    first_published_at: string | Date
  }>`
    select data_rows.id as row_id, data_rows.table_id,
           data_tables.slug as table_slug, data_tables.route_base,
           data_row_versions.slug, data_row_versions.id as version_id,
           data_row_versions.site_snapshot_id as snapshot_id,
           data_row_versions.published_at,
           (select min(versions.published_at) from data_row_versions versions where versions.row_id = data_rows.id) as first_published_at
    from data_rows
    join data_tables on data_tables.id = data_rows.table_id
    join data_row_versions on data_row_versions.id = data_rows.active_version_id
    where data_rows.branch_id = 'main'
      and data_rows.status = 'published'
      and data_rows.deleted_at is null
      and data_tables.deleted_at is null
    order by data_rows.id asc
  `
  return rows.map((row) => ({
    rowId: row.row_id,
    tableId: row.table_id,
    tableSlug: row.table_slug,
    routeBase: row.route_base || '/',
    slug: row.slug,
    versionId: row.version_id,
    snapshotId: row.snapshot_id,
    publishedAt: isoDate(row.published_at),
    firstPublishedAt: isoDate(row.first_published_at),
  }))
}
