/**
 * Shared upload pipeline used by every endpoint that writes a media asset
 * (the media library + the avatar endpoint). Centralises:
 *
 *   - Multipart `file=` form parse
 *   - Magic-byte MIME sniffing (NEVER trust `file.type` — attacker-controlled)
 *   - Filename sanitisation (drops user-supplied extensions to prevent
 *     `.html` payloads from being served as text/html by the static handler)
 *   - Two-phase dispatch through the elected `MediaStorageAdapter`
 *     (see `./mediaUploadDispatch.ts`)
 *
 * The byte transport itself lives in `./mediaUploadExecutor.ts` — bytes
 * NEVER cross the QuickJS sandbox boundary, regardless of which adapter
 * is elected. Adapters only sign plans; the host streams.
 *
 * Callers control the policy knobs (`maxBytes`, allowed MIMEs, uploader id,
 * asset role) and consume the persisted `MediaAsset` row. Keeping the
 * byte-level checks in one place is a security-critical invariant — any
 * handler that uploads media MUST go through `acceptUploadedMedia`.
 *
 * WHICH types exist is not decided here: the catalogue lives in
 * `@core/media-types` and the per-installation allow-list in
 * `media_upload_policy`. This module decides only whether the BYTES are what
 * the caller's allow-list says they must be. The two halves of accepting a
 * file type are therefore a catalogue entry plus a signature below; one
 * without the other is unreachable.
 *
 * Deciding WHAT a file is belongs to `./mediaSniff.ts`; this module decides
 * what to do with that answer. On accepting formats with an active surface
 * (PDF, Office, SVG, archives):
 * none of them is ever served inline. `hardenUploadResponse` sends everything
 * outside the passive image/video/audio set as `Content-Disposition:
 * attachment` under `Content-Security-Policy: default-src 'none'` and
 * `nosniff`, so the browser downloads the file instead of rendering it on the
 * admin origin. That — not the sniffing — is what makes them safe to store.
 */
import { basename } from 'node:path'
import { nanoid } from 'nanoid'
import type { DbClient } from '../../db/client'
import {
  createMediaAsset,
  getMediaAsset,
  getMediaAssetStoragePath,
  getMediaAssetVariants,
  replaceMediaAssetBinary,
  setMediaAssetVariants,
} from '../../repositories/media'
import { badRequest, jsonResponse } from '../../http'
import { processImageVariants, removeVariantFiles } from './mediaVariants'
import type { MediaAssetRole } from '@core/plugin-sdk'
import {
  buildSuggestedStoragePath,
  dispatchDelete,
  dispatchUpload,
  MediaStorageDispatchError,
} from './mediaUploadDispatch'
import { sanitizeSvgBytes } from './svgSanitize'
import {
  extensionForMime,
  mediaMimesInGroup,
  type MediaMime,
} from '@core/media-types'
import { detectAcceptedMime } from './mediaSniff'

/**
 * Hard ceiling on any single media upload, shared by every surface that
 * accepts bytes (the HTTP media route, the MCP upload tool). Callers pass it
 * as the `maxBytes` policy knob so the limit lives in exactly one place.
 */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024

/** The image subset — avatars and the MCP upload tool accept only these. */
export const IMAGE_MIMES: ReadonlyArray<MediaMime> = mediaMimesInGroup('image')

const RESPONSIVE_VARIANT_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])

function shouldProcessResponsiveVariants(mime: MediaMime): boolean {
  return RESPONSIVE_VARIANT_MIMES.has(mime)
}

/**
 * The extension the server appends to an upload's on-disk name. Always the
 * catalogue's value for the DETECTED MIME, never anything the client sent —
 * the static handler maps extension back to Content-Type, so this call is
 * what guarantees a `.html` payload can never be served as `text/html`.
 *
 * The MIME reaching here has already been produced by `detectAcceptedMime`,
 * so a missing catalogue entry would mean the two tables had drifted apart;
 * that is a programming error, not a request the user can make.
 */
function uploadExtension(mime: MediaMime): string {
  const extension = extensionForMime(mime)
  if (!extension) throw new Error(`[mediaUpload] no extension registered for detected MIME "${mime}"`)
  return extension
}

