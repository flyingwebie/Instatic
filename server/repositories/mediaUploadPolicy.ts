/**
 * Media upload policy — which file types this installation accepts.
 *
 * A single row in `media_upload_policy` holding the allow-list as canonical
 * MIMEs from the `@core/media-types` catalogue. Scope is deliberately the
 * installation, not the branch: `media_assets` is not branch-scoped, so a
 * per-branch answer to "can I upload a PDF" would be incoherent.
 *
 * Absence of the row is meaningful and is NOT the same as an empty list:
 *
 *   - no row  → never configured → `DEFAULT_ALLOWED_MEDIA_MIMES`. This is
 *     what an existing installation hits on the upgrade that creates the
 *     table, which is how documents become available without anyone
 *     opening Settings.
 *   - a row holding `[]` → an admin deliberately turned everything off.
 *     Uploads are refused, and the rejection message says so.
 *
 * Deliberately NOT cached in-process. A read is one indexed single-row
 * lookup against a request that is about to write megabytes to disk, so the
 * saving would be unmeasurable — and a cache would mean a policy change took
 * effect on the worker that handled the save and nowhere else until restart,
 * which is exactly the kind of "it works on my tab" bug this setting must not
 * have.
 */
import type { DbClient } from '../db/client'
import {
  DEFAULT_ALLOWED_MEDIA_MIMES,
  normalizeAllowedMediaMimes,
  type MediaMime,
} from '@core/media-types'
import { nowIso } from '@core/utils/isoDate'

export interface MediaUploadPolicy {
  /** Canonical MIMEs, in catalogue order. */
  allowedMimes: MediaMime[]
  /** True while the installation is still on the catalogue defaults. */
  isDefault: boolean
}

interface PolicyRow {
  allowed_mimes_json: unknown
}

/**
 * The stored column is `jsonb` on Postgres and a `*_json` text column on
 * SQLite (auto-parsed by the adapter), so both dialects hand back an already
 * decoded value — but it is still untrusted shape-wise. Anything that is not
 * an array of strings is treated as a corrupt row and falls back to defaults
 * rather than silently disabling uploads.
 */
function readStoredMimes(raw: unknown): MediaMime[] | null {
  if (!Array.isArray(raw)) return null
  const strings = raw.filter((v): v is string => typeof v === 'string')
  return normalizeAllowedMediaMimes(strings)
}

function defaultPolicy(): MediaUploadPolicy {
  return { allowedMimes: [...DEFAULT_ALLOWED_MEDIA_MIMES], isDefault: true }
}

export async function getMediaUploadPolicy(db: DbClient): Promise<MediaUploadPolicy> {
  const { rows } = await db<PolicyRow>`
    select allowed_mimes_json from media_upload_policy where singleton = 1
  `
  const row = rows[0]
  if (!row) return defaultPolicy()

  // Postgres hands back the decoded jsonb; SQLite's adapter parses `*_json`
  // columns. Either way the value is only trustworthy once its shape is
  // checked — a row written by hand could be an object or a bare string.
  const stored = readStoredMimes(row.allowed_mimes_json)
  if (!stored) {
    console.warn('[mediaUploadPolicy] stored allow-list is malformed; falling back to defaults')
    return defaultPolicy()
  }

  return { allowedMimes: stored, isDefault: false }
}

/** Convenience read for the upload pipeline. */
export async function getAllowedUploadMimes(db: DbClient): Promise<MediaMime[]> {
  return (await getMediaUploadPolicy(db)).allowedMimes
}

/**
 * Persist a new allow-list. Unknown MIMEs are dropped and the result is
 * written in catalogue order, so the stored JSON is canonical regardless of
 * what order the client sent.
 */
export async function setAllowedUploadMimes(
  db: DbClient,
  mimes: readonly string[],
  userId: string | null,
): Promise<MediaUploadPolicy> {
  const allowedMimes = normalizeAllowedMediaMimes(mimes)
  await db`
    insert into media_upload_policy (singleton, allowed_mimes_json, updated_at, updated_by_user_id)
    values (1, ${allowedMimes}, ${nowIso()}, ${userId})
    on conflict (singleton) do update
      set allowed_mimes_json = excluded.allowed_mimes_json,
          updated_at = excluded.updated_at,
          updated_by_user_id = excluded.updated_by_user_id
  `
  return { allowedMimes, isDefault: false }
}
