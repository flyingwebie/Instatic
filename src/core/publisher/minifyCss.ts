/**
 * minifyCss — compress published CSS without changing what it means.
 *
 * Every byte the publisher emits is CSS a browser has to download and parse,
 * and the authored side of it is written for people: comments, indentation,
 * one declaration per line. None of that survives usefully on a published
 * page, so the publish channel ships the compressed form instead — the four
 * site bundle files (`server/publish/siteCssBundle.ts`) and the inline
 * `<style>` block (`render.ts`) both run their assembled body through here.
 * The editor's buffers are untouched: authors keep the readable source.
 *
 * Deliberately conservative — a wrong byte here breaks a live site, and the
 * input includes hand-written user stylesheets, not just publisher output:
 *
 * - String literals and unquoted `url(…)` bodies are copied through verbatim,
 *   so quotes, escapes and paths survive intact.
 * - Whitespace runs collapse to ONE space, dropped only where it cannot carry
 *   meaning (next to `{`, `}`, `;`, `,`). Spaces around `:`, `+`, `-`, `~`
 *   and `>` are left alone: they are a descendant combinator in a selector or
 *   an operand separator in `calc()` just as often as they are padding.
 * - Comments are removed, except `/*!` ones — the convention for a licence
 *   header that must stay in the output.
 * - The last `;` in a block is redundant and goes.
 *
 * The result is byte-stable for a given input, which matters: the bundle
 * filenames are a content hash of exactly this output.
 */

/** Characters that cannot be separated from an adjacent token by whitespace. */
const BOUNDARY = new Set(['{', '}', ';', ','])

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f'])

/** An unquoted `url(` body, matched in place at `lastIndex` (sticky). */
const UNQUOTED_URL = /url\(\s*[^'"\s)]/iy

export function minifyCss(css: string): string {
  // The output is collected as chunks and joined once. Reading the tail of a
  // string grown with `+=` (`at(-1)`, `endsWith`, `slice`) makes the engine
  // flatten and copy everything written so far, which turned every token into
  // O(output) work and the whole minify quadratic in the stylesheet size.
  // Every chunk is non-empty, so the last character is the last chunk's.
  const parts: string[] = []
  let pendingSpace = false
  let index = 0

  const lastChar = (): string | undefined => parts.at(-1)?.at(-1)

  /** Emit `text`, resolving the deferred whitespace run in front of it. */
  const write = (text: string) => {
    if (pendingSpace) {
      pendingSpace = false
      const previous = lastChar()
      if (previous !== undefined && !BOUNDARY.has(previous) && !BOUNDARY.has(text[0]!)) parts.push(' ')
    }
    parts.push(text)
  }

  /** Drop trailing `;` characters already written (the block is closing). */
  const trimTrailingSemicolons = () => {
    while (lastChar() === ';') {
      const trimmed = parts.pop()!.slice(0, -1)
      if (trimmed.length > 0) parts.push(trimmed)
    }
  }

  while (index < css.length) {
    const char = css[index]!

    // ── Comments ────────────────────────────────────────────────────────────
    if (char === '/' && css[index + 1] === '*') {
      const close = css.indexOf('*/', index + 2)
      const end = close === -1 ? css.length : close + 2
      // `/*! … */` is the licence-header convention: keep it byte-for-byte.
      if (css[index + 2] === '!') write(css.slice(index, end))
      // A removed comment still separated two tokens (`a/* x */b`).
      else pendingSpace = true
      index = end
      continue
    }

    // ── String literals ─────────────────────────────────────────────────────
    if (char === '"' || char === "'") {
      let cursor = index + 1
      while (cursor < css.length) {
        if (css[cursor] === '\\') {
          cursor += 2
          continue
        }
        if (css[cursor] === char) {
          cursor += 1
          break
        }
        cursor += 1
      }
      write(css.slice(index, cursor))
      index = cursor
      continue
    }

    // ── Unquoted url(…) ─────────────────────────────────────────────────────
    // A quoted body is handled by the string branch above once `url(` is
    // written; only the unquoted form needs its bytes preserved wholesale.
    if (char === 'u' || char === 'U') {
      UNQUOTED_URL.lastIndex = index
      if (UNQUOTED_URL.test(css)) {
        const close = css.indexOf(')', index)
        const end = close === -1 ? css.length : close + 1
        write(css.slice(index, end).replace(/\s+/g, ''))
        index = end
        continue
      }
    }

    // ── Whitespace ──────────────────────────────────────────────────────────
    if (WHITESPACE.has(char)) {
      pendingSpace = true
      index += 1
      continue
    }

    // ── Block close: the trailing `;` inside it is redundant ────────────────
    if (char === '}') {
      trimTrailingSemicolons()
      pendingSpace = false
      write('}')
      index += 1
      continue
    }

    // ── Empty statement: `;;` or a `;` straight after `{` ───────────────────
    if (char === ';') {
      const previous = lastChar()
      if (previous === undefined || previous === ';' || previous === '{') {
        pendingSpace = false
        index += 1
        continue
      }
    }

    write(char)
    index += 1
  }

  return parts.join('')
}
