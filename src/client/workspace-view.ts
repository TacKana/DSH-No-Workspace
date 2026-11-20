import type { Sessions, UiSession, WorkspaceSnapshot, Workspaces, WorkspaceView } from './types.js'
import { isStandaloneSession, settlePending, clearPending } from './identity.js'
import type { Text } from './locale.js'
import { noWorkspaceOption } from './options.js'
import { cwdOf, identityOf, summaryOf } from './sessions.js'

/** 每个最近见过的会话身份与目录至多保留一个条目。 */
const MAX_SOURCES = 16

/** 工作区列表的一个派生的会话作用域视图。 */
interface View {
  list: WorkspaceSnapshot | undefined
  row: WorkspaceView | undefined
  snapshot: WorkspaceSnapshot | undefined
}

/** 交给会话作用域钩子的可观察形状。 */
interface ShadowSource {
  getSnapshot(): WorkspaceSnapshot
  subscribe(listener: () => void): () => void
}

/**
 * 在会话作用域遮蔽标准的 `useWorkspaces` 钩子，使一个对话
 * 既能看到真实的工作区列表，又能看到额外一行，该行命名此插件自己的
 * 自动目录。
 *
 * 当没有任何工作区列出该会话且列表已就绪时，`ConversationContent` 会恰好禁用
 * Hero 编写器，因此那个行正是为空白独立会话提供标题（不在工作区中工作）的东西。
 * Host 列表、侧边栏和选择器自身的数据从不被修改，并且在卸载时移除该提供者
 * 会恢复未受影响的根视图。
 * @param uiSession - 会话作用域服务（`ctx.get('uiSession')`）。
 * @param workspaces - 工作区控制器（`ctx.get('workspaces')`）。
 * @param sessions - 会话控制器（`ctx.get('sessions')`）。
 * @param text - 本地化标签以及改变它们的修订版本号。
 * @returns 插件拆除函数。
 */
export function installWorkspacePickerView(
  uiSession: UiSession,
  workspaces: Workspaces,
  sessions: Sessions,
  text: Text,
): () => void {
  const current = uiSession.adapter.current
  const sources = new Map<string, ShadowSource>()

  /** 根列表的一个视图，为插件自己的会话额外加一行。 */
  function build(sessionId: string, standalone: boolean, title: string): ShadowSource {
    const entry: View = { list: undefined, row: undefined, snapshot: undefined }
    return {
      getSnapshot(): WorkspaceSnapshot {
        // 真实工作区内的对话读取未受影响的根列表；
        // 用于离开它的菜单操作被镜像到菜单自己的 DOM 中。
        if (!standalone) return workspaces.list.getSnapshot()
        const list = workspaces.list.getSnapshot()
        if (entry.list === list && entry.snapshot !== undefined) return entry.snapshot
        entry.list = list
        entry.row ??= noWorkspaceOption(sessionId, title)
        entry.snapshot = { ...list, items: [...list.items, entry.row] }
        return entry.snapshot
      },
      subscribe(listener: () => void): () => void {
        const offList = workspaces.list.subscribe(listener)
        const offSessions = sessions.list.subscribe(listener)
        const offText = text.subscribe(listener)
        return () => {
          offList()
          offSessions()
          offText?.()
        }
      },
    }
  }

  /** 交给一个会话绑定的源；在会话之外则为根列表。 */
  const sourceFor = (rawSessionId: string | undefined) => {
    const sessionId = rawSessionId !== undefined && rawSessionId.length > 0 ? rawSessionId : undefined
    // 未选择对话：交回未受影响的根列表。
    if (sessionId === undefined) return workspaces.list
    const cwd = cwdOf(sessions, sessionId)
    const standalone = isStandaloneSession(sessionId, cwd)
    const title = standalone ? text.label() : ''
    const key = `${sessionId}\u0000${cwd ?? ''}\u0000${String(standalone)}\u0000${title}\u0000${String(text.revision())}`
    const known = sources.get(key)
    if (known !== undefined) return known
    const source = build(sessionId, standalone, title)
    if (sources.size > MAX_SOURCES) sources.clear()
    sources.set(key, source)
    return source
  }

  let providerDispose: (() => void) | undefined
  let installingProvider = false
  const syncProvider = (): void => {
    const sessionId = identityOf(current.getSnapshot())
    // 摘要已赶上创建交接：丢弃它。
    if (sessionId !== undefined) settlePending(sessionId, summaryOf(sessions, sessionId)?.cwd)
    // 会话作用域的钩子会一次性为每个会话绑定声明，因此
    // 此贡献仅在选中对话时存在。在对话之外
    // （冷启动 Hero）根提供者必须保持未受影响，否则
    // 已声明但不存在的钩子会用 `undefined` 遮蔽它。
    if (sessionId === undefined) {
      if (providerDispose !== undefined) {
        const dispose = providerDispose
        providerDispose = undefined
        dispose()
      }
      return
    }
    // 注册描述符会重建每个绑定并发布当前绑定，这会重新进入此监听器；
    // 该标志防止那次重入把同一个钩子注册两次（重复的钩子会抛出异常）。
    if (providerDispose === undefined && !installingProvider) {
      installingProvider = true
      try {
        providerDispose = uiSession.provide({
          hooks: ['workspaces'],
          resolve: (binding) => ({ hooks: { workspaces: sourceFor(identityOf(binding)) } }),
        })
      } finally {
        installingProvider = false
      }
    }
  }

  const offCurrent = current.subscribe(syncProvider)
  const offSessions = sessions.list.subscribe(syncProvider)
  syncProvider()

  return () => {
    offCurrent()
    offSessions()
    if (providerDispose !== undefined) {
      const dispose = providerDispose
      providerDispose = undefined
      dispose()
    }
    sources.clear()
    clearPending()
  }
}
