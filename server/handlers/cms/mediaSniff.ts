/**
 * Content sniffing for uploaded media — the one place a file's real type is
 * decided.
 *
 * `file.type` is attacker-controlled in any non-browser HTTP client, so the
 * MIME that gets persisted is ALWAYS derived from the bytes. Nothing here
 * writes, stores or authorises anything: it answers one question — "what IS
 * this file?" — and `./mediaUpload.ts` decides what to do with the answer.
 *
 * WHICH types exist is not decided here either; the catalogue lives in
 * `@core/media-types`. Accepting a new type is a catalogue entry PLUS a
 * signature in this file. A catalogue entry with no detector is unreachable
 * (the UI would offer a type the server always rejects), which is what
 * `mediaUploadDetection.test.ts` gates.
 */
import { basename } from 'node:path'
import { mediaTypeByExtension, type MediaMime } from '@core/media-types'

// ─────────────────────────────────────────────────────────────────────────────
// Detection runs in four passes, in this order, and the order is
// load-bearing:
//
//   1. concrete magic-byte signatures  — one signature, one MIME
//   2. container signatures            — ZIP / OLE, whose family needs a
//                                        second look inside the bytes
//   3. the SVG text probe              — XML prolog or a top-level <svg
//   4. the generic UTF-8 text probe    — the catch-all for .txt/.md/.csv
//
// Passes 3 and 4 must stay last: every binary format above them would also
// satisfy a loose text check on some inputs, and PDF in particular starts
// with printable ASCII. Pass 3 must precede pass 4 so an SVG is never
// demoted to text/plain and skipped past the DOMPurify step.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Magic-byte signatures. Each is a list of `(offset, byte)` constraints — the
 * file passes if every constraint is satisfied. Some formats (WebP, MP4,
 * WAV) need non-contiguous checks (`RIFF....WEBP`, `....ftyp`), hence the
 * offset list rather than a single contiguous prefix match.
 */
type MagicConstraint = readonly [offset: number, byte: number]

interface MagicSignature {
  mime: MediaMime
  bytes: ReadonlyArray<MagicConstraint>
}

