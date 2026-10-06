/**
 * TypeBox schemas for `cms.routes.register` api-call arguments.
 *
 * Access kinds (was `capability: string | null`, see A3 in the
 * capabilities review):
 *
 *   { kind: 'capability', capability: 'content.manage' }
 *       Standard gate — caller needs the named core capability.
 *
 *   { kind: 'authenticated' }
 *       Any logged-in admin user. Reaching this route does NOT require
 *       a specific capability, but DOES require a valid session cookie.
 *
 *   { kind: 'public' }
 *       Anonymous-callable. NO authentication is enforced. The plugin
 *       must declare `permissions: ['cms.routes.public']` in its
 *       manifest so the install-time consent dialog flags the plugin
 *       as exposing public endpoints.
 *
 * The previous `capability: null` shape was ambiguous — it looked like
 * "logged-in user is enough" but actually meant "no auth at all". The
 * tagged union forces plugin authors to make the intent explicit at
 * registration time.
 */

import { Type } from '@sinclair/typebox'

const RouteMethodSchema = Type.Union([
  Type.Literal('GET'),
  Type.Literal('POST'),
  Type.Literal('PATCH'),
  Type.Literal('DELETE'),
])

const RouteAccessSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('capability'),
      capability: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('authenticated'),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('public'),
    },
    { additionalProperties: false },
  ),
])

export const RouteRegistrationArgSchema = Type.Object(
  {
    method: RouteMethodSchema,
    scope: Type.Optional(Type.Union([Type.Literal('runtime'), Type.Literal('site')])),
    path: Type.String({ minLength: 1 }),
    access: RouteAccessSchema,
    routeKey: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)
