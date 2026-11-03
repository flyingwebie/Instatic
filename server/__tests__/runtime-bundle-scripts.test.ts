import { describe, expect, it } from 'bun:test'
import { DEFAULT_SCRIPT_RUNTIME_CONFIG } from '@core/site-runtime'
import {
  createDefaultSiteExplorerOrganization,
  DEFAULT_SITE_SETTINGS,
} from '@core/page-tree'
import type { Page, SiteDocument } from '@core/page-tree'
import { buildSiteRuntimeScripts, createSiteRuntimeBuildCache } from '../publish/runtime/bundleScripts'

function makeRuntimePage(): Page {
  return {
    id: 'page-1',
    slug: 'index',
    title: 'Index',
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        moduleId: 'base.body',
        props: {},
        children: [],
        breakpointOverrides: {},
        classIds: [],
        locked: false,
        hidden: false,
      },
    },
  }
}

function makeRuntimeSite(page: Page): SiteDocument {
  return {
    id: 'site-1',
    name: 'Runtime Test Site',
    pages: [page],
    visualComponents: [],
    layouts: [],
    breakpoints: [
      { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
    ],
    settings: structuredClone(DEFAULT_SITE_SETTINGS),
    styleRules: {},
    files: [
      {
        id: 'legacy-vendor',
        path: 'assets/js/legacy-vendor.js',
        type: 'script',
        content: 'typeof exports === "object" ? require("jquery") : window.jQuery;',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    explorer: createDefaultSiteExplorerOrganization(),
    packageJson: { dependencies: {}, devDependencies: {} },
    runtime: {
      dependencyLock: { version: 1, packages: {}, updatedAt: 0 },
      styles: {},
      scripts: {
        'legacy-vendor': {
          ...DEFAULT_SCRIPT_RUNTIME_CONFIG,
          format: 'classic',
        },
      },
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('buildSiteRuntimeScripts', () => {
  it('emits classic scripts raw without resolving UMD require branches', async () => {
    const page = makeRuntimePage()
    const site = makeRuntimeSite(page)

    const result = await buildSiteRuntimeScripts({
      site,
      page,
      target: 'publish',
      assetBasePath: '/_instatic/assets/version-1/',
    })

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
    expect(result.files).toHaveLength(1)
    expect(result.files[0].content).toContain('require("jquery")')
    expect(result.runtimeAssets.scripts).toHaveLength(1)
    expect(result.runtimeAssets.scripts[0].format).toBe('classic')
    expect(result.runtimeAssets.scripts[0].src).toContain('/_instatic/assets/version-1/classic/')
  })

  it('minifies module bundles for publish but not for the canvas', async () => {
    const page = makeRuntimePage()
    const site = makeRuntimeSite(page)
    site.files = [{
      id: 'motion',
      path: 'scripts/motion.ts',
      type: 'script',
      content: [
        '// motion setup',
        'const readableName = document.documentElement',
        'readableName.dataset.ready = "yes"',
      ].join('\n'),
      createdAt: 1,
      updatedAt: 1,
    }]
    site.runtime.scripts = { motion: { ...DEFAULT_SCRIPT_RUNTIME_CONFIG } }

    const build = (target: 'publish' | 'canvas') => buildSiteRuntimeScripts({
      site,
      page,
      target,
      assetBasePath: '/_instatic/assets/version-1/',
    })
    const entryContent = (result: Awaited<ReturnType<typeof build>>) =>
      result.files.find((file) => file.path.includes('entries/'))?.content ?? ''

    const published = entryContent(await build('publish'))
    const canvas = entryContent(await build('canvas'))

    expect(published).toContain('dataset.ready="yes"')
    expect(published).not.toContain('readableName')
    expect(published).not.toContain('// motion setup')
    expect(canvas).toContain('readableName')
  })

  describe('shared build cache (one publish)', () => {
    function siteWithModuleChunks(): { site: SiteDocument; pages: Page[] } {
      const first = makeRuntimePage()
      const second = { ...makeRuntimePage(), id: 'page-2', slug: 'about' }
      const site = makeRuntimeSite(first)
      site.pages = [first, second]
      site.files.push(
        { id: 'main', path: 'src/scripts/main.js', type: 'script', content: 'import("./lazy.js").then((m) => m.run())', createdAt: 1, updatedAt: 1 },
        { id: 'lazy', path: 'src/scripts/lazy.js', type: 'script', content: 'export function run() { document.title = "lazy" }', createdAt: 1, updatedAt: 1 },
      )
      site.runtime!.scripts.main = { ...DEFAULT_SCRIPT_RUNTIME_CONFIG }
      site.runtime!.scripts.lazy = { ...DEFAULT_SCRIPT_RUNTIME_CONFIG, enabled: false }
      return { site, pages: [first, second] }
    }

    it('gives every page the same bytes as an unshared build, addressed under its own base path', async () => {
      const { site, pages } = siteWithModuleChunks()
      const cache = createSiteRuntimeBuildCache()
      const shared = await Promise.all(pages.map((page, i) => buildSiteRuntimeScripts({
        site, page, target: 'publish', assetBasePath: `/_instatic/assets/v${i}/`, buildCache: cache,
      })))
      const unshared = await buildSiteRuntimeScripts({
        site, page: pages[1]!, target: 'publish', assetBasePath: '/_instatic/assets/v1/',
      })

      expect(cache.size).toBe(1)
      expect(shared[1]!.files.map((f) => [f.publicPath, f.content])).toEqual(
        unshared.files.map((f) => [f.publicPath, f.content]),
      )
      expect(shared[1]!.runtimeAssets).toEqual(unshared.runtimeAssets)
      // The lazy import is a chunk, so the build really has relative imports.
      expect(shared[0]!.files.some((f) => f.path.startsWith('chunks/'))).toBe(true)
      expect(shared[0]!.files.every((f) => f.publicPath.startsWith('/_instatic/assets/v0/'))).toBe(true)
      expect(shared[0]!.runtimeAssets.scripts.every((s) => s.src.startsWith('/_instatic/assets/v0/'))).toBe(true)
    })

    it('builds separately when pages load different scripts', async () => {
      const { site, pages } = siteWithModuleChunks()
      site.runtime!.scripts.main = {
        ...DEFAULT_SCRIPT_RUNTIME_CONFIG,
        scope: { type: 'pages', pageIds: ['page-1'] },
      }
      const cache = createSiteRuntimeBuildCache()
      const [first, second] = await Promise.all(pages.map((page, i) => buildSiteRuntimeScripts({
        site, page, target: 'publish', assetBasePath: `/_instatic/assets/v${i}/`, buildCache: cache,
      })))
      expect(cache.size).toBe(2)
      expect(first!.runtimeAssets.scripts.map((s) => s.fileId)).toContain('main')
      expect(second!.runtimeAssets.scripts.map((s) => s.fileId)).not.toContain('main')
    })
  })
})
