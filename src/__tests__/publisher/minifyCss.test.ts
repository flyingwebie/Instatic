/**
 * minifyCss — the published-CSS compressor.
 *
 * The bar is "smaller, never different": the published bundle filenames are a
 * hash of this output, and the input includes hand-written user stylesheets,
 * so every case here is about a byte that must NOT be touched as much as it
 * is about the bytes that should go.
 */
import { describe, it, expect } from 'bun:test'
import { minifyCss } from '@core/publisher'

describe('minifyCss', () => {
  it('collapses formatting around block and declaration boundaries', () => {
    const css = `
      .hero {
        color: red;
        font-size: 48px;
      }

      .card {
        margin: 0;
      }
    `
    expect(minifyCss(css)).toBe('.hero{color: red;font-size: 48px}.card{margin: 0}')
  })

  it('drops comments but keeps a /*! licence header verbatim', () => {
    expect(minifyCss('/* internal note */\n.a { color: red }')).toBe('.a{color: red}')
    expect(minifyCss('/*! (c) Acme */\n.a { color: red }')).toBe('/*! (c) Acme */ .a{color: red}')
  })

  it('keeps the descendant combinator a comment or newline stood in for', () => {
    expect(minifyCss('.a   .b { color: red }')).toBe('.a .b{color: red}')
    expect(minifyCss('.a/* x */.b { color: red }')).toBe('.a .b{color: red}')
    expect(minifyCss('.a >\n.b { color: red }')).toBe('.a > .b{color: red}')
  })

  it('leaves calc() operands and :pseudo selectors spaced as authored', () => {
    expect(minifyCss('.a { width: calc(100% - 2px) }')).toBe('.a{width: calc(100% - 2px)}')
    expect(minifyCss('a:hover { color: red }')).toBe('a:hover{color: red}')
    expect(minifyCss('a :hover { color: red }')).toBe('a :hover{color: red}')
  })

  it('preserves string literals byte-for-byte', () => {
    const css = `.a::after { content: "  {;}  /* not a comment */  " }`
    expect(minifyCss(css)).toBe(`.a::after{content: "  {;}  /* not a comment */  "}`)
  })

  it('preserves escaped quotes inside a string', () => {
    expect(minifyCss(`.a { content: '\\'' }`)).toBe(`.a{content: '\\''}`)
  })

  it('keeps url() bodies intact in both quoted and unquoted form', () => {
    expect(minifyCss('.a { background: url(/img/a b.png) }')).toBe('.a{background: url(/img/ab.png)}')
    expect(minifyCss('.a { background: url( "/img/a.png" ) }')).toBe('.a{background: url( "/img/a.png" )}')
  })

  it('removes the redundant final semicolon and empty statements', () => {
    expect(minifyCss('.a { color: red; }')).toBe('.a{color: red}')
    expect(minifyCss('.a { ; color: red;; }')).toBe('.a{color: red}')
  })

  it('compresses nested at-rules', () => {
    const css = `
      @media (min-width: 600px) {
        .a {
          color: red;
        }
      }
    `
    expect(minifyCss(css)).toBe('@media (min-width: 600px){.a{color: red}}')
  })

  it('is idempotent and returns empty for empty input', () => {
    const once = minifyCss('.a { color: red; }\n/* x */\n.b { color: blue }')
    expect(minifyCss(once)).toBe(once)
    expect(minifyCss('')).toBe('')
    expect(minifyCss('   \n  ')).toBe('')
  })

  it('does not swallow an unterminated comment or string', () => {
    expect(minifyCss('.a { color: red } /* dangling')).toBe('.a{color: red}')
    expect(minifyCss('.a { content: "dangling')).toBe('.a{content: "dangling')
  })
})