/**
 * Strip the user-supplied extension off a filename and sanitise the stem,
 * leaving only `[a-zA-Z0-9_-]`. The caller is responsible for re-attaching
 * a server-trusted extension. Returns `'upload'` for empty / all-illegal
 * stems so the storage filename is never blank.
 *
 * NOTE: dot is no longer in the allow-list. Earlier versions kept dot to
 * preserve the original extension, which let an attacker plant `.html` and
 * have the static handler serve it as `text/html`. The fix is structural:
 * never trust user-supplied extensions for an on-disk filename.
 */
function safeStorageStem(filename: string): string {
  const normalized = filename.replace(/\\/g, '/')
  const stem = basename(normalized).replace(/\.[^.]*$/, '')
  const safe = stem.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '')
  return safe || 'upload'
}

export interface UploadForm {
  /** The `file` part, or null when the multipart body has none. */
  file: File | null
  /** Optional `altText` text part — a site import sends the authored `<img alt>`. */
  altText: string | undefined
}

/**
 * Read the multipart upload body once (a `FormData` stream can only be
 * consumed once) and hand back the parts the media routes accept.
 */
export async function readUploadForm(req: Request): Promise<UploadForm> {
  const body = await req.formData()
  const file = body.get('file')
  const altText = body.get('altText')
  return {
    file: file instanceof File ? file : null,
    altText: typeof altText === 'string' ? altText : undefined,
  }
}

interface AcceptUploadInput {
  /** Pre-extracted `File` from the multipart body. */
  file: File
  /** Hard ceiling on body size — caller picks the policy per surface. */
  maxBytes: number
  /** Subset of the media type catalogue the caller is willing to accept. */
  allowedMimes: ReadonlyArray<MediaMime>
  /**
   * Asset role — picked per call site so the dispatcher resolves the right
   * elected adapter ('original' for the media library, 'avatar' for the
   * avatar endpoint, 'font' for fonts).
   */
  role: MediaAssetRole
  /** User who triggered the upload; persisted on the media row. */
  uploadedByUserId: string | null
  /** Alt text the new record starts with (site import). Absent = empty. */
  altText?: string
  /** Error message for the size-limit response (keeps the prose per-surface). */
  oversizedMessage: string
  /** Error message when the sniffed MIME isn't in `allowedMimes`. */
  unsupportedMessage: string
}

interface ValidatedUpload {
  bytes: Uint8Array
  detectedMime: MediaMime
}

/**
 * Apply the size + magic-byte security layer to a multipart upload. Returns
 * either the validated bytes + sniffed MIME, or a ready-to-return `Response`
 * with the appropriate error envelope. Shared by both the create-asset and
 * replace-file flows so the byte-level checks live in exactly one place.
 */
async function validateUploadedMedia(input: AcceptUploadInput): Promise<Response | ValidatedUpload> {
  if (input.file.size <= 0) return badRequest('File is empty')
  if (input.file.size > input.maxBytes) return badRequest(input.oversizedMessage)

  // Detect MIME from the actual bytes (NEVER from `file.type`, which is
  // attacker-controlled in any non-browser HTTP client). Reject anything
  // that doesn't match a known signature OR isn't in the caller's allow-list.
  let bytes = new Uint8Array(await input.file.arrayBuffer())
  const detectedMime = detectAcceptedMime(bytes, input.file.name)
  if (!detectedMime || !input.allowedMimes.includes(detectedMime)) {
    return badRequest(input.unsupportedMessage)
  }

  // SVG passes the (lenient) text-based detector but still needs the script
  // surface removed before persistence — see svgSanitize.ts for the threat
  // model. Sanitize-then-store: the bytes that hit disk match the bytes the
  // browser will receive, with no out-of-band cleaning step needed.
  if (detectedMime === 'image/svg+xml') {
    const sanitized = sanitizeSvgBytes(bytes)
    if (sanitized.length === 0) {
      return badRequest('SVG file is empty after sanitisation (likely contains only disallowed elements).')
    }
    // Copy into a fresh ArrayBuffer-backed view so the type matches the
    // `Uint8Array<ArrayBuffer>` the rest of the pipeline expects (the
    // TextEncoder output is typed against the looser ArrayBufferLike).
    bytes = new Uint8Array(sanitized)
  }

  return { bytes, detectedMime }
}

