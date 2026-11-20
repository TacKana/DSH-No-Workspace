import type { ClientContext } from './types.js'
import { rememberCreated } from './identity.js'
import { connection } from './services.js'

/** What the Host reports back for one created conversation. */
export interface CreatedSession {
  sessionId: string
  cwd: string | undefined
}

/** Failure envelope of the gateway RPC. */
interface RemoteFailure {
  ok: false
  error?: { code?: string; message?: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Create one ungrouped Session through the plugin's single Host endpoint.
 *
 * The gateway requires the single outer `args` key and a required SRC
 * parameter, so the `request` object is always present.
 * @param ctx - client plugin context.
 * @param agentPreset - optional per-Session agent preset.
 * @param signal - plugin lifetime cancellation.
 */
export async function createUngroupedSession(
  ctx: ClientContext,
  agentPreset: string | undefined,
  signal: AbortSignal,
): Promise<CreatedSession> {
  const link = connection(ctx)
  if (link === undefined) throw new Error('no-workspace: connection service is unavailable')

  const payload = { args: { request: agentPreset === undefined ? {} : { agentPreset } } }
  const result = await link.rpc.call('/api', 'no-workspace/create', payload, signal)

  if (!isRecord(result) || result['ok'] !== true) {
    const failure = (isRecord(result) ? result : {}) as unknown as RemoteFailure
    const code = failure.error?.code
    const message = failure.error?.message
    const error = new Error(message !== undefined && message.length > 0 ? message : 'no-workspace/create returned no value')
    if (code !== undefined) Object.assign(error, { code })
    throw error
  }

  const value = result['value']
  const sessionId = isRecord(value) ? value['sessionId'] : undefined
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('no-workspace/create returned no sessionId')
  }
  const rawCwd = isRecord(value) ? value['cwd'] : undefined
  const cwd = typeof rawCwd === 'string' && rawCwd.length > 0 ? rawCwd : undefined
  if (cwd !== undefined) rememberCreated({ sessionId, cwd })
  return { sessionId, cwd }
}