const MEDIA_MAGIC_SIGNATURES: ReadonlyArray<MagicSignature> = [
  // ─── Images ──────────────────────────────────────────────────────────
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mime: 'image/png', bytes: [[0, 0x89], [1, 0x50], [2, 0x4e], [3, 0x47], [4, 0x0d], [5, 0x0a], [6, 0x1a], [7, 0x0a]] },
  // JPEG: FF D8 FF (SOI marker followed by any APPx marker)
  { mime: 'image/jpeg', bytes: [[0, 0xff], [1, 0xd8], [2, 0xff]] },
  // GIF87a / GIF89a
  { mime: 'image/gif', bytes: [[0, 0x47], [1, 0x49], [2, 0x46], [3, 0x38], [4, 0x37], [5, 0x61]] },
  { mime: 'image/gif', bytes: [[0, 0x47], [1, 0x49], [2, 0x46], [3, 0x38], [4, 0x39], [5, 0x61]] },
  // WebP: RIFF<size>WEBP — bytes 0..3 = RIFF, bytes 8..11 = WEBP
  { mime: 'image/webp', bytes: [[0, 0x52], [1, 0x49], [2, 0x46], [3, 0x46], [8, 0x57], [9, 0x45], [10, 0x42], [11, 0x50]] },
  // AVIF: ISO Base Media `ftyp` box with `avif` as the major brand. Keep this
  // before MP4: MP4's broader `ftyp` signature also matches every AVIF file.
  { mime: 'image/avif', bytes: [[4, 0x66], [5, 0x74], [6, 0x79], [7, 0x70], [8, 0x61], [9, 0x76], [10, 0x69], [11, 0x66]] },

  // ─── Video ───────────────────────────────────────────────────────────
  // MP4 / ISO Base Media: `ftyp` box at offset 4..7. The first 4 bytes are
  // the box size which varies; only the type identifier matters here.
  { mime: 'video/mp4', bytes: [[4, 0x66], [5, 0x74], [6, 0x79], [7, 0x70]] },
  // WebM: EBML header 1A 45 DF A3 (also Matroska — close enough for us;
  // the content-type we serve is video/webm regardless and browsers will
  // refuse to play non-webm Matroska, which is the desired outcome).
  { mime: 'video/webm', bytes: [[0, 0x1a], [1, 0x45], [2, 0xdf], [3, 0xa3]] },

  // ─── Audio ───────────────────────────────────────────────────────────
  // WAV: RIFF<size>WAVE. Same container as WebP, different form type, so the
  // two signatures are mutually exclusive on bytes 8..11.
  { mime: 'audio/wav', bytes: [[0, 0x52], [1, 0x49], [2, 0x46], [3, 0x46], [8, 0x57], [9, 0x41], [10, 0x56], [11, 0x45]] },
  // Ogg: "OggS" capture pattern per RFC 3533. A theora/vorbis mux also
  // matches; we serve it as audio/ogg either way, which browsers handle.
  { mime: 'audio/ogg', bytes: [[0, 0x4f], [1, 0x67], [2, 0x67], [3, 0x53]] },
  // MP3 with an ID3v2 tag: "ID3".
  { mime: 'audio/mpeg', bytes: [[0, 0x49], [1, 0x44], [2, 0x33]] },
  // Bare MP3 frame sync: 11 set bits, then MPEG version + layer bits. The
  // three combinations below are MPEG-1/2/2.5 Layer III, i.e. every file a
  // browser will actually decode as audio/mpeg.
  { mime: 'audio/mpeg', bytes: [[0, 0xff], [1, 0xfb]] },
  { mime: 'audio/mpeg', bytes: [[0, 0xff], [1, 0xf3]] },
  { mime: 'audio/mpeg', bytes: [[0, 0xff], [1, 0xf2]] },

  // ─── Web fonts ───────────────────────────────────────────────────────
  // WOFF: 77 4F 46 46 ("wOFF") per W3C WOFF1 §3.
  { mime: 'font/woff', bytes: [[0, 0x77], [1, 0x4f], [2, 0x46], [3, 0x46]] },
  // WOFF2: 77 4F 46 32 ("wOF2") per W3C WOFF2 §3.
  { mime: 'font/woff2', bytes: [[0, 0x77], [1, 0x4f], [2, 0x46], [3, 0x32]] },
  // TTF / TrueType: 00 01 00 00 (sfnt scaler type) OR "true" / "ttcf" (rare).
  { mime: 'font/ttf', bytes: [[0, 0x00], [1, 0x01], [2, 0x00], [3, 0x00]] },
  { mime: 'font/ttf', bytes: [[0, 0x74], [1, 0x72], [2, 0x75], [3, 0x65]] }, // "true"
  // OTF / OpenType with CFF outlines: 4F 54 54 4F ("OTTO") per OpenType §6.
  { mime: 'font/otf', bytes: [[0, 0x4f], [1, 0x54], [2, 0x54], [3, 0x4f]] },

  // ─── Documents with real magic bytes ─────────────────────────────────
  // PDF: "%PDF-" per ISO 32000-1 §7.5.2. Checked before the text probes —
  // a PDF header is printable ASCII and would otherwise pass as text/plain.
  { mime: 'application/pdf', bytes: [[0, 0x25], [1, 0x50], [2, 0x44], [3, 0x46], [4, 0x2d]] },
  // RTF: "{\rtf1" per the RTF specification. Same reasoning as PDF.
  { mime: 'application/rtf', bytes: [[0, 0x7b], [1, 0x5c], [2, 0x72], [3, 0x74], [4, 0x66], [5, 0x31]] },
]

/** ZIP local file header: "PK\x03\x04". */
const ZIP_SIGNATURE: ReadonlyArray<MagicConstraint> = [[0, 0x50], [1, 0x4b], [2, 0x03], [3, 0x04]]

/** OLE2 / Compound File Binary header, shared by every pre-2007 Office file. */
const OLE_SIGNATURE: ReadonlyArray<MagicConstraint> = [
  [0, 0xd0], [1, 0xcf], [2, 0x11], [3, 0xe0], [4, 0xa1], [5, 0xb1], [6, 0x1a], [7, 0xe1],
]

