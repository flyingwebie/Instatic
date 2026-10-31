/**
 * Upload-policy client — which file types this installation accepts.
 *
 *   GET /admin/api/cms/media/upload-policy  (`media.read`)
 *   PUT /admin/api/cms/media/upload-policy  (`media.policy.manage`)
 *
 * Two consumers with different needs share one shape: Settings → Uploads
 * renders a switch per catalogue entry and saves the selection, while the
 * Media workspace only wants `allowedMimes` to build the file picker's
 * `accept` list. The server returns the catalogue alongside the selection so
 * the client never has to decide which of the two it trusts when a newer
 * server knows a type this build does not.
 */
import { Type, type Static } from '@sinclair/typebox'
import { apiRequest, type FetchLike } from '@core/http'

const UploadPolicyEnvelope = Type.Object(
  {
    allowedMimes: Type.Array(Type.String()),
    /** True while the installation is still on the catalogue defaults. */
    isDefault: Type.Boolean(),
    /** Every type this server can verify, in display order. */
    catalogMimes: Type.Array(Type.String()),
    /** What a fresh installation would have enabled. */
    defaultMimes: Type.Array(Type.String()),
  },
  { additionalProperties: true },
)

export type CmsUploadPolicy = Static<typeof UploadPolicyEnvelope>

interface ClientBase {
  fetchImpl?: FetchLike
  basePath?: string
}

function resolveClient(opts: ClientBase | undefined) {
  return {
    fetchImpl: opts?.fetchImpl ?? globalThis.fetch.bind(globalThis),
    basePath: opts?.basePath ?? '/admin/api/cms',
  }
}

export async function getCmsUploadPolicy(opts?: ClientBase): Promise<CmsUploadPolicy> {
  const { fetchImpl, basePath } = resolveClient(opts)
  return apiRequest(`${basePath}/media/upload-policy`, {
    schema: UploadPolicyEnvelope,
    fetchImpl,
    fallbackMessage: 'Could not load the upload policy',
  })
}

export async function setCmsUploadPolicy(
  allowedMimes: readonly string[],
  opts?: ClientBase,
): Promise<CmsUploadPolicy> {
  const { fetchImpl, basePath } = resolveClient(opts)
  return apiRequest(`${basePath}/media/upload-policy`, {
    method: 'PUT',
    body: { allowedMimes },
    schema: UploadPolicyEnvelope,
    fetchImpl,
    fallbackMessage: 'Could not save the upload policy',
  })
}
