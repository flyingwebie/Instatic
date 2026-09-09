import { expect, it } from 'bun:test'

it('keeps dock controls interactive while all editor panels suspend', async () => {
  const child = Bun.spawn(
    [process.execPath, 'test', './src/__tests__/god-mode/fixtures/codeDockSuspension.tsx'],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [exit, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect({ exit, failure: exit === 0 ? '' : output + error }).toEqual({ exit: 0, failure: '' })
}, 15_000)
