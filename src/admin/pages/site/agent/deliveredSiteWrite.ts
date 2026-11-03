/**
 * Run one site-mutation tool so its result matches what reached the server.
 *
 * The browser editor is the only write path for AI tools (MCP and the in-editor
 * agent alike), and every edit it accepts streams to the collab relay. Two
 * things can still make a tool's own success result untrue:
 *   - the write gate was closed (docs still syncing, socket offline), so the
 *     store never changed and the tool described the OLD state;
 *   - the write was accepted locally but the server reverted it or never
 *     received it.
 * This wrapper waits for the gate first, then checks the write watch after the
 * tool ran, and turns either case into an error the caller can act on.
 */
import { aiToolError, type AiToolOutput } from '@core/ai'
import { whenCollabWritable } from '@site/store/slices/site/collabWriteGate'
import { beginCollabWriteWatch } from '@site/store/slices/site/collabBinding'

export async function runDeliveredSiteWrite(
  runTool: () => Promise<AiToolOutput>,
): Promise<AiToolOutput> {
  // Sub-second in practice; the deadline exists so a genuinely stuck socket
  // surfaces as an error instead of hanging the tool call.
  if (!(await whenCollabWritable())) {
    return aiToolError(
      'Editor is still syncing with the collaboration relay; the write was not applied. Retry shortly.',
    )
  }

  const finishWrite = beginCollabWriteWatch()
  const result = await runTool()
  const receipt = await finishWrite()
  if (!receipt.ok) {
    return aiToolError(result.ok ? receipt.error : `${result.error} ${receipt.error}`)
  }
  return result
}
