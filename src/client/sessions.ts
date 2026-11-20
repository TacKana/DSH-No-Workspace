import type { ClientContext, SessionBinding, SessionSummary, Sessions } from './types.js'
import { isPending, pendingCwd } from './identity.js'
import { isStandaloneSession } from './identity.js'
import { sessions as sessionsService, uiSession as uiSessionService, workspaces as workspacesService } from './services.js'

/** 视图绑定所持有的会话身份标识（较新的构建使用 `key`）。 */
export function identityOf(binding: SessionBinding | undefined): string | undefined {
  if (binding === undefined) return undefined
  const identity = binding.key ?? binding.sessionId
  return typeof identity === 'string' && identity.length > 0 ? identity : undefined
}

/** 客户端已为一个会话发布的列表行。 */
export function summaryOf(controller: Sessions | undefined, sessionId: string | undefined): SessionSummary | undefined {
  if (controller === undefined || sessionId === undefined || sessionId.length === 0) return undefined
  return controller.list.getSnapshot().byId?.[sessionId]
}

/** 会话的工作目录，包括刚创建的交接信息。 */
export function cwdOf(controller: Sessions | undefined, sessionId: string | undefined): string | undefined {
  const pending = pendingCwd(sessionId)
  if (pending !== undefined) return pending
  return summaryOf(controller, sessionId)?.cwd
}

/**
 * 主视图当前显示的内容，用于“新建会话”的复用规则。
 * - `standalone`：此插件的空白对话——再次按“新建会话”
 *   不得再分配另一个目录。
 * - `workspace`：已被某个工作区拥有的空白对话——原生流程
 *   复用该会话，而不是新建一个。
 * - `active`：对话已有内容，因此预期会创建一个新对话。
 */
export type NewConversation = 'standalone' | 'workspace' | 'active'

/** 对当前主对话进行分类。无法判断时返回 `undefined`。 */
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
