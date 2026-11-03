/**
 * Decides whether a push to `main` cuts a release, and prepares it.
 *
 * Run by `.github/workflows/auto-release.yml` on every merge to `main`:
 *
 * - `package.json` holds a version that has no `v<version>` tag yet (a
 *   hand-prepared release PR) → release that version as-is.
 * - The merged PR is a `feat`, `fix`, `perf`, or `revert` → bump the version
 *   (patch, or minor for a `!` breaking change), move the changelog's
 *   `## Unreleased` notes under a dated heading, and release.
 * - Anything else (`docs`, `chore`, `test`, upstream syncs, …) → no release.
 *
 * Writes `release`, `version`, `tag`, and `changed` to `$GITHUB_OUTPUT`.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const RELEASING_TYPES = new Set(['feat', 'fix', 'perf', 'revert'])

const PackageJsonSchema = Type.Object({ version: Type.String() })

export type ReleasePlan =
  | { kind: 'none'; reason: string }
  | { kind: 'prepared'; version: string }
  | { kind: 'bump'; version: string; title: string }

/**
 * The change title behind a push to `main`: the PR title for a merge commit
 * (GitHub puts it on the first line after the blank line), otherwise the
 * subject line, without a squash merge's `(#123)` suffix or a gitmoji prefix.
 */
export function changeTitle(commitMessage: string): string {
  const lines = commitMessage.split('\n').map((line) => line.trim())
  const subject = lines[0] ?? ''
  const title = /^Merge pull request #\d+ /.test(subject)
    ? (lines.slice(1).find((line) => line.length > 0) ?? subject)
    : subject
  return title
    .replace(/\s+\(#\d+\)$/, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
}

/** Parses a Conventional Commit title into its type and breaking flag. */
export function conventionalType(
  title: string,
): { type: string; breaking: boolean } | null {
  const match = /^([a-z]+)(?:\([^)]*\))?(!)?:\s/.exec(title)
  if (!match) return null
  return { type: match[1], breaking: match[2] === '!' }
}

export function bumpVersion(version: string, breaking: boolean): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`[release] Unsupported version "${version}"`)
  const [major, minor, patch] = match.slice(1).map(Number)
  // Pre-1.0, a breaking change bumps the minor; everything else the patch.
  return breaking ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
}

export function planRelease(input: {
  commitMessage: string
  currentVersion: string
  tags: ReadonlySet<string>
}): ReleasePlan {
  if (!input.tags.has(`v${input.currentVersion}`)) {
    return { kind: 'prepared', version: input.currentVersion }
  }
  const title = changeTitle(input.commitMessage)
  const parsed = conventionalType(title)
  if (!parsed || !RELEASING_TYPES.has(parsed.type)) {
    return { kind: 'none', reason: `"${title}" is not a releasing change` }
  }
  const version = bumpVersion(input.currentVersion, parsed.breaking)
  if (input.tags.has(`v${version}`)) {
    throw new Error(`[release] Tag v${version} already exists`)
  }
  return { kind: 'bump', version, title }
}

/**
 * Moves the `## Unreleased` notes under `## <version> - <date>` and leaves an
 * empty `## Unreleased` above it. With no notes, the change title becomes the
 * single entry.
 */
export function releaseChangelog(
  changelog: string,
  version: string,
  date: string,
  title: string,
): string {
  const heading = '## Unreleased'
  const start = changelog.indexOf(`${heading}\n`)
  if (start === -1) {
    throw new Error('[release] CHANGELOG.md has no "## Unreleased" heading')
  }
  const bodyStart = start + heading.length + 1
  const next = changelog.indexOf('\n## ', bodyStart)
  const bodyEnd = next === -1 ? changelog.length : next + 1
  const notes = changelog.slice(bodyStart, bodyEnd).trim() || `- ${title}`
  return (
    changelog.slice(0, start) +
    `${heading}\n\n## ${version} - ${date}\n\n${notes}\n\n` +
    changelog.slice(bodyEnd).replace(/^\n+/, '')
  )
}

function gitTags(): Set<string> {
  const result = Bun.spawnSync(['git', 'tag', '--list', 'v*'])
  if (result.exitCode !== 0) {
    throw new Error(`[release] git tag failed: ${result.stderr.toString()}`)
  }
  return new Set(result.stdout.toString().split('\n').filter(Boolean))
}

function writeOutputs(outputs: Record<string, string>): void {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`)
  console.error(`[release] ${lines.join(' ')}`)
  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) appendFileSync(outputFile, `${lines.join('\n')}\n`)
}

function main(): void {
  const commitMessage = process.env.COMMIT_MESSAGE
  if (!commitMessage) throw new Error('[release] COMMIT_MESSAGE is not set')

  const packageRaw = readFileSync('package.json', 'utf8')
  const pkg = Value.Parse(PackageJsonSchema, JSON.parse(packageRaw))
  const plan = planRelease({
    commitMessage,
    currentVersion: pkg.version,
    tags: gitTags(),
  })

  if (plan.kind === 'none') {
    console.error(`[release] No release: ${plan.reason}`)
    writeOutputs({ release: 'false' })
    return
  }

  if (plan.kind === 'bump') {
    writeFileSync(
      'package.json',
      packageRaw.replace(
        /("version":\s*")[^"]+(")/,
        `$1${plan.version}$2`,
      ),
    )
    const date = new Date().toISOString().slice(0, 10)
    writeFileSync(
      'CHANGELOG.md',
      releaseChangelog(readFileSync('CHANGELOG.md', 'utf8'), plan.version, date, plan.title),
    )
  }

  writeOutputs({
    release: 'true',
    version: plan.version,
    tag: `v${plan.version}`,
    changed: plan.kind === 'bump' ? 'true' : 'false',
  })
}

if (import.meta.main) main()
