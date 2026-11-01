/**
 * Installation identity client — `GET /admin/api/cms/about`.
 *
 * One field today (the running release). It lives in its own module rather
 * than riding along on the session or dashboard payloads so the next thing
 * that is true of the installation, not of the user or the site, has an
 * obvious home.
 */
import { Type, type Static } from '@sinclair/typebox'
import { apiRequest, type FetchLike } from '@core/http'

const AboutEnvelope = Type.Object(
  {
    /** Semver from `package.json`, or `'unknown'` if it could not be read. */
    version: Type.String(),
  },
  { additionalProperties: true },
)

export type CmsAbout = Static<typeof AboutEnvelope>

export async function getCmsAbout(opts?: {
  fetchImpl?: FetchLike
  basePath?: string
}): Promise<CmsAbout> {
  return apiRequest(`${opts?.basePath ?? '/admin/api/cms'}/about`, {
    schema: AboutEnvelope,
    fetchImpl: opts?.fetchImpl ?? globalThis.fetch.bind(globalThis),
    fallbackMessage: 'Could not read the installation version',
  })
}
