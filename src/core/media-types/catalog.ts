/**
 * The media type catalogue — the single source of truth for every file type
 * the media library knows how to accept, and the only place a MIME is paired
 * with the extension the server will write to disk.
 *
 * Why one shared table instead of a server-side allow-list: three surfaces
 * need the same facts and used to derive them independently.
 *
 *   - the upload pipeline (`server/handlers/cms/mediaUpload.ts`) needs
 *     `mime → extension`, because the static handler maps extension →
 *     Content-Type and that mapping is what actually decides how a browser
 *     treats the bytes;
 *   - the admin Settings → Uploads section needs `label` / `group` /
 *     `defaultEnabled` to render the per-type switches;
 *   - the Media workspace needs the enabled extensions for the file picker's
 *     `accept` attribute, and the group for its viewer + filter buckets.
 *
 * A type being listed here does NOT mean it is accepted: the installation's
 * upload policy (`media_upload_policy`, see
 * `server/repositories/mediaUploadPolicy.ts`) selects a subset. The catalogue
 * is the universe; the policy is the current allow-list.
 *
 * Adding a type is a two-part change by design: an entry here AND a magic-byte
 * signature (or container rule) in `mediaUpload.ts`. The upload pipeline never
 * trusts a client-declared MIME, so a catalogue entry with no way to verify the
 * bytes is unreachable — `media-type-catalog.test.ts` gates exactly that.
 */

/**
 * Coarse family used for grouping in Settings, for the Media workspace's
 * filter tabs, and for picking a viewer. Narrower than the MIME top-level
 * type: `document` spans `application/*` and `text/*`.
 */
export type MediaTypeGroup = 'image' | 'video' | 'audio' | 'font' | 'document' | 'archive'

export interface MediaTypeDefinition {
  /**
   * Canonical MIME — also the stable id persisted in the upload policy, so
   * renaming one orphans an installation's stored selection. Don't.
   */
  mime: string
  /**
   * The extension the server writes on disk. Client-supplied extensions are
   * always dropped; this value is what the static handler reads back to
   * choose a Content-Type, so it is a security-relevant field.
   */
  extension: string
  /** Shown in Settings → Uploads. */
  label: string
  group: MediaTypeGroup
  /**
   * Whether a fresh installation (or one that has never saved a policy)
   * accepts this type. Images, video, fonts and documents are on; audio and
   * archives are opt-in, because they are bulky and rarely wanted by default
   * on a site-builder's media library.
   */
  defaultEnabled: boolean
  /**
   * Whether `/uploads/*` may serve these bytes inline. `false` forces
   * `Content-Disposition: attachment` in `hardenUploadResponse`, which is the
   * reason types with an active surface (SVG, PDF, Office macros, archives)
   * are safe to accept at all — the browser downloads them instead of
   * rendering them on the admin origin. Only formats a browser renders as
   * passive media are inline.
   */
  inline: boolean
}

/**
 * Every type the pipeline can verify, in the order Settings renders them.
 *
 * Signature notes for the document and container formats live beside their
 * detectors in `mediaUpload.ts`; in short: PDF and RTF have real magic bytes,
 * OOXML and OpenDocument are ZIP containers identified by their member names,
 * and legacy Office files share one OLE compound-file signature that cannot
 * distinguish Word from Excel from PowerPoint — those three resolve their
 * concrete MIME from the uploaded filename's extension, which is safe here
 * because all three write an inert, download-only extension either way.
 */
