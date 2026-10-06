/**
 * Template plugin — server entrypoint.
 *
 * Lifecycle hooks (install / activate / deactivate / uninstall) let the
 * plugin set up routes, subscribe to CMS events, and run migrations.
 *
 * Requires: cms.routes and cms.publication.read.
 */

export function install(api) {
  api.plugin.log('Template plugin installed')
}

export function activate(api) {
  api.plugin.log('Template plugin activated')

  // Register a simple status route at:
  //   GET /admin/api/cms/plugins/acme.template/runtime/status
  // Requires the cms.routes permission.
  api.cms.routes.get('/status', 'plugins.read', async () => ({
    ok: true,
    plugin: api.plugin.id,
    version: api.plugin.version,
    publishedRoutes: (await api.cms.publication.list({ limit: 1 })).totalCount,
  }))
}

export function deactivate(api) {
  api.plugin.log('Template plugin deactivated')
}

export function uninstall(api) {
  api.plugin.log('Template plugin uninstalled')
}