/**
 * Validate + persist an uploaded image/video and return the created media row.
 *
 * On any policy failure the function returns a `Response` so the caller can
 * `return response` straight from its route handler. On success it returns
 * the `MediaAsset` row from the repository.
 *
 * The actual byte transport is handled by `dispatchUpload`: the elected
 * adapter for `input.role` signs an upload plan, the host streams bytes
 * to it directly, the adapter commits. Bytes NEVER cross the QuickJS
 * boundary.
 */
export async function acceptUploadedMedia(
  db: DbClient,
  input: AcceptUploadInput,
): Promise<Response | Awaited<ReturnType<typeof createMediaAsset>>> {
  const validated = await validateUploadedMedia(input)
  if (validated instanceof Response) return validated

  // Server-chosen extension on the on-disk filename so the static handler's
  // extension→Content-Type lookup can only ever yield the verified inert
  // MIME we just sniffed. Client-supplied extension is dropped.
  const storageName = `${safeStorageStem(input.file.name)}${uploadExtension(validated.detectedMime)}`
  const suggestedStoragePath = buildSuggestedStoragePath(safeStorageStem(input.file.name), uploadExtension(validated.detectedMime))

  let dispatched
  try {
    dispatched = await dispatchUpload(db, {
      bytes: validated.bytes,
      mimeType: validated.detectedMime,
      suggestedStoragePath,
      role: input.role,
    })
  } catch (err) {
    if (err instanceof MediaStorageDispatchError) {
      return jsonResponse({ error: err.message }, { status: err.status })
    }
    throw err
  }

  const asset = await createMediaAsset(db, {
    id: nanoid(),
    filename: input.file.name || storageName,
    mimeType: validated.detectedMime,
    sizeBytes: input.file.size,
    storagePath: dispatched.storagePath,
    publicPath: dispatched.publicUrl,
    uploadedByUserId: input.uploadedByUserId,
    storageAdapterId: dispatched.storageAdapterId,
    externallyHosted: dispatched.externallyHosted,
    ...(input.altText !== undefined ? { altText: input.altText } : {}),
  })

  // Responsive pipeline (docs/features/media.md). Raster-only for v1:
  // SVGs already scale without a bitmap ladder, and GIF conversion would
  // collapse animation to a still. Failure inside the pipeline is
  // non-fatal: the asset row is already written; the worst case is the row
  // has no variants and consumers fall back to the original. Logged at the
  // boundary in `mediaVariants.ts`.
  if (shouldProcessResponsiveVariants(validated.detectedMime)) {
    const processed = await processImageVariants(db, validated.bytes, dispatched.storagePath)
    if (processed) {
      const upgraded = await setMediaAssetVariants(db, asset.id, {
        width: processed.width,
        height: processed.height,
        blurHash: processed.blurHash,
        variants: processed.variants,
      })
      if (upgraded) return upgraded
    }
  }

  return asset
}

/**
 * Replace the binary backing an existing asset. Public URL stays stable —
 * the asset row keeps its `id` so every page tree / content entry / avatar
 * reference is automatically updated.
 *
 * Flow:
 *   1. Run the same security checks as a fresh upload (size + magic bytes).
 *   2. Look up the existing asset so we know which adapter wrote its
 *      bytes (so we delete via the right one) and its current variants.
 *   3. Dispatch the new binary write through whichever adapter is currently
 *      elected for the role — that may be different from the one that
 *      wrote the previous binary, and that's fine; the row records the
 *      new adapter id alongside the new bytes.
 *   4. Update the row (`replaceMediaAssetBinary`).
 *   5. Delete the previous bytes via the PREVIOUS adapter. Failures here
 *      are non-fatal — the replacement already succeeded; the worst case
 *      is orphaned bytes the user can sweep later.
 */