export const MEDIA_TYPE_CATALOG = [
  // ─── Images ────────────────────────────────────────────────────────────
  { mime: 'image/jpeg', extension: '.jpg', label: 'JPEG', group: 'image', defaultEnabled: true, inline: true },
  { mime: 'image/png', extension: '.png', label: 'PNG', group: 'image', defaultEnabled: true, inline: true },
  { mime: 'image/gif', extension: '.gif', label: 'GIF', group: 'image', defaultEnabled: true, inline: true },
  { mime: 'image/webp', extension: '.webp', label: 'WebP', group: 'image', defaultEnabled: true, inline: true },
  { mime: 'image/avif', extension: '.avif', label: 'AVIF', group: 'image', defaultEnabled: true, inline: true },
  // SVG is accepted but never inline: it is an active document format. The
  // bytes are run through DOMPurify before storage AND served as a download.
  { mime: 'image/svg+xml', extension: '.svg', label: 'SVG', group: 'image', defaultEnabled: true, inline: false },

  // ─── Video ─────────────────────────────────────────────────────────────
  { mime: 'video/mp4', extension: '.mp4', label: 'MP4', group: 'video', defaultEnabled: true, inline: true },
  { mime: 'video/webm', extension: '.webm', label: 'WebM', group: 'video', defaultEnabled: true, inline: true },

  // ─── Audio ─────────────────────────────────────────────────────────────
  { mime: 'audio/mpeg', extension: '.mp3', label: 'MP3', group: 'audio', defaultEnabled: false, inline: true },
  { mime: 'audio/wav', extension: '.wav', label: 'WAV', group: 'audio', defaultEnabled: false, inline: true },
  { mime: 'audio/ogg', extension: '.ogg', label: 'Ogg', group: 'audio', defaultEnabled: false, inline: true },

  // ─── Web fonts ─────────────────────────────────────────────────────────
  // Referenced from @font-face inside imported stylesheets. Pure binary
  // containers with no script surface and reliable magic bytes.
  { mime: 'font/woff2', extension: '.woff2', label: 'WOFF2', group: 'font', defaultEnabled: true, inline: false },
  { mime: 'font/woff', extension: '.woff', label: 'WOFF', group: 'font', defaultEnabled: true, inline: false },
  { mime: 'font/ttf', extension: '.ttf', label: 'TrueType', group: 'font', defaultEnabled: true, inline: false },
  { mime: 'font/otf', extension: '.otf', label: 'OpenType', group: 'font', defaultEnabled: true, inline: false },

  // ─── Documents ─────────────────────────────────────────────────────────
  { mime: 'application/pdf', extension: '.pdf', label: 'PDF', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'text/plain', extension: '.txt', label: 'Plain text', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'text/markdown', extension: '.md', label: 'Markdown', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'text/csv', extension: '.csv', label: 'CSV', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/rtf', extension: '.rtf', label: 'Rich Text (RTF)', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx', label: 'Word (.docx)', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/msword', extension: '.doc', label: 'Word 97–2003 (.doc)', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx', label: 'Excel (.xlsx)', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/vnd.ms-excel', extension: '.xls', label: 'Excel 97–2003 (.xls)', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx', label: 'PowerPoint (.pptx)', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/vnd.ms-powerpoint', extension: '.ppt', label: 'PowerPoint 97–2003 (.ppt)', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/vnd.oasis.opendocument.text', extension: '.odt', label: 'OpenDocument Text', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/vnd.oasis.opendocument.spreadsheet', extension: '.ods', label: 'OpenDocument Spreadsheet', group: 'document', defaultEnabled: true, inline: false },
  { mime: 'application/vnd.oasis.opendocument.presentation', extension: '.odp', label: 'OpenDocument Presentation', group: 'document', defaultEnabled: true, inline: false },

  // ─── Archives ──────────────────────────────────────────────────────────
  // A ZIP is a container: nothing inside it is inspected. It is safe only
  // because it is served as a download with `default-src 'none'`.
  { mime: 'application/zip', extension: '.zip', label: 'ZIP archive', group: 'archive', defaultEnabled: false, inline: false },
] as const satisfies readonly MediaTypeDefinition[]

/**
 * Union of every MIME the catalogue knows. Derived from the table rather
 * than written out again, so a new entry is immediately a legal value
 * everywhere the pipeline threads a detected MIME around.
 */
export type MediaMime = typeof MEDIA_TYPE_CATALOG[number]['mime']

/** Order the Settings section and the filter tabs render groups in. */
export const MEDIA_TYPE_GROUP_ORDER: readonly MediaTypeGroup[] = [
  'image',
  'video',
  'audio',
  'font',
  'document',
  'archive',
]

export const MEDIA_TYPE_GROUP_LABELS: Record<MediaTypeGroup, string> = {
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  font: 'Web fonts',
  document: 'Documents',
  archive: 'Archives',
}

// Keyed by plain `string`, not by the literal unions: every lookup here
// starts from an untrusted value (a sniffed MIME, a filename's extension, a
// persisted allow-list), so the whole point is to answer "is this one of
// ours" for an arbitrary string.
const BY_MIME: ReadonlyMap<string, MediaTypeDefinition> = new Map(
  MEDIA_TYPE_CATALOG.map((def) => [def.mime, def]),
)
const BY_EXTENSION: ReadonlyMap<string, MediaTypeDefinition> = new Map(
  MEDIA_TYPE_CATALOG.map((def) => [def.extension, def]),
)

/** Catalogue entry for a MIME, or `null` when the MIME is not one we accept. */
export function mediaTypeByMime(mime: string): MediaTypeDefinition | null {
  return BY_MIME.get(mime) ?? null
}

/**
 * Catalogue entry for a lower-cased extension including the leading dot
 * (`.docx`). Used to resolve the concrete MIME of a container format whose
 * signature identifies only the family (legacy Office, plain text).
 */
export function mediaTypeByExtension(extension: string): MediaTypeDefinition | null {
  return BY_EXTENSION.get(extension.toLowerCase()) ?? null
}

/** The server-chosen on-disk extension for a MIME, or `null` if unknown. */
export function extensionForMime(mime: string): string | null {
  return BY_MIME.get(mime)?.extension ?? null
}

/** Whether `/uploads/*` may serve this MIME without forcing a download. */
export function isInlineMediaMime(mime: string): boolean {
  return BY_MIME.get(mime)?.inline ?? false
}

/** Every MIME in the catalogue, in catalogue order. */
export const ALL_MEDIA_MIMES: readonly MediaMime[] = MEDIA_TYPE_CATALOG.map((d) => d.mime)

/** The allow-list an installation starts with before anyone opens Settings. */
export const DEFAULT_ALLOWED_MEDIA_MIMES: readonly MediaMime[] = MEDIA_TYPE_CATALOG
  .filter((d) => d.defaultEnabled)
  .map((d) => d.mime)

/** Every definition in a group, in catalogue order. */
export function mediaTypesInGroup(group: MediaTypeGroup): readonly MediaTypeDefinition[] {
  return MEDIA_TYPE_CATALOG.filter((d) => d.group === group)
}

/** Every MIME in a group, in catalogue order. */
export function mediaMimesInGroup(group: MediaTypeGroup): MediaMime[] {
  return MEDIA_TYPE_CATALOG.filter((d) => d.group === group).map((d) => d.mime)
}

/**
 * Coerce a persisted / wire-supplied allow-list into catalogue order, dropping
 * anything unknown and de-duplicating. Returning catalogue order (rather than
 * the caller's) keeps the stored JSON stable, so two saves that select the same
 * set produce byte-identical rows.
 *
 * An empty result is a legitimate answer — an installation may genuinely
 * disable every type — so callers that want the defaults must check for the
 * absence of a stored policy, not for an empty array.
 */
export function normalizeAllowedMediaMimes(raw: readonly string[]): MediaMime[] {
  const wanted = new Set<string>(raw)
  return MEDIA_TYPE_CATALOG.filter((d) => wanted.has(d.mime)).map((d) => d.mime)
}

/**
 * `accept` attribute for a file input. Emits extensions AND MIMEs: Windows
 * file dialogs match reliably on extension, while macOS and the drag-and-drop
 * path match on MIME, and the OOXML types in particular are reported
 * inconsistently across platforms.
 */
export function uploadAcceptAttribute(allowedMimes: readonly string[]): string {
  const defs = allowedMimes.map(mediaTypeByMime).filter((d): d is MediaTypeDefinition => d !== null)
  return [...defs.map((d) => d.extension), ...defs.map((d) => d.mime)].join(',')
}

const SETTINGS_HINT = 'An administrator can change this in Settings → Uploads.'

/**
 * Human sentence listing the accepted types, used as the upload rejection
 * message. Built from the caller's actual allow-list rather than hard-coded
 * prose, so the error a user sees always matches what the server would take.
 *
 * `settingsHint` appends the pointer to Settings, and belongs only to surfaces
 * the upload policy actually governs — the media library. Role-scoped surfaces
 * (avatars, the MCP image tool) enforce a fixed list no admin can widen, so
 * sending a user to Settings there would be a dead end.
 */
export function describeAllowedMediaTypes(
  allowedMimes: readonly string[],
  options: { settingsHint?: boolean } = {},
): string {
  const labels = allowedMimes
    .map(mediaTypeByMime)
    .filter((d): d is MediaTypeDefinition => d !== null)
    .map((d) => d.label)
  const hint = options.settingsHint ? ` ${SETTINGS_HINT}` : ''
  if (labels.length === 0) {
    return `Uploads are disabled: no file types are currently allowed.${hint}`
  }
  return `Only ${labels.join(', ')} files can be uploaded.${hint}`
}
