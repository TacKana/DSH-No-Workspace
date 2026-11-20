import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
/** Error codes the Host surfaces over the gateway; mirrored by the client. */
export const ERROR_ARGUMENTS_INVALID = 'no-workspace/arguments-invalid';
export const ERROR_ROOT_INVALID = 'no-workspace/root-invalid';
export const ERROR_MKDIR_FAILED = 'no-workspace/mkdir-failed';
/** The request payload is not the single `{ request }` object the gateway sends. */
export function argumentsInvalid() {
    return new RemoteError(ERROR_ARGUMENTS_INVALID, '新建会话参数无效。', {});
}
/** No usable absolute root directory is configured. */
export function rootInvalid() {
    return new RemoteError(ERROR_ROOT_INVALID, '请在插件配置中填写主机上的完整绝对路径。', {});
}
/** The configured root exists but the conversation directory could not be created. */
export function mkdirFailed(root, cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return new RemoteError(ERROR_MKDIR_FAILED, `无法在 ${root} 创建会话目录。${reason}`, { root });
}
