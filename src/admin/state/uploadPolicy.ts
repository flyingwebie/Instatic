/**
 * uploadPolicy — the installation's allowed upload types, shared by the two
 * surfaces that care: Settings → Uploads (which edits it) and the Media
 * workspace (which turns it into the file picker's `accept` list).
 *
 * A store rather than a per-component fetch so saving in Settings updates an
 * already-open Media page in the same tab — otherwise the picker would keep
 * filtering out a type the admin had just enabled, and the only way to notice
 * would be a reload.
 *
 * Kept next to `adminUi` and deliberately outside the editor store: the Media
 * workspace must not pull the editor's chunk in to learn which extensions it
 * may offer.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import {
  getCmsUploadPolicy,
  setCmsUploadPolicy,
  type CmsUploadPolicy,
} from '@core/persistence/cmsMediaUploadPolicy'
import { getErrorMessage } from '@core/utils/errorMessage'
import { DEFAULT_ALLOWED_MEDIA_MIMES, uploadAcceptAttribute } from '@core/media-types'

type PolicyStatus = 'idle' | 'loading' | 'ready' | 'error'

interface UploadPolicyState {
  policy: CmsUploadPolicy | null
  status: PolicyStatus
  error: string | null
  /** Fetch once per session; concurrent callers share the in-flight request. */
  ensureLoaded: () => void
  /** Persist a new selection. Throws on failure so the caller can toast it. */
  save: (allowedMimes: readonly string[]) => Promise<void>
}

let inFlight: Promise<void> | null = null

export const useUploadPolicy = create<UploadPolicyState>((set) => ({
  policy: null,
  status: 'idle',
  error: null,

  ensureLoaded: () => {
    if (inFlight) return
    set({ status: 'loading', error: null })
    inFlight = getCmsUploadPolicy()
      .then((policy) => {
        set({ policy, status: 'ready', error: null })
      })
      .catch((err: unknown) => {
        console.error('[uploadPolicy] failed to load the upload policy:', err)
        set({ status: 'error', error: getErrorMessage(err, 'Unknown upload policy error') })
      })
      .finally(() => {
        // Clear the guard either way: a failed load should be retryable by
        // the next mount rather than sticking for the rest of the session.
        inFlight = null
      })
  },

  save: async (allowedMimes) => {
    const policy = await setCmsUploadPolicy(allowedMimes)
    set({ policy, status: 'ready', error: null })
  },
}))

/**
 * MIMEs the server will currently accept, fetching them on first use.
 *
 * Before the policy has loaded this answers with the catalogue defaults
 * rather than an empty list: an `accept` attribute built from nothing would
 * grey out every file in the picker, which reads as "uploads are broken".
 * Guessing slightly wide is harmless — the server re-checks the bytes, and a
 * file the policy excludes is rejected with a message naming what IS allowed.
 */
export function useAllowedUploadMimes(): readonly string[] {
  const policy = useUploadPolicy((s) => s.policy)
  const ensureLoaded = useUploadPolicy((s) => s.ensureLoaded)
  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])
  return policy?.allowedMimes ?? DEFAULT_ALLOWED_MEDIA_MIMES
}

/** `accept` attribute for a media-library file input. */
export function useUploadAccept(): string {
  return uploadAcceptAttribute(useAllowedUploadMimes())
}
