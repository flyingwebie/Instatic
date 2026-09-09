import { describe, expect, it } from 'bun:test'
import { syncProjectionFormatting } from '@site/code-dock/html/syncProjectionFormatting'

describe('projection formatting synchronization', () => {
  it('changes loop attributes without collapsing nested markup or authored spacing', () => {
    const before = '<instatic-loop\n  uid="loop"\n  data-page-size="12"\n>12<instatic-loop\n  uid="inner"\n><p uid="text">Title</p></instatic-loop></instatic-loop>\n'
    const next = '<instatic-loop uid="loop" data-page-size="9">12<instatic-loop uid="inner"><p uid="text">Title</p></instatic-loop></instatic-loop>'
    expect(syncProjectionFormatting(before, next)).toBe(before.replace('"12"', '"9"'))
  })

  it('adds newly assigned uids without discarding the source layout', () => {
    const before = '<div\n  class="card"\n>\n  <p>Hello</p>\n</div>\n'
    const next = '<div uid="container" class="card">\n  <p uid="text">Hello</p>\n</div>'
    expect(syncProjectionFormatting(before, next)).toBe('<div\n  uid="container"\n  class="card"\n>\n  <p uid="text">Hello</p>\n</div>\n')
  })

  it('applies attribute removal, boolean changes, and text changes', () => {
    expect(syncProjectionFormatting('<input\n  disabled="disabled"\n  title="old">', '<input disabled>')).toBe('<input\n  disabled>')
    expect(syncProjectionFormatting('<p uid="a">Old</p>\n', '<p uid="a">New</p>')).toBe('<p uid="a">New</p>\n')
  })

  it('can remove the first attribute while inserting a new uid at the same boundary', () => {
    expect(syncProjectionFormatting('<div\n  title="removed"></div>', '<div uid="new"></div>')).toBe('<div\n  uid="new"></div>')
  })

  it('does not hide significant whitespace changes inside raw-text elements', () => {
    for (const tag of ['pre', 'textarea', 'script', 'style']) {
      expect(syncProjectionFormatting(`<${tag}>  text  </${tag}>`, `<${tag}> text </${tag}>`)).toBe(`<${tag}> text </${tag}>`)
    }
  })

  it('uses the new projection for structural changes or invalid source', () => {
    const next = '<div><p>Added</p></div>'
    expect(syncProjectionFormatting('<div></div>', next)).toBe(next)
    expect(syncProjectionFormatting('<div><p', next)).toBe(next)
  })
})
