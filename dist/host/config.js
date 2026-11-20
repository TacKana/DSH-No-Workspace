import z from '@deepseek-ai/schemastery';
/**
 * Loader-row configuration.
 *
 * `root` is the directory that receives one `dsh-chat-<sessionId>` folder per
 * standalone conversation. Empty means "use the current profile's
 * `session-workspaces` folder", which keeps a fresh install working with no
 * configuration at all.
 */
export const Config = z.object({
    root: z.string().default('').description('自动会话目录的绝对路径。留空时使用当前 profile 下的 session-workspaces 目录。'),
});
