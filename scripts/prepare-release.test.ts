import { describe, expect, test } from 'bun:test'
import {
  bumpVersion,
  changeTitle,
  conventionalType,
  planRelease,
  releaseChangelog,
} from './prepare-release'

describe('changeTitle', () => {
  test('reads the PR title from a merge commit', () => {
    expect(
      changeTitle(
        'Merge pull request #17 from flyingwebie/feat/instatic-cli\n\nfeat(cli): add the instatic CLI',
      ),
    ).toBe('feat(cli): add the instatic CLI')
  })

  test('drops a squash merge suffix and a gitmoji prefix', () => {
    expect(changeTitle('✨ feat(admin): show the version (#16)\n\nbody')).toBe(
      'feat(admin): show the version',
    )
  })
})

describe('conventionalType', () => {
  test('parses type, scope, and breaking marker', () => {
    expect(conventionalType('feat(cli)!: drop flag')).toEqual({ type: 'feat', breaking: true })
    expect(conventionalType('fix: crash')).toEqual({ type: 'fix', breaking: false })
    expect(conventionalType('Update readme')).toBeNull()
  })
})

describe('bumpVersion', () => {
  test('bumps the patch, or the minor for a breaking change', () => {
    expect(bumpVersion('0.0.24', false)).toBe('0.0.25')
    expect(bumpVersion('0.0.24', true)).toBe('0.1.0')
  })
})

describe('planRelease', () => {
  const tags = new Set(['v0.0.22', 'v0.0.24'])
  const merge = (title: string) =>
    `Merge pull request #1 from flyingwebie/branch\n\n${title}`

  test('releases a prepared, untagged version as-is, whatever the change type', () => {
    expect(
      planRelease({ commitMessage: merge('chore(release): prepare'), currentVersion: '0.0.25', tags }),
    ).toEqual({ kind: 'prepared', version: '0.0.25' })
  })

  test('bumps for a feature or fix', () => {
    expect(
      planRelease({ commitMessage: merge('feat(editor): x'), currentVersion: '0.0.24', tags }),
    ).toEqual({ kind: 'bump', version: '0.0.25', title: 'feat(editor): x' })
  })

  test('skips docs, chores, and upstream syncs', () => {
    for (const title of ['docs: x', 'chore(sync): merge upstream', 'test: y']) {
      expect(
        planRelease({ commitMessage: merge(title), currentVersion: '0.0.24', tags }).kind,
      ).toBe('none')
    }
  })
})

describe('releaseChangelog', () => {
  const head = '# Changelog\n\nIntro.\n\n'
  const older = '## 0.0.24 - 2026-10-30\n\n- Old.\n'

  test('moves Unreleased notes under the new version', () => {
    const before = `${head}## Unreleased\n\n### Added\n\n- New thing.\n\n${older}`
    expect(releaseChangelog(before, '0.0.25', '2026-11-03', 'feat: x')).toBe(
      `${head}## Unreleased\n\n## 0.0.25 - 2026-11-03\n\n### Added\n\n- New thing.\n\n${older}`,
    )
  })

  test('falls back to the change title when Unreleased is empty', () => {
    const before = `${head}## Unreleased\n\n${older}`
    expect(releaseChangelog(before, '0.0.25', '2026-11-03', 'feat(cli): add x')).toBe(
      `${head}## Unreleased\n\n## 0.0.25 - 2026-11-03\n\n- feat(cli): add x\n\n${older}`,
    )
  })
})
