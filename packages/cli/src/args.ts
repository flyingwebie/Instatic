/**
 * Minimal argv parser: positionals plus `--flag`, `--flag value`, and
 * `--flag=value`. Boolean flags are declared up front so `--json tools` does
 * not swallow `tools` as the flag's value.
 */

export interface ParsedArgs {
  positionals: string[]
  flags: Map<string, string | true>
}

const BOOLEAN_FLAGS = new Set(['json', 'help', 'version', 'token-stdin', 'all'])

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg === '-h') {
      flags.set('help', true)
      continue
    }
    if (!arg.startsWith('--') || arg === '--') {
      positionals.push(arg)
      continue
    }

    const body = arg.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      flags.set(body.slice(0, eq), body.slice(eq + 1))
      continue
    }
    if (BOOLEAN_FLAGS.has(body)) {
      flags.set(body, true)
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags.set(body, true)
      continue
    }
    flags.set(body, next)
    i++
  }

  return { positionals, flags }
}

/** A string flag's value, or undefined. A bare `--flag` with no value is a usage error. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name)
  if (value === undefined) return undefined
  if (value === true) throw new UsageError(`--${name} needs a value.`)
  return value
}

export function booleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true
}

/** Wrong invocation: printed with a hint, exits with `EXIT.usage`. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}