export async function acceptReplacementMedia(
  db: DbClient,
  assetId: string,
  input: AcceptUploadInput,
): Promise<Response | Awaited<ReturnType<typeof replaceMediaAssetBinary>>> {
  const validated = await validateUploadedMedia(input)
  if (validated instanceof Response) return validated

  const previous = await getMediaAsset(db, assetId)
  if (!previous) {
    return jsonResponse({ error: 'Media asset not found' }, { status: 404 })
  }
  const previousStoragePath = await getMediaAssetStoragePath(db, assetId)
  if (!previousStoragePath) {
    return jsonResponse({ error: 'Media asset not found' }, { status: 404 })
  }
  // Snapshot the previous responsive variants BEFORE the row update so we
  // can sweep them off the backend after the replace lands. The new
  // variant ladder is derived from the new binary's dimensions, so the
  // old files are guaranteed to be orphaned regardless of width overlap.
  const previousVariants = await getMediaAssetVariants(db, assetId)

  const storageName = `${safeStorageStem(input.file.name)}${uploadExtension(validated.detectedMime)}`
  const suggestedStoragePath = buildSuggestedStoragePath(safeStorageStem(input.file.name), uploadExtension(validated.detectedMime))

  let dispatched
  try {
    dispatched = await dispatchUpload(db, {
      bytes: validated.bytes,
      mimeType: validated.detectedMime,
      suggestedStoragePath,
      role: input.role,
    })
  } catch (err) {
    if (err instanceof MediaStorageDispatchError) {
      return jsonResponse({ error: err.message }, { status: err.status })
    }
    throw err
  }

  const updated = await replaceMediaAssetBinary(db, assetId, {
    filename: input.file.name || storageName,
    mimeType: validated.detectedMime,
    sizeBytes: input.file.size,
    storagePath: dispatched.storagePath,
    publicPath: dispatched.publicUrl,
    storageAdapterId: dispatched.storageAdapterId,
    externallyHosted: dispatched.externallyHosted,
  })
  if (!updated) {
    // The asset disappeared between the lookup and the update (race against
    // a parallel hard-delete). Clean up the bytes we just wrote so we
    // don't leak them, then 404.
    await dispatchDelete(dispatched.storageAdapterId, dispatched.storagePath).catch((err) => {
      console.error('[mediaUpload] post-race cleanup failed (orphaned bytes):', err)
    })
    return jsonResponse({ error: 'Media asset not found' }, { status: 404 })
  }

  // Stamp the fresh responsive output, then sweep the old binary + old
  // variants off the backend. The variants step runs AFTER the row-replace
  // so a crash mid-pipeline leaves the asset with the new original but no
  // variants — consumers fall back to the original gracefully.
  let finalAsset = updated
  if (shouldProcessResponsiveVariants(validated.detectedMime)) {
    const processed = await processImageVariants(db, validated.bytes, dispatched.storagePath)
    if (processed) {
      const upgraded = await setMediaAssetVariants(db, assetId, {
        width: processed.width,
        height: processed.height,
        blurHash: processed.blurHash,
        variants: processed.variants,
      })
      if (upgraded) finalAsset = upgraded
    } else {
      // Pipeline failed but the row already carries stale width/height/
      // blur from the previous binary — clear them so consumers know there's
      // no responsive ladder for the new binary either.
      const cleared = await setMediaAssetVariants(db, assetId, {
        width: null,
        height: null,
        blurHash: null,
        variants: [],
      })
      if (cleared) finalAsset = cleared
    }
  } else {
    // Non-image replace: drop any leftover image variants/dimensions.
    const cleared = await setMediaAssetVariants(db, assetId, {
      width: null,
      height: null,
      blurHash: null,
      variants: [],
    })
    if (cleared) finalAsset = cleared
  }

  // Sweep the previous bytes via THEIR adapter (not the currently elected
  // one — the asset may have lived on a different backend before this
  // replace). Variant cleanup honours each variant's own adapter id too.
  await dispatchDelete(previous.storageAdapterId, previousStoragePath).catch((err) => {
    console.error('[mediaUpload] previous-binary cleanup failed (orphaned bytes):', err)
  })
  await removeVariantFiles(previousVariants)
  return finalAsset
}
