/**
 * Content-sniffing tests for the upload pipeline.
 *
 * The upload gate's whole security argument is that the persisted MIME comes
 * from the BYTES, never from `file.type` or the uploaded extension. These
 * tests pin the three things that argument rests on:
 *
 *   1. every format in the catalogue is actually reachable from its bytes —
 *      an entry no detector can produce would be a type the UI offers and the
 *      server always rejects;
 *   2. the pass ordering, which is what stops a PDF from being demoted to
 *      text/plain or an SVG from skipping the DOMPurify step;
 *   3. the narrow, deliberate places a filename is consulted, and the fact
 *      that lying about it can only change a label.
 */
import { describe, expect, it } from 'bun:test'
import { detectAcceptedMime } from '../mediaSniff'
import { MEDIA_TYPE_CATALOG, DEFAULT_ALLOWED_MEDIA_MIMES, ALL_MEDIA_MIMES } from '@core/media-types'

const enc = new TextEncoder()

function bytes(...parts: Array<number[] | string>): Uint8Array {
  const chunks = parts.map((p) => (typeof p === 'string' ? Array.from(enc.encode(p)) : p))
  return new Uint8Array(chunks.flat())
}

/** Pad to `length` so the next chunk starts at a known offset. */
function padTo(current: number, length: number): number[] {
  return new Array(Math.max(0, length - current)).fill(0x20)
}

const ZIP = [0x50, 0x4b, 0x03, 0x04]
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** A ZIP whose member names include `member`, past the ODF fixed-offset check. */
function zipContaining(member: string): Uint8Array {
  return bytes(ZIP, padTo(4, 30), 'not-mimetype!', member, 'trailing')
}

/** An ODF package: first member is an uncompressed `mimetype` entry. */
function odfPackage(mime: string): Uint8Array {
  return bytes(ZIP, padTo(4, 30), 'mimetype', mime)
}

describe('detectAcceptedMime — catalogue coverage', () => {
  it('can produce every MIME the catalogue advertises', () => {
    // Each sample is the minimum byte prefix a real file of that type starts
    // with. If a catalogue entry gains no sample here, this test fails and
    // the missing detector is the actual bug.
    const samples: Record<string, { data: Uint8Array; filename?: string }> = {
      'image/png': { data: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
      'image/jpeg': { data: bytes([0xff, 0xd8, 0xff, 0xe0]) },
      'image/gif': { data: bytes('GIF89a') },
      'image/webp': { data: bytes('RIFF', [0, 0, 0, 0], 'WEBP') },
      'image/avif': { data: bytes([0, 0, 0, 0x1c], 'ftypavif') },
      'image/svg+xml': { data: bytes('<svg viewBox="0 0 1 1"></svg>') },
      'video/mp4': { data: bytes([0, 0, 0, 0x18], 'ftypmp42') },
      'video/webm': { data: bytes([0x1a, 0x45, 0xdf, 0xa3]) },
      'audio/mpeg': { data: bytes('ID3', [0x04, 0x00]) },
      'audio/wav': { data: bytes('RIFF', [0, 0, 0, 0], 'WAVE') },
      'audio/ogg': { data: bytes('OggS', [0x00]) },
      'font/woff': { data: bytes('wOFF') },
      'font/woff2': { data: bytes('wOF2') },
      'font/ttf': { data: bytes([0x00, 0x01, 0x00, 0x00]) },
      'font/otf': { data: bytes('OTTO') },
      'application/pdf': { data: bytes('%PDF-1.7') },
      'application/rtf': { data: bytes('{\\rtf1\\ansi') },
      'text/plain': { data: bytes('just some notes'), filename: 'notes.txt' },
      'text/markdown': { data: bytes('# Heading'), filename: 'readme.md' },
      'text/csv': { data: bytes('a,b,c\n1,2,3'), filename: 'rows.csv' },
      'application/msword': { data: bytes(OLE), filename: 'letter.doc' },
      'application/vnd.ms-excel': { data: bytes(OLE), filename: 'budget.xls' },
      'application/vnd.ms-powerpoint': { data: bytes(OLE), filename: 'deck.ppt' },
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
        data: zipContaining('word/document.xml'),
      },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        data: zipContaining('xl/workbook.xml'),
      },
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
        data: zipContaining('ppt/presentation.xml'),
      },
      'application/vnd.oasis.opendocument.text': {
        data: odfPackage('application/vnd.oasis.opendocument.text'),
      },
      'application/vnd.oasis.opendocument.spreadsheet': {
        data: odfPackage('application/vnd.oasis.opendocument.spreadsheet'),
      },
      'application/vnd.oasis.opendocument.presentation': {
        data: odfPackage('application/vnd.oasis.opendocument.presentation'),
      },
      'application/zip': { data: zipContaining('photos/holiday.jpg') },
    }

    expect(Object.keys(samples).sort()).toEqual([...ALL_MEDIA_MIMES].sort())
    for (const [mime, sample] of Object.entries(samples)) {
      expect(detectAcceptedMime(sample.data, sample.filename)).toBe(mime)
    }
  })

  it('pairs every MIME with a unique extension', () => {
    const extensions = MEDIA_TYPE_CATALOG.map((d) => d.extension)
    expect(new Set(extensions).size).toBe(extensions.length)
    const mimes = MEDIA_TYPE_CATALOG.map((d) => d.mime)
    expect(new Set(mimes).size).toBe(mimes.length)
  })

  it('defaults to documents on, audio and archives off', () => {
    expect(DEFAULT_ALLOWED_MEDIA_MIMES).toContain('application/pdf')
    expect(DEFAULT_ALLOWED_MEDIA_MIMES).toContain('text/plain')
    expect(DEFAULT_ALLOWED_MEDIA_MIMES).not.toContain('audio/mpeg')
    expect(DEFAULT_ALLOWED_MEDIA_MIMES).not.toContain('application/zip')
  })
})

