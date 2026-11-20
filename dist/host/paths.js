import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
/** 与客户端身份检查共用的文件夹名前缀。 */
export const DIRECTORY_PREFIX = 'dsh-chat-';
/** 本插件所创建的一切所用的私有权限。 */
const DIRECTORY_MODE = 0o700;
/**
 * 解析配置的会话根目录。
 *
 * 显式配置的绝对路径优先。否则该目录位于已启动的 profile 之内，
 * 由启动器通过 `ctx.profileContext` 发布（对于不暴露它的上下文，
 * 则以 `DSH_PROFILE_DIR` 作为回退）。
 * @param configured - `root` loader 行选项的值。
 * @param profileDir - 启动器提供时的 profile 目录。
 * @returns 一个绝对目录；当无法确定时返回 `undefined`。
 */
export function resolveRoot(configured, profileDir) {
    const candidate = configured.length > 0
        ? configured
        : profileDir === undefined || profileDir.length === 0
            ? ''
            : path.join(profileDir, 'session-workspaces');
    if (candidate.length === 0 || !path.isAbsolute(candidate))
        return undefined;
    // `\foo`/`/foo` 在 Windows 上是驱动器相对路径：node:path 会把它们看作绝对路径，
    // 但实际上会相对当前驱动器解析，文件夹就会落到别处。
    if (process.platform === 'win32' && /^[\\/](?![\\/])/.test(candidate))
        return undefined;
    return candidate;
}
/**
 * 分配一个目录名。SessionId 在此处选定，文件夹以其命名，
 * 因此客户端仅凭持久化的 `cwd` 就能识别自己的会话 ——
 * 无需任何旁路元数据，并且能经受刷新或换用不同设备。
 * @param root - 绝对会话根目录。
 * @returns 预先分配的 SessionId 及其目录。
 */
export function allocate(root) {
    const sessionId = randomUUID();
    return { sessionId, cwd: path.join(root, `${DIRECTORY_PREFIX}${sessionId}`) };
}
/**
 * 创建根目录和新的会话目录。
 * 末尾的 `mkdir` 有意设为非递归：若同名目录已存在，
 * 说明分配发生了冲突，不可复用。
 * @param allocation - 要创建的目录。
 * @param root - 绝对会话根目录。
 */
export async function createDirectory(allocation, root) {
    await mkdir(root, { recursive: true, mode: DIRECTORY_MODE });
    await mkdir(allocation.cwd, { mode: DIRECTORY_MODE });
}
/**
 * 删除本请求创建但随后绑定失败的目录。
 * `rmdir` 只在空目录上成功，因此用户或 agent 写入的
 * 任何内容都不会在此丢失。
 * @param cwd - 要删除的目录。
 * @param warn - 目录非空时使用的 logger。
 */
export async function discardDirectory(cwd, warn) {
    try {
        await rmdir(cwd);
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            warn('保留未能清理的会话目录', cwd, error instanceof Error ? error.message : String(error));
        }
    }
}
