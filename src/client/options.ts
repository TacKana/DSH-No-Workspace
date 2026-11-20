import type { WorkspaceView } from './types.js'

/**
 * “不在工作区中”选项的哨兵 id。
 *
 * 它绝不是真实的 WorkspaceId：被包装的 `uiWorkspace.openWorkspace`
 * 通过启动一个独立对话来响应它，而不是打开一个工作区，
 * 并且 Host 上永远不会以该 id 注册任何内容。
 */
export const NO_WORKSPACE_OPTION_ID = 'no-workspace:standalone'

/**
 * 选择器操作的图标。应用随附的任何雪碧图都可用；运行
 * `node test/icon-gallery.mjs` 可渲染一张包含所有可用图标的图集。
 */
export const NO_WORKSPACE_ICON = 'dsw-icon-close-outline-regular'

/**
 * 为插件自己的对话显示的合成工作区行。
 *
 * `path` 保持为空，因此不会有文件夹名泄漏到任何界面，并且该行仅在
 * 那个会话确实是独立会话时才拥有它——在工作区对话中，该行是一个未选中的操作，
 * 因此工作区芯片会继续解析真实项目。
 */
export function noWorkspaceOption(sessionId: string | undefined, title: string): WorkspaceView {
  return {
    workspaceId: NO_WORKSPACE_OPTION_ID,
    path: '',
    title,
    sessionIds: sessionId === undefined ? [] : [sessionId],
    createdAt: '',
    updatedAt: '',
  }
}
