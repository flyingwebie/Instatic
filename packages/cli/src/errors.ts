/** A failure talking to the site, classified so callers can map it to an exit code. */
export type FailureKind = 'auth' | 'unreachable' | 'server'

export class ConnectionError extends Error {
  readonly kind: FailureKind

  constructor(kind: FailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ConnectionError'
    this.kind = kind
  }
}