function matchesSignature(bytes: Uint8Array, constraints: ReadonlyArray<MagicConstraint>): boolean {
  for (const [offset, expected] of constraints) {
    if (offset >= bytes.length || bytes[offset] !== expected) return false
  }
  return true
}

/** Lower-cased extension (with the dot) of a client-supplied filename. */
function declaredExtension(filename: string | undefined): string {
  if (!filename) return ''
  const stem = basename(filename.replace(/\\/g, '/'))
  const dot = stem.lastIndexOf('.')
  if (dot <= 0) return ''
  return stem.slice(dot).toLowerCase()
}

/**
 * Resolve a concrete MIME from the uploaded filename, restricted to
 * `candidates`. Falls back to `fallback` when the extension is absent,
 * unknown, or outside the family.
 *
 * Trusting the extension here is NOT a hole in the "never trust the client"
 * rule: the bytes have already been proven to belong to `candidates`' family,
 * and every member of each family we resolve this way shares the same
 * download-only serving treatment. The extension picks a label, never a
 * capability — the worst a lie achieves is an .xls file listed as .doc.
 */
function resolveFamilyMime(
  filename: string | undefined,
  candidates: ReadonlyArray<MediaMime>,
  fallback: MediaMime,
): MediaMime {
  const ext = declaredExtension(filename)
  if (!ext) return fallback
  const def = mediaTypeByExtension(ext)
  if (!def) return fallback
  return candidates.includes(def.mime as MediaMime) ? (def.mime as MediaMime) : fallback
}

/**
 * Find an ASCII needle inside a byte range. Used to identify a ZIP's family
 * from its member names without unzipping anything.
 */
function bytesIncludeAscii(bytes: Uint8Array, needle: string, from: number, to: number): boolean {
  const end = Math.min(to, bytes.length)
  const limit = end - needle.length
  for (let i = Math.max(0, from); i <= limit; i += 1) {
    let hit = true
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle.charCodeAt(j)) {
        hit = false
        break
      }
    }
    if (hit) return true
  }
  return false
}

/**
 * How much of a large ZIP we scan for member names. A ZIP lists every member
 * twice: once in a local header before the member's data, and once in the
 * central directory at the very end. Small files are scanned whole; for
 * larger ones the head covers the first few members (OOXML always writes
 * `[Content_Types].xml` and the main part early) and the tail covers the
 * central directory, which names everything regardless of size.
 */
const ZIP_SCAN_WHOLE_BYTES = 512 * 1024
const ZIP_SCAN_HEAD_BYTES = 64 * 1024
const ZIP_SCAN_TAIL_BYTES = 512 * 1024

function zipIncludesMember(bytes: Uint8Array, member: string): boolean {
  if (bytes.length <= ZIP_SCAN_WHOLE_BYTES) {
    return bytesIncludeAscii(bytes, member, 0, bytes.length)
  }
  return (
    bytesIncludeAscii(bytes, member, 0, ZIP_SCAN_HEAD_BYTES) ||
    bytesIncludeAscii(bytes, member, bytes.length - ZIP_SCAN_TAIL_BYTES, bytes.length)
  )
}