describe('detectAcceptedMime — pass ordering', () => {
  it('reads a PDF as a PDF, not as the printable ASCII it starts with', () => {
    expect(detectAcceptedMime(bytes('%PDF-1.4\n% notes'), 'report.txt')).toBe('application/pdf')
  })

  it('reads SVG as SVG even when the filename claims markdown', () => {
    expect(detectAcceptedMime(bytes('<svg></svg>'), 'notes.md')).toBe('image/svg+xml')
  })

  it('keeps WAV and WebP apart despite the shared RIFF container', () => {
    expect(detectAcceptedMime(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBe('audio/wav')
    expect(detectAcceptedMime(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('image/webp')
  })

  it('keeps AVIF ahead of the broader MP4 ftyp signature', () => {
    expect(detectAcceptedMime(bytes([0, 0, 0, 0x1c], 'ftypavif'))).toBe('image/avif')
  })
})

describe('detectAcceptedMime — the text probe', () => {
  it('rejects binary that carries no signature of its own', () => {
    expect(detectAcceptedMime(bytes([0x00, 0x01, 0x02, 0x7f, 0x00, 0xee]))).toBeNull()
  })

  it('rejects invalid UTF-8', () => {
    expect(detectAcceptedMime(bytes([0xc3, 0x28, 0x41, 0x42]))).toBeNull()
  })

  it('rejects an empty file', () => {
    expect(detectAcceptedMime(new Uint8Array())).toBeNull()
  })

  it('accepts text with tabs and newlines', () => {
    expect(detectAcceptedMime(bytes('col\tcol\r\nval\tval\n'), 'x.txt')).toBe('text/plain')
  })

  it('accepts non-ASCII UTF-8', () => {
    expect(detectAcceptedMime(bytes('Žluťoučký kůň — ok'), 'x.txt')).toBe('text/plain')
  })

  it('falls back to text/plain when the extension is absent or foreign', () => {
    expect(detectAcceptedMime(bytes('hello'))).toBe('text/plain')
    expect(detectAcceptedMime(bytes('hello'), 'script.js')).toBe('text/plain')
    expect(detectAcceptedMime(bytes('hello'), 'page.html')).toBe('text/plain')
  })
})

describe('detectAcceptedMime — filename only disambiguates a proven family', () => {
  it('cannot promote an OLE document out of the legacy-Office family', () => {
    // `.pdf` is a catalogue extension, but not one of the three the OLE
    // container can resolve to, so the fallback wins.
    expect(detectAcceptedMime(bytes(OLE), 'invoice.pdf')).toBe('application/msword')
  })

  it('cannot promote a text file out of the text family', () => {
    expect(detectAcceptedMime(bytes('plain'), 'sneaky.svg')).toBe('text/plain')
    expect(detectAcceptedMime(bytes('plain'), 'sneaky.docx')).toBe('text/plain')
  })

  it('ignores the filename entirely for a self-identifying format', () => {
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectAcceptedMime(png, 'evil.html')).toBe('image/png')
  })
})

describe('detectAcceptedMime — ZIP containers', () => {
  it('prefers the ODF mimetype member over an OOXML part name', () => {
    const conflicted = bytes(
      ZIP,
      padTo(4, 30),
      'mimetype',
      'application/vnd.oasis.opendocument.text',
      'word/document.xml',
    )
    expect(detectAcceptedMime(conflicted)).toBe('application/vnd.oasis.opendocument.text')
  })

  it('only honours a mimetype member at the ODF-mandated offset', () => {
    const late = bytes(ZIP, padTo(4, 64), 'mimetype', 'application/vnd.oasis.opendocument.text')
    expect(detectAcceptedMime(late)).toBe('application/zip')
  })

  it('finds OOXML part names in a large archive via the central directory', () => {
    // Bigger than the whole-file scan window, with the part name only in the
    // tail — the layout of any .docx carrying embedded media.
    const filler = new Uint8Array(700 * 1024).fill(0x41)
    const large = bytes(ZIP, padTo(4, 30), Array.from(filler), 'word/document.xml')
    expect(detectAcceptedMime(large)).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })
})
