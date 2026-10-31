/**
 * `@core/media-types` — the media type catalogue and the helpers that read it.
 *
 * Canonical entrypoint: import from `@core/media-types`, never from
 * `@core/media-types/catalog`. Gated by `no-core-barrel-deep-imports.test.ts`.
 */
export {
  MEDIA_TYPE_CATALOG,
  MEDIA_TYPE_GROUP_ORDER,
  MEDIA_TYPE_GROUP_LABELS,
  ALL_MEDIA_MIMES,
  DEFAULT_ALLOWED_MEDIA_MIMES,
  mediaTypeByMime,
  mediaTypeByExtension,
  mediaTypesInGroup,
  mediaMimesInGroup,
  extensionForMime,
  isInlineMediaMime,
  normalizeAllowedMediaMimes,
  uploadAcceptAttribute,
  describeAllowedMediaTypes,
  type MediaMime,
  type MediaTypeDefinition,
  type MediaTypeGroup,
} from './catalog'
