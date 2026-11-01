/**
 * Installation identity.
 *
 *   GET /admin/api/cms/about — `{ version }`, the running Instatic release.
 *
 * Its own route group rather than a field on `/me` or the dashboard stats:
 * both the dashboard and Settings → General show it, neither owns it, and
 * bolting it onto a user- or stats-shaped payload would make it a stowaway
 * that the next consumer has to go looking for.
 *
 * Gated on authentication only, not on a capability. The version is not a
 * secret — the published site's generator meta already carries it — and
 * every signed-in user sees the About panel.
 */
import type { DbClient } from '../../db/client'
import { requireAuthenticatedUser } from '../../auth/authz'
import { jsonResponse, methodNotAllowed } from '../../http'
import { APP_VERSION } from '../../appVersion'
import { CMS_API_PREFIX } from './shared'

export async function handleAboutRoutes(req: Request, db: DbClient): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== `${CMS_API_PREFIX}/about`) return null
  if (req.method !== 'GET') return methodNotAllowed()

  const user = await requireAuthenticatedUser(req, db)
  if (user instanceof Response) return user

  return jsonResponse({ version: APP_VERSION })
}
