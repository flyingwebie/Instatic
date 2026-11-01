/**
 * UploadsSection — choose which file types the media library accepts.
 *
 * The switches write the installation-wide upload policy, not a site setting:
 * media assets are shared across branches, so this has to be one answer per
 * installation. Every type shown here is one the server can verify from the
 * file's own bytes; there is no "allow anything" escape hatch, because the
 * upload pipeline has no way to write a file it cannot identify.
 *
 * Each toggle saves immediately. There is no Save button because there is
 * nothing to review — one switch is one independent fact, and a failed write
 * reverts the switch and toasts, so the control never shows a state the
 * server did not accept.
 */
import { useEffect, useState } from 'react'
import { Switch } from '@ui/components/Switch'
import { Button } from '@ui/components/Button'
import { SkeletonBlock } from '@ui/components/Skeleton'
import { pushToast } from '@ui/components/Toast'
import { getErrorMessage } from '@core/utils/errorMessage'
import {
  MEDIA_TYPE_GROUP_LABELS,
  MEDIA_TYPE_GROUP_ORDER,
  mediaTypeByMime,
  mediaTypesInGroup,
  type MediaTypeGroup,
} from '@core/media-types'
import { hasCapability } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { useUploadPolicy } from '@admin/state/uploadPolicy'
import s from '../SettingsModal.module.css'

/** Prose explaining what a group is for, shown under its heading. */
const GROUP_DESCRIPTIONS: Record<MediaTypeGroup, string> = {
  image: 'Used by image blocks, favicons and thumbnails. Responsive variants are generated for the raster formats.',
  video: 'Played inline by video blocks.',
  audio: 'Played inline by audio players and plugin blocks.',
  font: 'Referenced from @font-face rules in imported stylesheets.',
  document: 'Stored for download only. Documents are always served as a file download, never rendered in the browser on the admin origin.',
  archive: 'Stored for download only. Nothing inside an archive is inspected, so only enable this if you trust everyone who can upload.',
}

export function UploadsSection() {
  const currentUser = useCurrentAdminUser()
  const canManage = hasCapability(currentUser, 'media.policy.manage')

  const policy = useUploadPolicy((state) => state.policy)
  const status = useUploadPolicy((state) => state.status)
  const loadError = useUploadPolicy((state) => state.error)
  const ensureLoaded = useUploadPolicy((state) => state.ensureLoaded)
  const save = useUploadPolicy((state) => state.save)

  // `saving` blocks a second write while one is in flight: two switches
  // flipped in quick succession would otherwise race, and the slower
  // response would clobber the faster one's selection.
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])

  if (status === 'error') {
    return <p className={s.sectionDescription} role="alert">{loadError}</p>
  }

  if (!policy) {
    return <SkeletonBlock minHeight={240} ariaLabel="Loading upload settings" />
  }

  const enabled = new Set(policy.allowedMimes)

  const applySelection = async (next: string[], failureTitle: string) => {
    setSaving(true)
    try {
      await save(next)
    } catch (err) {
      console.error('[UploadsSection] failed to save the upload policy:', err)
      pushToast({
        kind: 'error',
        title: failureTitle,
        body: getErrorMessage(err, 'Unknown upload policy error'),
      })
    } finally {
      setSaving(false)
    }
  }

  const toggle = (mime: string, on: boolean) => {
    const next = on
      ? [...policy.allowedMimes, mime]
      : policy.allowedMimes.filter((m) => m !== mime)
    void applySelection(next, on ? 'Could not allow this file type' : 'Could not block this file type')
  }

  // The server returns the catalogue it knows, so a client running against a
  // different build renders exactly the types that build can verify rather
  // than a list baked in at compile time.
  const catalogue = policy.catalogMimes
  const isDefaultSelection =
    policy.defaultMimes.length === policy.allowedMimes.length &&
    policy.defaultMimes.every((m) => enabled.has(m))

  return (
    <div>
      <p className={s.sectionDescription}>
        Which file types this installation accepts in the media library. Every type is verified
        from the file&rsquo;s own content on upload — renaming a file does not get it past this.
      </p>

      {!canManage && (
        <p className={s.sectionDescription} role="status">
          You can see the current policy but not change it. Changing it needs the
          &ldquo;Choose allowed upload types&rdquo; permission.
        </p>
      )}

      {MEDIA_TYPE_GROUP_ORDER.map((group) => {
        const types = mediaTypesInGroup(group).filter((def) => catalogue.includes(def.mime))
        if (types.length === 0) return null
        const headingId = `uploads-${group}-heading`
        return (
          <section key={group} aria-labelledby={headingId} className={s.sectionBlock}>
            <h4 id={headingId} className={s.subHeading}>
              {MEDIA_TYPE_GROUP_LABELS[group]}
            </h4>
            <p className={s.preferenceCategoryDesc}>{GROUP_DESCRIPTIONS[group]}</p>

            <div className={s.cardGroup}>
              {types.map((def) => {
                const switchId = `uploads-type-${def.extension.slice(1)}`
                return (
                  <div key={def.mime} className={s.toggleRow}>
                    <div className={s.toggleRowContent}>
                      <label htmlFor={switchId} className={s.toggleRowLabel}>
                        {def.label}
                      </label>
                      <p className={s.toggleRowDesc}>
                        <code>{def.extension}</code> · {def.mime}
                      </p>
                    </div>
                    <Switch
                      id={switchId}
                      checked={enabled.has(def.mime)}
                      disabled={!canManage || saving}
                      onCheckedChange={(value) => toggle(def.mime, value)}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {canManage && (
        <section aria-labelledby="uploads-reset-heading" className={s.sectionBlock}>
          <h4 id="uploads-reset-heading" className={s.subHeading}>
            Defaults
          </h4>
          <p className={s.preferenceCategoryDesc}>
            Images, video, web fonts and documents on; audio and archives off.
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={saving || isDefaultSelection}
            onClick={() =>
              void applySelection([...policy.defaultMimes], 'Could not restore the default file types')
            }
          >
            {isDefaultSelection ? 'Already using defaults' : 'Restore defaults'}
          </Button>
        </section>
      )}

      {/* An empty allow-list is a legitimate choice, but a silent one: the
          media library's Upload button stays put and every file is refused.
          Say so here rather than letting the user discover it by failing. */}
      {policy.allowedMimes.length === 0 && (
        <p className={s.sectionDescription} role="alert">
          No file types are enabled, so every upload will be refused.
        </p>
      )}

      {/* Guard against a catalogue entry the server knows but this build does
          not — the switch list above is driven by the server's list, so an
          unrecognised MIME would otherwise vanish without explanation. */}
      {catalogue.some((mime) => mediaTypeByMime(mime) === null) && (
        <p className={s.sectionDescription} role="status">
          This server accepts file types that this admin build does not recognise. Reload the
          page after updating to see them.
        </p>
      )}
    </div>
  )
}
