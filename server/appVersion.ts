/**
 * The running Instatic release, read from `package.json` once per process.
 *
 * `package.json` is the single place a version number is written (the release
 * script bumps it and tags from it), so the server reads it back rather than
 * carrying a generated constant that could disagree with the tag. The Docker
 * runtime image copies `package.json` next to `server/`, so the same relative
 * path resolves in development, in the release bundle, and in the container.
 *
 * A read failure is not fatal: a missing or malformed manifest downgrades the
 * About panel to "unknown", which is strictly better than refusing to boot
 * over a cosmetic field.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseJsonWithFallback } from '@core/utils/jsonValidate'
import { Type } from '@core/utils/typeboxHelpers'

const ManifestSchema = Type.Object({
  version: Type.String(),
})

/** Shown when `package.json` could not be read or had no usable version. */
export const UNKNOWN_APP_VERSION = 'unknown'

function readAppVersion(): string {
  try {
    const raw = readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')
    const manifest = parseJsonWithFallback(raw, ManifestSchema, { version: UNKNOWN_APP_VERSION })
    return manifest.version || UNKNOWN_APP_VERSION
  } catch (err) {
    console.error('[appVersion] could not read package.json:', err)
    return UNKNOWN_APP_VERSION
  }
}

export const APP_VERSION = readAppVersion()
