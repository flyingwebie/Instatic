/**
 * Bundle the `instatic` CLI (`packages/cli`) into one self-contained file for
 * npm. Every dependency — the MCP client/server SDKs, TypeBox — is inlined, so
 * `npx instatic` / `bunx instatic` install nothing but this file. Targets Node
 * (>= 20); Bun runs the same output.
 */
import { chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'

const cliDir = join(import.meta.dir, '..', 'packages', 'cli')
const outdir = join(cliDir, 'dist')

await rm(outdir, { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: [join(cliDir, 'src', 'index.ts')],
  outdir,
  naming: 'instatic.js',
  target: 'node',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
})

if (!result.success) {
  for (const log of result.logs) console.error('[build-cli]', log)
  process.exit(1)
}

const output = join(outdir, 'instatic.js')
const text = await Bun.file(output).text()
if (!text.startsWith('#!')) {
  console.error('[build-cli] bundle lost its #!/usr/bin/env node line')
  process.exit(1)
}
await chmod(output, 0o755)
console.info(`[build-cli] wrote ${output} (${(text.length / 1024).toFixed(0)} KiB)`)
