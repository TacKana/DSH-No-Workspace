import type { ClientContext, SessionBinding, SessionSummary, Sessions } from './types.js'
import { isPending, pendingCwd } from './identity.js'
import { isStandaloneSession } from './identity.js'
import { sessions as sessionsService, uiSession as uiSessionService, workspaces as workspacesService } from './services.js'

/** Session identity held by a view binding (newer builds use `key`). */
export function identityOf(binding: SessionBinding | undefined): string | undefined {
  if (binding === undefined) return undefined
  const identity = binding.key ?? binding.sessionId
  return typeof identity === 'string' && identity.length > 0 ? identity : undefined
}

/** The list row the client already published for one Session. */
export function summaryOf(controller: Sessions | undefined, sessionId: string | undefined): SessionSummary | undefined {
  if (controller === undefined || sessionId === undefined || sessionId.length === 0) return undefined
  return controller.list.getSnapshot().byId?.[sessionId]
}

/** Working directory of a Session, including the just-created hand-off. */
export function cwdOf(controller: Sessions | undefined, sessionId: string | undefined): string | undefined {
  const pending = pendingCwd(sessionId)
  if (pending !== undefined) return pending
  return summaryOf(controller, sessionId)?.cwd
}

/**
 * What the main view currently shows, for the "New Session" reuse rules.
 * - `standalone`: this plugin's blank conversation — pressing New Session again
 *   must not allocate another directory.
 * - `workspace`: a blank conversation already owned by a Workspace — the native
 *   flow reuses that Session instead of creating one.
 * - `active`: the conversation already has content, so a new one is expected.
 */
export type NewConversation = 'standalone' | 'workspace' | 'active'

/** Classify the current main conversation. `undefined` when it cannot be told. */
export function currentNewConversation(ctx: ClientContext): NewConversation | undefined {
  const binding = uiSessionService(ctx)?.adapter.current.getSnapshot()
  const sessionId = identityOf(binding)
  if (sessionId === undefined) return undefined

  const controller = sessionsService(ctx)
  const summary = summaryOf(controller, sessionId)
  const blank = summary === undefined ? isPending(sessionId) : summary.blank === true
  if (!blank) return 'active'

  if (isStandaloneSession(sessionId, cwdOf(controller, sessionId))) return 'standalone'

  const items = workspacesService(ctx)?.list.getSnapshot().items ?? []
  const listed = items.some((item) => item.sessionIds.includes(sessionId))
  return listed ? 'workspace' : undefined
}
