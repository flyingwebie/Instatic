#!/usr/bin/env node
/**
 * `instatic` executable: wires the real process into `runCli`.
 */
import { spawn } from 'node:child_process'
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

/**
 * Open `url` in the default browser. Never through a shell: the URL is one
 * argv entry, so characters like & or " cannot change the command.
 */
function openBrowser(url: string): Promise<boolean> {
  const command = process.platform === 'darwin'
    ? { file: 'open', args: [url] }
    : process.platform === 'win32'
      ? { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
      : { file: 'xdg-open', args: [url] }
  // Linux without a display (SSH, containers): nothing to open a browser on.
  if (
    command.file === 'xdg-open' &&
    !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.WSL_DISTRO_NAME
  ) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, { stdio: 'ignore', detached: true, shell: false })
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
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
  openBrowser,
})
process.exitCode = code
