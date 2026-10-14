/**
 * User-authored stylesheets collector.
 *
 * The Site panel's "Styles" section lets authors create CSS files that live in
 * `site.files` with `type: 'style'`. Each stylesheet carries a
 * `SiteStyleRuntimeConfig` (in `site.runtime.styles[fileId]`) controlling
 * whether it is enabled, which pages/templates it targets, and its cascade
 * priority. This helper resolves that config for a given page and concatenates
 * the applicable stylesheets in cascade order so it can drop straight into:
 *
 *  - the published page's `userStyles` CSS bundle (`siteCssBundle.ts`)
 *  - the editor canvas's user-CSS `<style>` tag (`UserStylesheetInjector.tsx`)
 *
 * Both consumers need the *same* concatenated string for a given page so what
 * authors see in the canvas matches what their visitors get on the live site.
 *
 * Order is by `priority` (ascending), then `path` (ASCII, ascending) for ties —
 * see `collectAppliedStyles`. Authors can reason about the cascade from the
 * priority field plus the filename alone.
 *
 * `page` is optional: when omitted (authoring/export contexts that want every
 * enabled stylesheet regardless of targeting) all enabled stylesheets are
 * included in priority/path order. When provided, only the stylesheets whose
 * scope targets that page are included.
 */

import type { Page, SiteDocument } from '@core/page-tree'
import {
  DEFAULT_STYLE_RUNTIME_CONFIG,
  collectAppliedStyles,
  normalizeSiteRuntimeConfig,
} from '@core/site-runtime'

export function collectUserStylesheetCss(site: SiteDocument, page?: Page): string {
  // Guard against fixtures / partial sites that don't supply `files`. The
  // SiteDocument schema declares `files: SiteFile[]`, but legacy test fixtures
  // and some import paths construct sites without it. Treat absent as empty
  // — same observable behaviour as "no user stylesheets defined".
  if (!Array.isArray(site.files)) return ''

  const runtime = normalizeSiteRuntimeConfig(site.runtime)

  const ordered = page
    ? collectAppliedStyles({ files: site.files, runtime, page })
    : site.files
        .filter((file) => file.type === 'style' && typeof file.content === 'string' && file.content.length > 0)
        .map((file) => ({ file, config: runtime.styles[file.id] ?? DEFAULT_STYLE_RUNTIME_CONFIG }))
        .filter(({ config }) => config.enabled)
        .sort((a, b) => {
          const priority = a.config.priority - b.config.priority
          return priority || a.file.path.localeCompare(b.file.path)
        })

  if (ordered.length === 0) return ''

  // Comment-wrap each file body with its source path so DevTools / `view-source`
  // makes the origin obvious. The wrapper is ~80 bytes of fixed overhead per
  // file — trivial relative to a typical user stylesheet.
  //
  // `/*!` rather than `/*`: the published bundle is minified (`minifyCss`),
  // which strips ordinary comments. These markers are worth MORE on a live
  // minified page than in the canvas — without them nothing says which of the
  // author's files a rule came from.
  return ordered
    .map(({ file }) => `/*! ${escapeCommentPath(file.path)} */\n${file.content ?? ''}`)
    .join('\n\n')
}

/**
 * Sanitise a path so it cannot close the surrounding CSS comment block.
 * The only sequence that would break out is the asterisk-slash pair itself
 * — replace any accidental occurrences with `*\/` (visually identical, but
 * no longer a comment terminator). All other characters are safe inside a
 * CSS comment.
 */
function escapeCommentPath(path: string): string {
  return path.replace(/\*\//g, '*\\/')
}
