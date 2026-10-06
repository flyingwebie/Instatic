/**
 * Route registration handler — implements the `cms.routes.register` api-call.
 *
 * Validates the tagged `access` discriminator and upserts the route entry
 * into the plugin's host-side route map. Gated by the `cms.routes`
 * permission. Public-access routes additionally require the plugin to hold
 * `cms.routes.public` so the install-time consent dialog can flag the
 * plugin to the operator before they approve it.
 */

import { isCoreCapability } from '../../../auth/capabilities'
import type { ApiCallFor } from '../../protocol/apiCallSchema'
import type { DbClient } from '../../../db/client'
import { assertHostPluginPermission } from '../registry'
import { replyApiOk } from '../apiReplies'
import type { HostPluginRecord, HostRouteAccess } from '../types'
import { hostPlugins } from '../registry'
import { validateSiteRoutePattern } from '../siteRoutes'

export async function handleRoutesRegister(
  msg: ApiCallFor<'cms.routes.register'>,
  entry: HostPluginRecord,
  _db: DbClient,
): Promise<void> {
  // Base `cms.routes` permission is enforced centrally in apiDispatch.ts (via
  // TARGET_PERMISSIONS). Only the conditional `cms.routes.public` grant for
  // anonymous-callable routes stays here — it can't live in a static map.
  const [arg] = msg.args
  if (arg.scope === 'site') {
    assertHostPluginPermission(entry, 'cms.routes.site')
    assertHostPluginPermission(entry, 'cms.routes.public')
    if (arg.method !== 'GET' || arg.access.kind !== 'public') throw new Error('Site routes must be anonymous GET routes.')
    validateSiteRoutePattern(arg.path)
    for (const other of hostPlugins.values()) {
      if (other.manifest.id !== entry.manifest.id && other.routes.has(arg.routeKey)) throw new Error(`Site route ${arg.path} is already registered by another plugin.`)
    }
  }

  let access: HostRouteAccess
  switch (arg.access.kind) {
    case 'capability':
      if (!isCoreCapability(arg.access.capability)) {
        throw new Error(`Unknown plugin route capability: ${arg.access.capability}`)
      }
      access = { kind: 'capability', capability: arg.access.capability }
      break
    case 'authenticated':
      access = { kind: 'authenticated' }
      break
    case 'public':
      // Public-access routes require an additional permission so the
      // install consent flow surfaces "this plugin will register
      // anonymously-callable endpoints" to the operator. Without this,
      // a stolen permission grant could quietly mint a webhook the
      // plugin author never disclosed in the install dialog.
      assertHostPluginPermission(entry, 'cms.routes.public')
      access = { kind: 'public' }
      break
  }

  entry.routes.set(arg.routeKey, {
    pluginId: msg.pluginId,
    method: arg.method,
    path: arg.path,
    access,
    routeKey: arg.routeKey,
  })
  replyApiOk(msg.pluginId, msg.correlationId)
}
