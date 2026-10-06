import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { parsePluginManifest } from '@core/plugins/manifest'
import type { DbClient } from '../../db/client'
import { createPostgresClient } from '../../db/postgres'
import { createSqliteClient } from '../../db/sqlite'
import { pgMigrations } from '../../db/migrations-pg'
import { sqliteMigrations } from '../../db/migrations-sqlite'
import { runMigrations } from '../../db/runMigrations'
import { createPluginRecord, installPlugin, listPluginRecords, setPluginSettings, updatePluginRecord } from '../plugins'

const postgresUrl = process.env.TEST_POSTGRES_URL

// PostgreSQL tests create and remove their own database on a local test service.
// Never point this suite at an installation's database.
function localPostgresUrl(): URL {
  const url = new URL(postgresUrl!)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/instatic_plugin_test') {
    throw new Error('TEST_POSTGRES_URL must name the local instatic_plugin_test database')
  }
  return url
}

for (const dialect of ['sqlite', 'postgres'] as const) {
  describe.skipIf(dialect === 'postgres' && !postgresUrl)(`plugin record persistence (${dialect})`, () => {
    let db: DbClient
    let admin: DbClient | undefined
    const databaseName = `instatic_plugin_test_${crypto.randomUUID().replaceAll('-', '')}`

    beforeAll(async () => {
      if (dialect === 'postgres') {
        const url = localPostgresUrl()
        admin = createPostgresClient(url.href)
        await admin.unsafe(`create database ${databaseName}`)
        url.pathname = `/${databaseName}`
        db = createPostgresClient(url.href)
      } else {
        db = createSqliteClient(':memory:')
      }
      await runMigrations(db, dialect === 'postgres' ? pgMigrations : sqliteMigrations)
      await installPlugin(db, manifest)
    })

    afterAll(async () => {
      await db?.close()
      if (admin) {
        await admin.unsafe(`drop database if exists ${databaseName}`)
        await admin.close()
      }
    })

    const manifest = parsePluginManifest({
      id: 'test.checkpoints', name: 'Checkpoint test', version: '1.0.0', apiVersion: 1,
      description: 'Persistence regression fixture', permissions: ['cms.storage'],
      settings: [{ id: 'siteUrl', label: 'Website origin', type: 'text', default: '' }],
    })

    it('finds a saved generation checkpoint by field and updates it without duplication', async () => {
      await createPluginRecord(db, {
        id: 'checkpoint', pluginId: manifest.id, resourceId: 'state',
        data: { key: 'pending', value: JSON.stringify({ offset: 3 }) },
      })
      const first = await listPluginRecords(db, manifest.id, 'state', { filter: { key: 'pending' } })
      expect(first.totalCount).toBe(1)
      expect(first.records[0]?.data).toEqual({ key: 'pending', value: '{"offset":3}' })

      await updatePluginRecord(db, {
        id: first.records[0]!.id, pluginId: manifest.id, resourceId: 'state',
        data: { key: 'pending', value: JSON.stringify({ offset: 6 }) },
      })
      const second = await listPluginRecords(db, manifest.id, 'state', { filter: { key: { eq: 'pending' } } })
      expect(second.totalCount).toBe(1)
      expect(second.records[0]?.data).toEqual({ key: 'pending', value: '{"offset":6}' })
    })

    it('filters and pages documents within one generation', async () => {
      for (const [id, generation, path] of [
        ['a', 'current', '/a'], ['b', 'obsolete', '/b'], ['c', 'current', '/c'],
      ]) {
        await createPluginRecord(db, { id, pluginId: manifest.id, resourceId: 'documents', data: { generation, path } })
      }
      const page = await listPluginRecords(db, manifest.id, 'documents', {
        filter: { generation: 'current' }, orderBy: { path: 'asc' }, limit: 1, offset: 1,
      })
      expect(page.totalCount).toBe(2)
      expect(page.records.map(record => record.data.path)).toEqual(['/c'])
    })

    it('stores manifests, permission arrays, and settings as native JSON values', async () => {
      await setPluginSettings(db, manifest.id, manifest.settings ?? [], { siteUrl: 'https://example.com' })
      if (dialect === 'postgres') {
        const { rows } = await db.unsafe<{ manifest: string; grants: string; settings: string }>(`
          select jsonb_typeof(manifest_json) as manifest,
                 jsonb_typeof(granted_permissions_json) as grants,
                 jsonb_typeof(settings_json) as settings
          from installed_plugins where id = $1
        `, [manifest.id])
        expect(rows[0]).toEqual({ manifest: 'object', grants: 'array', settings: 'object' })
      }
      const { rows } = await db<{ settings_json: unknown }>`select settings_json from installed_plugins where id = ${manifest.id}`
      expect(rows[0]?.settings_json).toEqual({ siteUrl: 'https://example.com' })
    })

    it.skipIf(dialect !== 'postgres')('repairs string-wrapped JSON without changing record IDs or malformed values', async () => {
      const wrappedManifest = { ...manifest, id: 'test.wrapped' }
      const wrappedSettings = { siteUrl: 'https://example.com' }
      const wrappedRecord = { key: 'pending', value: '{"offset":3}' }
      await db.unsafe(`
        insert into installed_plugins (id, name, version, manifest_json, granted_permissions_json, settings_json)
        values ($1, $2, $3, cast(cast($4 as text) as jsonb), cast(cast($5 as text) as jsonb), cast(cast($6 as text) as jsonb))
      `, [wrappedManifest.id, wrappedManifest.name, wrappedManifest.version,
        JSON.stringify(JSON.stringify(wrappedManifest)), JSON.stringify(JSON.stringify(['cms.storage'])),
        JSON.stringify(JSON.stringify(wrappedSettings))])
      await db.unsafe(`
        insert into plugin_records (id, plugin_id, resource_id, data_json)
        values ($1, $2, $3, cast(cast($4 as text) as jsonb)),
               ($5, $2, $3, cast(cast($6 as text) as jsonb)),
               ($7, $2, $3, cast(cast($8 as text) as jsonb)),
               ($9, $2, $3, cast(cast($10 as text) as jsonb))
      `, ['wrapped', wrappedManifest.id, 'state', JSON.stringify(JSON.stringify(wrappedRecord)),
        'malformed', JSON.stringify('not valid JSON'), 'wrong-shape', JSON.stringify('[1,2]'),
        'unsupported', JSON.stringify('{"bad":"\\u0000"}')])

      expect((await listPluginRecords(db, wrappedManifest.id, 'state', { filter: { key: 'pending' } })).totalCount).toBe(0)
      const repair = pgMigrations.find(migration => migration.id === '031_plugin_json_values')
      expect(repair).toBeDefined()
      await db.transaction(tx => tx.unsafe(repair!.sql))
      const repaired = await listPluginRecords(db, wrappedManifest.id, 'state', { filter: { key: 'pending' } })
      expect(repaired.totalCount).toBe(1)
      expect(repaired.records[0]?.id).toBe('wrapped')
      expect(repaired.records[0]?.data).toEqual(wrappedRecord)
      const { rows } = await db<{ manifest_json: unknown; granted_permissions_json: unknown; settings_json: unknown }>`
        select manifest_json, granted_permissions_json, settings_json from installed_plugins where id = ${wrappedManifest.id}
      `
      expect(rows[0]).toEqual({ manifest_json: wrappedManifest, granted_permissions_json: ['cms.storage'], settings_json: wrappedSettings })
      const malformed = await db.unsafe<{ value: string }>('select cast(data_json as text) as value from plugin_records where id in ($1, $2, $3) order by id', ['malformed', 'wrong-shape', 'unsupported'])
      expect(malformed.rows.map(row => row.value)).toEqual(['"not valid JSON"', JSON.stringify('{"bad":"\\u0000"}'), '"[1,2]"'])
      // Re-running the data repair preserves already-normalized rows.
      await db.transaction(tx => tx.unsafe(repair!.sql))
      expect((await listPluginRecords(db, wrappedManifest.id, 'state', { filter: { key: 'pending' } })).totalCount).toBe(1)
    })
  })
}
