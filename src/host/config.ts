import z from '@deepseek-ai/schemastery'

/**
 * Loader 行的配置。
 *
 * `root` 是接收目录：每个独立会话都会在其中生成一个
 * `dsh-chat-<sessionId>` 文件夹。留空表示"使用当前 profile 的
 * `session-workspaces` 文件夹"，这样全新安装无需任何配置
 * 即可直接工作。
 */
export const Config = z.object({
  root: z.string().default('').description('自动会话目录的绝对路径。留空时使用当前 profile 下的 session-workspaces 目录。'),
})

/** 由 {@link Config} 校验的值的结构。 */
export interface NoWorkspaceConfig {
  root: string
}
