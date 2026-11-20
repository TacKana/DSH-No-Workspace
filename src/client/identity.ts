/**
 * 一个自动对话的身份标识。
 *
 * Host 预先分配 SessionId，并将目录精确命名为
 * `dsh-chat-<sessionId>`，因此仅凭持久化的 `cwd` 就能识别该对话——
 * 无论是刷新页面后、在另一个窗口中，还是在另一台机器上。浏览器中不存储任何内容，
 * 也不存在额外的 Host 状态。
 */

/** Host 放在 SessionId 前面的文件夹前缀。 */
export const DIRECTORY_PREFIX = 'dsh-chat-'

/** Host 刚刚分配的目录，保留到摘要报告它为止。 */
export interface CreatedSession {
  sessionId: string
  cwd: string
}

/**
 * 最近一次创建的工作目录（cwd）。会话列表可能比 RPC 返回滞后一次渲染，
 * 因此这里仅用于桥接那个时间窗口；一旦摘要携带了 `cwd`，该条目就会再次被丢弃。
 */
let pendingCreated: CreatedSession | undefined

/** 路径的末级名称，可识别两种分隔符。 */
export function baseName(path: string | undefined): string {
  if (path === undefined || path.length === 0) return ''
  return path.split(/[\\/]+/).filter((segment) => segment.length > 0).at(-1) ?? ''
}

/** 此会话是否拥有一个遵循插件命名的目录。 */
export function isStandaloneSession(sessionId: string | undefined, cwd: string | undefined): boolean {
  if (sessionId === undefined || sessionId.length === 0) return false
  return baseName(cwd) === `${DIRECTORY_PREFIX}${sessionId}`
}

/** 记住 Host 为刚创建的会话返回的目录。 */
export function rememberCreated(session: CreatedSession): void {
  pendingCreated = session
}

/** 一个会话的待处理目录（当它尚未被报告时）。 */
export function pendingCwd(sessionId: string | undefined): string | undefined {
  if (sessionId === undefined || pendingCreated === undefined) return undefined
  return pendingCreated.sessionId === sessionId ? pendingCreated.cwd : undefined
}

/** 待处理条目是否属于此会话。 */
export function isPending(sessionId: string | undefined): boolean {
  return sessionId !== undefined && pendingCreated !== undefined && pendingCreated.sessionId === sessionId
}

/** 一旦会话摘要自身携带了该目录，就丢弃交接信息。 */
export function settlePending(sessionId: string | undefined, summaryCwd: string | undefined): void {
  if (pendingCreated !== undefined && pendingCreated.sessionId === sessionId && summaryCwd !== undefined) {
    pendingCreated = undefined
  }
}

/** 完全忘记交接信息（插件卸载时）。 */
export function clearPending(): void {
  pendingCreated = undefined
}
