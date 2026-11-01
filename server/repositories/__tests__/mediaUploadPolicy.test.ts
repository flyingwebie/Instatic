/**
 * Upload-policy repository tests.
 *
 * The behaviour worth pinning is the three-way distinction the rest of the
 * pipeline leans on: "never configured" (defaults apply — this is what an
 * existing installation hits on the upgrade that adds the table), "configured
 * to nothing" (uploads refused), and "configured to something" (exactly that,
 * in catalogue order).
 */
import { describe, expect, it, beforeEach } from 'bun:test'
import { createSqliteClient } from '../../db/sqlite'
import { sqliteMigrations } from '../../db/migrations-sqlite'
import { runMigrations } from '../../db/runMigrations'
import type { DbClient } from '../../db/client'
import {
  getAllowedUploadMimes,
  getMediaUploadPolicy,
  setAllowedUploadMimes,
} from '../mediaUploadPolicy'
import { DEFAULT_ALLOWED_MEDIA_MIMES } from '@core/media-types'

async function freshDb(): Promise<DbClient> {
  const db = createSqliteClient(':memory:')
  await runMigrations(db, sqliteMigrations)
  return db
}

let db: DbClient

beforeEach(async () => {
  db = await freshDb()
})

describe('media upload policy', () => {
  it('falls back to the catalogue defaults when no row exists', async () => {
    const policy = await getMediaUploadPolicy(db)
    expect(policy.isDefault).toBe(true)
    expect(policy.allowedMimes).toEqual([...DEFAULT_ALLOWED_MEDIA_MIMES])
  })

  it('accepts documents out of the box, so an upgrade needs no admin action', async () => {
    const allowed = await getAllowedUploadMimes(db)
    expect(allowed).toContain('application/pdf')
    expect(allowed).toContain('text/plain')
    expect(allowed).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })

  it('round-trips a saved selection', async () => {
    await setAllowedUploadMimes(db, ['image/png', 'application/pdf'], null)

    const policy = await getMediaUploadPolicy(db)
    expect(policy.isDefault).toBe(false)
    expect(policy.allowedMimes).toEqual(['image/png', 'application/pdf'])
  })

  it('normalises to catalogue order and drops unknown MIMEs', async () => {
    await setAllowedUploadMimes(db, ['application/pdf', 'text/html', 'image/png'], null)

    // Catalogue order puts images before documents, and `text/html` is not a
    // type the pipeline can verify, so it never reaches storage.
    expect((await getMediaUploadPolicy(db)).allowedMimes).toEqual(['image/png', 'application/pdf'])
  })

  it('treats an explicitly empty selection as a real answer, not as unset', async () => {
    await setAllowedUploadMimes(db, [], null)

    const policy = await getMediaUploadPolicy(db)
    expect(policy.isDefault).toBe(false)
    expect(policy.allowedMimes).toEqual([])
  })

  it('falls back to defaults when the stored value is malformed', async () => {
    await db`
      insert into media_upload_policy (singleton, allowed_mimes_json, updated_at)
      values (1, ${'not-an-array'}, ${'2026-01-01T00:00:00.000Z'})
    `

    const policy = await getMediaUploadPolicy(db)
    expect(policy.isDefault).toBe(true)
    expect(policy.allowedMimes).toEqual([...DEFAULT_ALLOWED_MEDIA_MIMES])
  })

  it('overwrites rather than duplicating the singleton row', async () => {
    await setAllowedUploadMimes(db, ['image/png'], null)
    await setAllowedUploadMimes(db, ['image/gif'], null)
    const { rows } = await db<{ n: number }>`select count(*) as n from media_upload_policy`
    expect(Number(rows[0].n)).toBe(1)
    expect((await getMediaUploadPolicy(db)).allowedMimes).toEqual(['image/gif'])
  })
})
