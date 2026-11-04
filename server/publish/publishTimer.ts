/**
 * Wall-clock phase timer for a publish.
 *
 * A publish runs many steps (collab flush, runtime builds, the DB
 * transaction, the static bake) whose cost depends on the deployment — DB
 * latency, disk speed, site size — so a slow publish on one install can be
 * fast on another. Each publish logs one line with the per-phase split, and
 * the HTTP route forwards it as a `Server-Timing` header so the browser's
 * DevTools Timing tab shows where the time went.
 */

export interface PublishPhaseTiming {
  name: string
  ms: number
}

export interface PublishTimer {
  /** Close the phase that started at the previous mark (or creation). */
  mark(name: string): void
  readonly phases: readonly PublishPhaseTiming[]
}

export function createPublishTimer(): PublishTimer {
  const phases: PublishPhaseTiming[] = []
  let last = performance.now()
  return {
    mark(name) {
      const now = performance.now()
      phases.push({ name, ms: now - last })
      last = now
    },
    phases,
  }
}

/** `name;dur=12.3, …` — the `Server-Timing` header value. */
export function formatServerTiming(phases: readonly PublishPhaseTiming[]): string {
  const total = phases.reduce((sum, phase) => sum + phase.ms, 0)
  return [...phases, { name: 'total', ms: total }]
    .map((phase) => `${phase.name};dur=${phase.ms.toFixed(1)}`)
    .join(', ')
}

/** One human-readable log line, slowest phases first. */
export function formatPublishTimingLog(phases: readonly PublishPhaseTiming[]): string {
  const total = phases.reduce((sum, phase) => sum + phase.ms, 0)
  const parts = [...phases]
    .sort((a, b) => b.ms - a.ms)
    .map((phase) => `${phase.name}=${Math.round(phase.ms)}ms`)
  return `total=${Math.round(total)}ms ${parts.join(' ')}`
}