/** The ODF `mimetype` member value, when the file follows ODF §3.3. */
const ODF_MIME_BY_VALUE: ReadonlyMap<string, MediaMime> = new Map([
  ['application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.text'],
  ['application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['application/vnd.oasis.opendocument.presentation', 'application/vnd.oasis.opendocument.presentation'],
])

/**
 * Classify a ZIP container.
 *
 * OpenDocument first: ODF §3.3 requires the archive's FIRST member to be an
 * uncompressed entry named `mimetype` whose content is the document's media
 * type, which puts a definitive answer at a fixed offset (30 = after the
 * 30-byte local header, 38 = after the 8-byte name).
 *
 * Then OOXML, identified by the part that defines the document body. The
 * three are mutually exclusive in practice; checked in a fixed order so a
 * hand-crafted archive containing several still lands on exactly one.
 *
 * Anything else is a plain ZIP.
 */
function detectZipMime(bytes: Uint8Array): MediaMime {
  if (bytesIncludeAscii(bytes, 'mimetype', 30, 38)) {
    // The value runs from offset 38 to the end of the member; every ODF
    // media type we accept is well under 64 characters.
    const value = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(38, 38 + 64))
    for (const [prefix, mime] of ODF_MIME_BY_VALUE) {
      if (value.startsWith(prefix)) return mime
    }
  }
  if (zipIncludesMember(bytes, 'word/document.xml')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  if (zipIncludesMember(bytes, 'xl/workbook.xml')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  if (zipIncludesMember(bytes, 'ppt/presentation.xml')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  }
  return 'application/zip'
}

/** Pre-2007 Office formats, which share one indistinguishable container. */
const LEGACY_OFFICE_MIMES: ReadonlyArray<MediaMime> = [
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]

/** Text formats that differ only by convention, never by content. */
const TEXT_MIMES: ReadonlyArray<MediaMime> = ['text/plain', 'text/markdown', 'text/csv']

/**
 * SVG is text-based (XML), not a magic-byte format, so it can't be detected
 * by the binary sniffer above. Decode the first ~512 bytes as UTF-8 and look
 * for the XML prolog or a top-level `<svg` opening tag, allowing an optional
 * BOM and leading whitespace. Returns `'image/svg+xml'` when matched.
 *
 * This is intentionally lenient — the **security** boundary is the
 * subsequent DOMPurify pass (SVG profile) which strips `<script>`,
 * `<foreignObject>`, `javascript:` / `data:` URLs, and on-* handlers
 * regardless of how the file claims to be structured.
 */
function detectSvgMime(bytes: Uint8Array): MediaMime | null {
  // Decode the first 512 bytes; bigger files just look at the prefix.
  const slice = bytes.subarray(0, Math.min(bytes.length, 512))
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
  const head = decoder.decode(slice).trimStart()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    return 'image/svg+xml'
  }
  return null
}

/** How much of a file the plain-text probe reads before deciding. */
const TEXT_PROBE_BYTES = 64 * 1024

/**
 * Whether the bytes look like human-readable UTF-8 text.
 *
 * Only a prefix is examined. That is a heuristic, not a guarantee, and it is
 * allowed to be one: text uploads are stored under a server-chosen `.txt` /
 * `.md` / `.csv` extension and served with `nosniff`, a zero-permission CSP
 * and `Content-Disposition: attachment`, so misreading a binary tail as text
 * produces a useless download, never executable content.
 *
 * `fatal: true` with `stream: true` rejects invalid UTF-8 while tolerating a
 * multi-byte sequence cut in half by the probe window. Control characters
 * other than tab / newline / carriage return / form feed disqualify the file,
 * which is what actually separates text from binary in practice — NUL bytes
 * are the giveaway in every binary format that has no signature of its own.
 */
function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  const slice = bytes.subarray(0, Math.min(bytes.length, TEXT_PROBE_BYTES))
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(slice, { stream: true })
  } catch {
    return false
  }
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) continue
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

/**
 * Derive the MIME to persist from the uploaded bytes, never from the
 * client's declared type. `filename` is consulted only to pick between
 * members of an already-proven family (see `resolveFamilyMime`); detection
 * itself never depends on it, so callers that have no filename — the site
 * importer re-validating archived bytes — get the same verdict.
 *
 * Returns `null` when the bytes match nothing the catalogue describes.
 */
export function detectAcceptedMime(bytes: Uint8Array, filename?: string): MediaMime | null {
  for (const sig of MEDIA_MAGIC_SIGNATURES) {
    if (matchesSignature(bytes, sig.bytes)) return sig.mime
  }

  if (matchesSignature(bytes, ZIP_SIGNATURE)) return detectZipMime(bytes)
  if (matchesSignature(bytes, OLE_SIGNATURE)) {
    return resolveFamilyMime(filename, LEGACY_OFFICE_MIMES, 'application/msword')
  }

  // Text-based detection runs LAST so a binary file that happens to start
  // with `<svg` or with printable ASCII can't outrank its real signature.
  const svg = detectSvgMime(bytes)
  if (svg) return svg

  if (looksLikeUtf8Text(bytes)) return resolveFamilyMime(filename, TEXT_MIMES, 'text/plain')

  return null
}
