import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/** Host 通过网关对外暴露的错误码；客户端与之对应。 */
export const ERROR_ARGUMENTS_INVALID = 'no-workspace/arguments-invalid'
export const ERROR_ROOT_INVALID = 'no-workspace/root-invalid'
export const ERROR_MKDIR_FAILED = 'no-workspace/mkdir-failed'

/** 请求载荷不是网关所发送的那个单一 `{ request }` 对象。 */
export function argumentsInvalid(): RemoteError {
  return new RemoteError(ERROR_ARGUMENTS_INVALID, '新建会话参数无效。', {})
}

/** 未配置可用的绝对根目录。 */
export function rootInvalid(): RemoteError {
  return new RemoteError(ERROR_ROOT_INVALID, '请在插件配置中填写主机上的完整绝对路径。', {})
}

/** 配置的根目录存在，但无法创建会话目录。 */
export function mkdirFailed(root: string, cause: unknown): RemoteError {
  const reason = cause instanceof Error ? cause.message : String(cause)
  return new RemoteError(ERROR_MKDIR_FAILED, `无法在 ${root} 创建会话目录。${reason}`, { root })
}
