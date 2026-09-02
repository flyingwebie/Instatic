/**
 * The lezer syntax-node type the context completion sources walk, named
 * once here (it is not re-exported by @codemirror/language).
 *
 * Part of the lazy CodeMirror chunk (see codemirror-lazy-only.test.ts).
 */
import type { syntaxTree } from '@codemirror/language'

export type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']
