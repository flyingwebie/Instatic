#!/usr/bin/env node
/**
 * `instatic` executable: wires the real process into `runCli`.
 */
import { createInterface } from 'node:readline'
import { runCli } from './cli'

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/** Read one line from the terminal without echoing it. */
function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(question)
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
    // Swallow the echo of typed characters; readline still collects them.
    ;(rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => {}
    rl.question('', (answer) => {
      rl.close()
      process.stderr.write('\n')
      resolve(answer)
    })
  })
}

const code = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin,
  stdinIsTty: Boolean(process.stdin.isTTY),
  promptSecret,
})
process.exitCode = code
