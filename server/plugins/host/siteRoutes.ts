import type { ServerRuntime } from '../../serverRuntime'
import { hostPlugins } from './registry'
import { runRouteInWorker } from './rpc'

const RESERVED_SITE_PATH =
  /^\/(?:admin|uploads|_instatic|health|\.well-known)(?:\/|$)/

export function validateSiteRoutePattern(path: string): void {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.length > 2048 ||
    /[?#\\]/.test(path) ||
    [...path].some((char) => char.charCodeAt(0) <= 32)
  ) {
    throw new Error(
      'Site route must be a normalized site-relative path without query, fragment, or control characters.',
    )
  }
  const decoded = decodeURIComponent(path)
  if (
    RESERVED_SITE_PATH.test(decoded) ||
    decoded.startsWith('//') ||
    /[?#\\]/.test(decoded) ||
    [...decoded].some((char) => char.charCodeAt(0) <= 32) ||
    decoded.split('/').some((segment) => segment === '.' || segment === '..')
  )
    throw new Error(
      'Site route conflicts with a reserved host namespace or contains traversal.',
    )
  const wildcard = path.indexOf('*')
  if (wildcard !== -1 && wildcard !== path.length - 1)
    throw new Error('Site routes support only a trailing wildcard.')
}

export function siteRouteMatches(pattern: string, path: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return false
  }
  if (
    RESERVED_SITE_PATH.test(decoded) ||
    decoded.startsWith('//') ||
    decoded.includes('\\')
  )
    return false
  return pattern.endsWith('*')
    ? path.startsWith(pattern.slice(0, -1))
    : path === pattern
}

/** Called after public page resolution, so a plugin never shadows published content. */
export async function tryServePluginSiteRoute(
  req: Request,
  _runtime: ServerRuntime,
  url: URL,
): Promise<Response | null> {
  if (req.method !== 'GET') return null
  const candidates = [...hostPlugins.values()]
    .flatMap((entry) =>
      [...entry.routes.entries()]
        .filter(
          ([key, route]) =>
            key.startsWith('SITE:GET:') &&
            siteRouteMatches(route.path, url.pathname),
        )
        .map(([, route]) => route),
    )
    .sort(
      (a, b) =>
        Number(a.path.endsWith('*')) - Number(b.path.endsWith('*')) ||
        b.path.length - a.path.length,
    )
  for (const route of candidates) {
    const response = await runRouteInWorker({
      pluginId: route.pluginId,
      method: 'GET',
      path: route.path,
      scope: 'site',
      request: req,
      user: null,
    })
    if (response.status !== 404) return response
  }
  return null
}
