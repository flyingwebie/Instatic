/**
 * appVersion — the running Instatic release, shown in Settings → General and
 * on the dashboard.
 *
 * Fetched once per session and shared: the version cannot change under a
 * running server (a new release is a new process), so re-fetching it per
 * mount would be pure noise. A failed fetch leaves the value `null` and every
 * consumer renders nothing rather than an error — a missing version line is
 * not worth interrupting anyone over.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { getCmsAbout } from '@core/persistence/cmsAbout'

interface AppVersionState {
  version: string | null
  ensureLoaded: () => void
}

let inFlight: Promise<void> | null = null

const useAppVersionStore = create<AppVersionState>((set) => ({
  version: null,
  ensureLoaded: () => {
    if (inFlight) return
    inFlight = getCmsAbout()
      .then(({ version }) => {
        set({ version })
      })
      .catch((err: unknown) => {
        console.error('[appVersion] failed to read the installation version:', err)
      })
  },
}))

/** The running release, or `null` until it has loaded (or if it failed to). */
export function useAppVersion(): string | null {
  const version = useAppVersionStore((s) => s.version)
  const ensureLoaded = useAppVersionStore((s) => s.ensureLoaded)
  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])
  return version
}
