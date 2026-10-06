import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '../helpers/createTestDb'
import { makeNode, makePage, makeSite } from '../fixtures'
import {
  persistSitePublish,
  getPublishedPageBySlug,
} from '../../../server/repositories/publish'
import {
  listPluginPublishedRoutes,
  renderPluginPublishedDocument,
} from '../../../server/publish/pluginPublication'
import {
  bumpPublishVersion,
  getPublishVersion,
} from '../../../server/publish/publishState'
import {
  getOrRender,
  invalidateRenderCache,
  peek,
} from '../../../server/publish/renderCache'
import { refreshPublishedHtml } from '../../../server/publish/refreshPublished'
import {
  readArtefact,
  getActiveSlot,
  swapSlot,
} from '../../../server/publish/staticArtefact'
import { hookBus } from '../../../src/core/plugins/hookBus'
import {
  siteRouteMatches,
  validateSiteRoutePattern,
} from '../../../server/plugins/host/siteRoutes'
import { parseApiCall } from '../../../server/plugins/protocol/parser'

describe('Permissioned publication interface', () => {
  test('real snapshots resolve Unicode routes, keep draft slugs/content private, refresh HTML and retract', async () => {
    const { db, cleanup } = await createTestDb()
    const uploads = await mkdtemp(join(tmpdir(), 'plugin-publication-'))
    const user = crypto.randomUUID()
    const pages = [
      makePage({ id: 'home', slug: 'index' }),
      makePage({
        id: 'guide',
        slug: 'guides/café',
        title: 'Published café',
        nodes: {
          root: makeNode({
            id: 'root',
            moduleId: 'base.body',
            children: ['text'],
          }),
          text: makeNode({
            id: 'text',
            moduleId: 'base.text',
            props: { text: 'PUBLIC CONTENT', tag: 'h1' },
            dynamicBindings: { text: { source: 'route', field: 'path' } },
          }),
        },
      }),
    ]
    pages.push(
      makePage({
        id: 'article-template',
        slug: 'article-template',
        title: 'Article template',
        template: {
          enabled: true,
          target: { kind: 'postTypes', tableSlugs: ['posts'] },
          priority: 100,
        },
        nodes: {
          root: makeNode({
            id: 'root',
            moduleId: 'base.body',
            children: ['heading'],
          }),
          heading: makeNode({
            id: 'heading',
            moduleId: 'base.text',
            props: { text: 'Fallback', tag: 'h1' },
            dynamicBindings: {
              text: { source: 'currentEntry', field: 'title' },
            },
          }),
        },
      }),
    )
    try {
      await db.unsafe(
        'insert into users (id,email,email_normalized,display_name,password_hash,role_id) values ($1,$2,$3,$4,$5,$6)',
        [
          user,
          'test@example.invalid',
          'test@example.invalid',
          'Local publisher',
          'unusable',
          'member',
        ],
      )
      for (const page of pages)
        await db.unsafe(
          'insert into data_rows (id,table_id,slug,status,cells_json) values ($1,$2,$3,$4,$5)',
          [page.id, 'pages', page.slug, 'draft', { title: page.title }],
        )
      await persistSitePublish(db, {
        siteSnapshotId: crypto.randomUUID(),
        site: makeSite({ pages }),
        serializedImportmap: null,
        pages: pages.map((page) => ({
          pageId: page.id,
          title: page.title,
          slug: page.slug,
          versionId: crypto.randomUUID(),
          versionNumber: 1,
          runtimeAssets: null,
          runtimeFiles: [],
        })),
        publishedByUserId: user,
      })
      await db.unsafe(
        'insert into data_rows (id,table_id,slug,status,cells_json) values ($1,$2,$3,$4,$5)',
        [
          'article',
          'posts',
          'draft-article',
          'published',
          { title: 'PRIVATE DRAFT ARTICLE' },
        ],
      )
      const articleVersion = crypto.randomUUID()
      await db.unsafe(
        'insert into data_row_versions (id,row_id,version_number,cells_json,slug,published_by_user_id) values ($1,$2,$3,$4,$5,$6)',
        [
          articleVersion,
          'article',
          1,
          { title: 'Published article' },
          'public-article',
          user,
        ],
      )
      await db.unsafe(
        'update data_rows set active_version_id = $1 where id = $2',
        [articleVersion, 'article'],
      )
      await db.unsafe(
        'insert into data_tables (id,slug,name,kind,route_base,fields_json,singular_label,plural_label) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          'untargeted',
          'untargeted',
          'Unmapped entries',
          'postType',
          '/untargeted',
          [],
          'Entry',
          'Entries',
        ],
      )
      await db.unsafe(
        'insert into data_rows (id,table_id,slug,status,cells_json) values ($1,$2,$3,$4,$5)',
        [
          'untargeted-entry',
          'untargeted',
          'item',
          'published',
          { title: 'NO PUBLIC TEMPLATE' },
        ],
      )
      const untargetedVersion = crypto.randomUUID()
      await db.unsafe(
        'insert into data_row_versions (id,row_id,version_number,cells_json,slug,published_by_user_id) values ($1,$2,$3,$4,$5,$6)',
        [
          untargetedVersion,
          'untargeted-entry',
          1,
          { title: 'NO PUBLIC TEMPLATE' },
          'item',
          user,
        ],
      )
      await db.unsafe(
        'update data_rows set active_version_id = $1 where id = $2',
        [untargetedVersion, 'untargeted-entry'],
      )
      bumpPublishVersion()
      const inventory = await listPluginPublishedRoutes(db, { limit: 1 })
      expect(inventory.totalCount).toBe(3)
      expect(
        await renderPluginPublishedDocument(db, {
          path: '/untargeted/item',
          origin: 'https://example.com',
        }),
      ).toBeNull()
      expect(inventory.routes[0]?.path).toBe('/')
      const second = await listPluginPublishedRoutes(db, {
        offset: 1,
        limit: 1,
        revision: inventory.revision,
      })
      expect(second.routes[0]?.path).toBe('/guides/caf%C3%A9')
      const article = await renderPluginPublishedDocument(db, {
        path: '/posts/public-article',
        origin: 'https://example.com',
        revision: inventory.revision,
      })
      expect(article?.route.kind).toBe('entry')
      expect(article?.html).toContain('Published article')
      expect(article?.html).not.toContain('PRIVATE DRAFT ARTICLE')
      expect(
        (await listPluginPublishedRoutes(db)).routes.map((route) => route.path),
      ).not.toContain('/article-template')
      const rendered = await renderPluginPublishedDocument(db, {
        path: '/guides/caf%C3%A9',
        origin: 'https://example.com',
        revision: inventory.revision,
      })
      expect(rendered?.html).toContain('/guides/caf%C3%A9')
      expect(rendered?.route.firstPublishedAt).toBeTruthy()
      await db.unsafe(
        'update data_rows set slug = $1, cells_json = $2 where id = $3',
        [
          'private-draft-slug',
          { title: 'PRIVATE DRAFT', body: 'DRAFT SECRET' },
          'guide',
        ],
      )
      expect(await getPublishedPageBySlug(db, 'private-draft-slug')).toBeNull()
      expect(await getPublishedPageBySlug(db, 'guides/café')).not.toBeNull()
      expect(
        (
          await renderPluginPublishedDocument(db, {
            path: '/guides/caf%C3%A9',
            origin: 'https://example.com',
          })
        )?.html,
      ).not.toContain('DRAFT SECRET')
      hookBus.filter('test.publication', 'publish.html', (html) =>
        String(html).replace(
          '</head>',
          '<meta name="refreshed" content="yes"></head>',
        ),
      )
      await swapSlot(uploads, await getActiveSlot(uploads))
      const contentVersion = getPublishVersion()
      await refreshPublishedHtml(db, uploads, {
        paths: ['/guides/caf%C3%A9'],
        origin: 'https://example.com',
        revision: inventory.revision,
      })
      await refreshPublishedHtml(db, uploads, {
        paths: ['/'],
        origin: 'https://example.com',
      })
      expect(getPublishVersion()).toBe(contentVersion)
      expect(await readArtefact(uploads, '/guides/caf%C3%A9')).toContain(
        '/guides/caf%C3%A9',
      )
      await expect(
        refreshPublishedHtml(db, uploads, {
          paths: ['/'],
          origin: 'https://example.com/path',
        }),
      ).rejects.toThrow('origin')
      await expect(
        refreshPublishedHtml(db, uploads, {
          paths: ['/draft-only'],
          origin: 'https://example.com',
        }),
      ).rejects.toThrow('published')
      expect(await readArtefact(uploads, '/guides/caf%C3%A9')).toContain(
        'name="refreshed"',
      )
      expect(
        (
          await renderPluginPublishedDocument(db, {
            path: '/guides/caf%C3%A9',
            origin: 'https://example.com',
          })
        )?.html,
      ).not.toContain('name="refreshed"')
      await db.unsafe('update data_rows set status = $1 where id = $2', [
        'unpublished',
        'guide',
      ])
      bumpPublishVersion()
      expect((await listPluginPublishedRoutes(db)).routes).toHaveLength(2)
      expect(
        await renderPluginPublishedDocument(db, {
          path: '/guides/caf%C3%A9',
          origin: 'https://example.com',
        }),
      ).toBeNull()
      await expect(
        listPluginPublishedRoutes(db, { revision: inventory.revision }),
      ).rejects.toThrow('revision')
      await expect(
        renderPluginPublishedDocument(db, {
          path: '/',
          origin: 'https://example.com/path',
        }),
      ).rejects.toThrow('origin')
    } finally {
      hookBus.unregisterPlugin('test.publication')
      await rm(uploads, { recursive: true, force: true })
      await cleanup()
    }
  })
  test('site route registration excludes protected and malformed paths', () => {
    for (const path of [
      '/admin/*',
      '/%61dmin/*',
      '/uploads/test',
      '/_instatic/mcp',
      '/.well-known/*',
      '/x/../*',
      '//evil',
      '/x%00',
      '/x/*/y',
    ])
      expect(() => validateSiteRoutePattern(path)).toThrow()
    validateSiteRoutePattern('/*')
    expect(siteRouteMatches('/*', '/sitemap.xml')).toBe(true)
    expect(siteRouteMatches('/*', '/admin/plugins')).toBe(false)
    expect(siteRouteMatches('/*', '/%GG')).toBe(false)
    expect(() =>
      parseApiCall({
        kind: 'api-call',
        correlationId: 'r',
        pluginId: 'acme.test',
        target: 'cms.routes.register',
        args: [
          {
            method: 'GET',
            path: '/sitemap.xml',
            scope: 'site',
            access: { kind: 'public' },
            routeKey: 'GET:/sitemap.xml',
          },
        ],
      }),
    ).toThrow('routeKey')
    expect(() =>
      parseApiCall({
        kind: 'api-call',
        correlationId: 'r',
        pluginId: 'acme.test',
        target: 'cms.publication.list',
        args: [{ limit: 201 }],
      }),
    ).toThrow()
  })
  test('filter cache invalidation rejects stale in-flight cache writes without changing hole versions', async () => {
    invalidateRenderCache()
    const key = { urlPath: '/test-metadata-epoch', queryString: '' }
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const stale = getOrRender(key, async () => {
      await gate
      return { body: 'OLD', status: 200, headers: {} }
    })
    invalidateRenderCache()
    await getOrRender(key, async () => ({
      body: 'NEW',
      status: 200,
      headers: {},
    }))
    release()
    await stale
    expect(peek(key)?.body).toBe('NEW')
  })
})
