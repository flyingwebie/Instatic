import { describe, expect, it } from 'bun:test'
import { isPdfAsset, pdfContentKey } from '../pdfDocument'

describe('pdf asset helpers', () => {
  it('recognises PDFs by MIME type only', () => {
    expect(isPdfAsset({ mimeType: 'application/pdf' })).toBe(true)
    expect(isPdfAsset({ mimeType: 'application/msword' })).toBe(false)
    expect(isPdfAsset({ mimeType: 'image/png' })).toBe(false)
  })

  it('changes the content key when a file is replaced in place', () => {
    const original = { publicPath: '/uploads/a.pdf', sizeBytes: 100, replacedAt: null }
    const replaced = { ...original, replacedAt: '2026-11-03T15:00:00.000Z' }
    const resized = { ...original, sizeBytes: 200 }
    expect(pdfContentKey(original)).not.toBe(pdfContentKey(replaced))
    expect(pdfContentKey(original)).not.toBe(pdfContentKey(resized))
    expect(pdfContentKey(original)).toBe(pdfContentKey({ ...original }))
  })
})
