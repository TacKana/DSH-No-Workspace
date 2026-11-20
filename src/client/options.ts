import type { WorkspaceView } from './types.js'

/**
 * Sentinel id of the "not in a workspace" choice.
 *
 * It is never a real WorkspaceId: the wrapped `uiWorkspace.openWorkspace`
 * answers it by starting a standalone conversation instead of opening a
 * Workspace, and nothing is ever registered on the Host under this id.
 */
export const NO_WORKSPACE_OPTION_ID = 'no-workspace:standalone'

/**
 * Icon of the picker action. Any sprite the app ships works; run
 * `node test/icon-gallery.mjs` to render a sheet of every available icon.
 */
export const NO_WORKSPACE_ICON = 'dsw-icon-close-outline-regular'

/**
 * The synthetic Workspace row shown for the plugin's own conversations.
 *
 * `path` stays empty so no folder name leaks into any surface, and the row only
 * owns a Session when that Session really is standalone — in a Workspace
 * conversation the row is an unselected action, so the Workspace chip keeps
 * resolving the real project.
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
