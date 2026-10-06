import { Type, type Static } from '@sinclair/typebox'

export const PublishedRouteSchema = Type.Object({
  path: Type.String(),
  id: Type.String(),
  kind: Type.Union([Type.Literal('page'), Type.Literal('entry')]),
  tableSlug: Type.String(),
  title: Type.String(),
  publishedAt: Type.String(),
  firstPublishedAt: Type.String(),
  revision: Type.String(),
})
export type PublishedRoute = Static<typeof PublishedRouteSchema>

export const PublicationListOptionsSchema = Type.Object(
  {
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    revision: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)
export type PublicationListOptions = Static<typeof PublicationListOptionsSchema>

export const PublicationListResultSchema = Type.Object({
  version: Type.Integer({ minimum: 0 }),
  revision: Type.String(),
  totalCount: Type.Integer({ minimum: 0 }),
  routes: Type.Array(PublishedRouteSchema),
})
export type PublicationListResult = Static<typeof PublicationListResultSchema>

export const PublicationRenderOptionsSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 2048 }),
    origin: Type.String({ minLength: 1, maxLength: 2048 }),
    revision: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)
export type PublicationRenderOptions = Static<
  typeof PublicationRenderOptionsSchema
>

export const PublishedDocumentSchema = Type.Object({
  route: PublishedRouteSchema,
  html: Type.String(),
  siteId: Type.String(),
  siteName: Type.String(),
  language: Type.String(),
  revision: Type.String(),
  version: Type.Integer({ minimum: 0 }),
})
export type PublishedDocument = Static<typeof PublishedDocumentSchema>

export const PublicationOriginOptionsSchema = Type.Object(
  {
    origin: Type.String({ minLength: 1, maxLength: 2048 }),
  },
  { additionalProperties: false },
)
export type PublicationOriginOptions = Static<
  typeof PublicationOriginOptionsSchema
>

export const PublicationRefreshOptionsSchema = Type.Object(
  {
    paths: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
      maxItems: 200,
    }),
    origin: Type.String({ minLength: 1, maxLength: 2048 }),
    revision: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)
export type PublicationRefreshOptions = Static<
  typeof PublicationRefreshOptionsSchema
>
