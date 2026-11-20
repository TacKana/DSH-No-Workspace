import type { ClientContext } from './types.js'
import { rememberCreated } from './identity.js'
import { connection } from './services.js'

/** Host 为一个已创建对话回报的内容。 */
export interface CreatedSession {
  sessionId: string
  cwd: string | undefined
}

/** 网关 RPC 的失败信封。 */
interface RemoteFailure {
  ok: false
  error?: { code?: string; message?: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 通过插件的单个 Host 端点创建一个未分组的会话。
 *
 * 网关要求单个外层 `args` 键以及一个必需的 SRC
 * 参数，因此 `request` 对象始终存在。
 * @param ctx - 客户端插件上下文。
 * @param agentPreset - 可选的按会话 agent 预设。
 * @param signal - 插件生命周期取消信号。
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
