/**
 * Identity of an automatic conversation.
 *
 * The Host pre-allocates the SessionId and names the directory exactly
 * `dsh-chat-<sessionId>`, so the persisted `cwd` alone identifies the
 * conversation — after a page refresh, in another window, or on another
 * machine. Nothing is stored in the browser and no extra Host state exists.
 */

/** Folder prefix the Host puts in front of the SessionId. */
export const DIRECTORY_PREFIX = 'dsh-chat-'

/** A directory the Host just allocated, kept until the summary reports it. */
export interface CreatedSession {
  sessionId: string
  cwd: string
}

/**
 * Cwd of the most recent creation. The Session list can lag one render behind
 * the RPC return, so this bridges that window only; once the summary carries a
 * `cwd` the entry is dropped again.
 */
let pendingCreated: CreatedSession | undefined

/** Leaf name of a path, understanding both separators. */
export function baseName(path: string | undefined): string {
  if (path === undefined || path.length === 0) return ''
  return path.split(/[\\/]+/).filter((segment) => segment.length > 0).at(-1) ?? ''
}

/** Whether this Session owns a directory that follows the plugin's naming. */
export function isStandaloneSession(sessionId: string | undefined, cwd: string | undefined): boolean {
  if (sessionId === undefined || sessionId.length === 0) return false
  return baseName(cwd) === `${DIRECTORY_PREFIX}${sessionId}`
}

/** Remember the directory returned by the Host for a freshly created Session. */
export function rememberCreated(session: CreatedSession): void {
  pendingCreated = session
}

/** The pending directory for one Session, when it has not been reported yet. */
export function pendingCwd(sessionId: string | undefined): string | undefined {
  if (sessionId === undefined || pendingCreated === undefined) return undefined
  return pendingCreated.sessionId === sessionId ? pendingCreated.cwd : undefined
}

/** Whether the pending entry belongs to this Session. */
export function isPending(sessionId: string | undefined): boolean {
  return sessionId !== undefined && pendingCreated !== undefined && pendingCreated.sessionId === sessionId
}

/** Drop the hand-off once the Session summary carries the directory itself. */
export function settlePending(sessionId: string | undefined, summaryCwd: string | undefined): void {
  if (pendingCreated !== undefined && pendingCreated.sessionId === sessionId && summaryCwd !== undefined) {
    pendingCreated = undefined
  }
}

/** Forget the hand-off entirely (plugin unload). */
export function clearPending(): void {
  pendingCreated = undefined
}
