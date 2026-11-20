import type {
  BeforeOpen,
  ClientContext,
  DraftOptions,
  Layout,
  SessionBinding,
  StartSessionOptions,
  UiWorkspace,
} from './types.js'
import { NO_WORKSPACE_OPTION_ID } from './options.js'
import { conversation as conversationService, layout as layoutService, sessions as sessionsService } from './services.js'
import { currentNewConversation } from './sessions.js'
import { createUngroupedSession, type CreatedSession } from './standalone.js'

/** 两个被包装入口点接受的选项；调用方是无类型的。 */
type EntryOptions = StartSessionOptions | undefined

/** 调用方是否要求空白会话采用初始内容。 */
export function wantsDraftInitialization(draftOptions: DraftOptions | undefined): boolean {
  if (draftOptions === undefined) return false
  return (
    draftOptions.prompt !== undefined ||
    (draftOptions.whenDraftExists ?? (draftOptions.clearPreviousDraft === true ? 'replace' : 'keep')) === 'replace'
  )
}

/** 选择器操作需要从此入口获得的内容。 */
export interface NavigationHandle {
  /** 原生服务暴露了 `openWorkspace`，因此选择器可以被扩展。 */
  wrapsOpenWorkspace: boolean
  /** 开始一个独立对话，就像已选择了选择器哨兵一样。 */
  openOption(): Promise<void> | undefined
}

/**
 * 接管原生的“新对话”入口点。
 *
 * `startSession` 是全局“新建会话”按钮、内置快捷键和工作区行
 * 背后的唯一条目；`openWorkspace` 是 Hero 选择器在选中工作区行时
 * 调用的东西。每当调用方明确命名了某项内容时，两者都保留原生行为，
 * 只有未命名的新对话才会被重定向到私有目录。
 * @param ctx - 客户端插件上下文。
 * @returns 选择器钩子；当服务不可用时为 `undefined`。
 */
export function installNavigation(ctx: ClientContext): NavigationHandle | undefined {
  const resolved = ctx.get('uiWorkspace') as UiWorkspace | undefined
  if (resolved === undefined || typeof resolved.startSession !== 'function') {
    console.warn('no-workspace: uiWorkspace.startSession is unavailable; client entry skipped')
    return undefined
  }
  const service: UiWorkspace = resolved

  // 记住被包装的方法是否为自有属性，以便处置时能把对象
  // 精确还原成原来的样子（通常它们位于原型上）。
  const hadOwnStartSession = Object.prototype.hasOwnProperty.call(service, 'startSession')
  const originalStartSession = service.startSession
  const hadOwnOpenWorkspace = Object.prototype.hasOwnProperty.call(service, 'openWorkspace')
  const originalOpenWorkspace = service.openWorkspace
  const wrapsOpenWorkspace = typeof originalOpenWorkspace === 'function'

  const lifetime = new AbortController()
  /** 预设键 -> 进行中的创建，使重复点击共享同一个请求。 */
  const inFlight = new Map<string, Promise<CreatedSession>>()
  let disposed = false
  /** 单调标记，使较晚的导航取代进行中的创建。 */
  let startEpoch = 0

  const requestSession = (agentPreset: string | undefined): Promise<CreatedSession> => {
    const key = agentPreset === undefined ? '' : `preset:${agentPreset}`
    const pending = inFlight.get(key)
    if (pending !== undefined) return pending
    const created = createUngroupedSession(ctx, agentPreset, lifetime.signal).finally(() => {
      if (inFlight.get(key) === created) inFlight.delete(key)
    })
    inFlight.set(key, created)
    return created
  }

  /**
   * 通过原生流程使用的通知通道（`toast.createFailed`）显露失败。
   * 受保护：该通道是 ui-workspace 的实现细节，因此缺失时仅记录日志。
   */
  const reportFailure = (error: unknown): void => {
    const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
    const code = typeof record['code'] === 'string' ? record['code'] : undefined
    const message = typeof record['message'] === 'string' && record['message'].length > 0 ? record['message'] : String(error)
    if (typeof service.notify === 'function') {
      try {
        service.notify({ kind: 'createFailed', message: code === undefined ? message : `${code}: ${message}` })
      } catch {
        // 通知通道是尽力而为的
      }
    }
    console.warn('no-workspace: new conversation failed:', error)
  }

  /**
   * 将光标移入刚刚成为主视图的会话的编写器中。
   * 尽力而为：对话服务是实现细节，可能滞后一帧，因此该调用会重试几次。
   */
  function focusComposer(attempts = 12): void {
    try {
      // `input.focus` 是外壳的公共聚焦钩子；要防范其形状，
      // 因为对话服务是一个可能滞后的实现细节。
      const input = conversationService(ctx)?.input as { focus?: () => void } | undefined
      if (typeof input?.focus === 'function') input.focus()
    } catch (error) {
      console.warn('no-workspace: focusing the composer failed:', error)
    }
    if (attempts > 1) {
      const timer: unknown = setTimeout(() => {
        if (!disposed) focusComposer(attempts - 1)
      }, 120)
      const maybeNodeTimer = timer as { unref?: () => void }
      if (typeof maybeNodeTimer.unref === 'function') maybeNodeTimer.unref()
    }
  }

  /** 应用原生实现会应用的相同草稿选项。 */
  const applyDraft = (sessionId: string, draftOptions: DraftOptions | undefined): void => {
    if (draftOptions === undefined) return
    try {
      const sessions = sessionsService(ctx)
      const conversation = conversationService(ctx)
      const binding: SessionBinding | undefined = sessions?.binding(sessionId)
      if (conversation === undefined || binding === undefined) {
        throw new Error('draft initialization services are unavailable')
      }
      const outcome = conversation.input.requestDraftInitialization(binding, draftOptions)
      if (outcome === 'blocked') throw new Error('the draft is blocked by a pending submission')
    } catch (error) {
      console.warn('no-workspace: draft initialization failed:', error)
    }
  }

  /**
   * 创建并打开一个独立会话，同时处理草稿选项和
   * 启动恢复竞态。由原生“新建会话”条目和
   * “不在工作区中”选择器操作共享。
   */
  function startStandalone(options: EntryOptions, migrate?: BeforeOpen): Promise<void> | undefined {
    const { agentPreset, ...draftOptions } = options ?? {}
    const initializeDraft = wantsDraftInitialization(options === undefined ? undefined : draftOptions)
    const epoch = ++startEpoch

    // 原生初始恢复可以输给用户的创建；较晚的导航仍然获胜。
    // 记录当用户请求该会话时，是否已有恢复抢占了
    // 舞台。
    const restorationAtStart = service.restorationNavigation

    // 启动一个导航会取消先前待处理的导航，正如原生流程在
    // openWorkspaceSession 中所做的。
    const layout: Layout | undefined = layoutService(ctx) ?? undefined
    const navigation = typeof layout?.beginNavigation === 'function' ? layout.beginNavigation() : lifetime.signal

    return requestSession(agentPreset)
      .then(({ sessionId }) => {
        if (disposed || epoch !== startEpoch) return
        let activeNavigation = navigation
        if (activeNavigation.aborted) {
          // 此插件容忍的唯一启动竞态：原生初始恢复在用户已请求会话之后
          // 调用 beginNavigation()，中止用户的信号。用户在点击时尚未开始的
          // 恢复必须让路；真正的后续切换仍然获胜。
          const restoration = service.restorationNavigation
          const initialRestoreTookOver = restorationAtStart === undefined && restoration !== undefined && !restoration.aborted
          if (!initialRestoreTookOver) return
          // 中止那个恢复的导航，并用全新的导航信号打开用户的
          // 会话。
          activeNavigation = layout!.beginNavigation()
        }
        const beforeOpen: BeforeOpen | undefined =
          initializeDraft || migrate !== undefined
            ? (id: string) => {
                if (migrate !== undefined) {
                  try {
                    migrate(id)
                  } catch (error) {
                    console.warn('no-workspace: draft migration failed:', error)
                  }
                }
                if (initializeDraft) applyDraft(id, draftOptions)
              }
            : undefined
        // `replaceMain` 是 openWorkspaceSession 背后的原生原语：它保留
        // 该会话，在发布选择之前应用草稿，并通过信号让位于
        // 较晚的导航。
        if (typeof service.replaceMain === 'function') {
          service.replaceMain(sessionId, activeNavigation, 'reveal', beforeOpen)
        } else {
          beforeOpen?.(sessionId)
          service.openSession(sessionId)
        }
        // `replaceMain` 发布选择而不移动焦点，因此从菜单启动的聊天
        // 会把光标留在编写器之外。
        if (!initializeDraft) focusComposer()
      })
      .catch((error: unknown) => {
        const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
        if (!disposed && epoch === startEpoch && name !== 'AbortError') reportFailure(error)
      })
  }

  /**
   * `uiWorkspace.startSession` 的替代实现。
   * @param workspaceId - 显式的工作区保留原生流程。
   * @param options - 草稿初始化选项和 `agentPreset`。
   */
  function startSession(this: unknown, workspaceId?: string, options?: EntryOptions): unknown {
    if (workspaceId !== undefined) {
      // 任何 startSession 调用（显式工作区或独立）都会取代
      // 先前点击遗留的仍待处理的创建。
      startEpoch += 1
      return originalStartSession.apply(this ?? service, [workspaceId, options])
    }

    // 已经是一个全新的对话：再次按“新建会话”不得
    // 创建另一个目录。独立空白会话保持原样，
    // 对于工作区中的空白会话，原生流程复用该会话。
    // 仍在进行中的创建则允许完成并打开。
    if (!wantsDraftInitialization(options) && inFlight.size === 0) {
      const existing = currentNewConversation(ctx)
      if (existing === 'standalone') return undefined
      if (existing === 'workspace') {
        startEpoch += 1
        return originalStartSession.apply(this ?? service, [workspaceId, options])
      }
    }

    return startStandalone(options)
  }

  /**
   * `uiWorkspace.openWorkspace` 的替代实现。真实的工作区 id 保留
   * 原生流程；合成的“不在工作区中”行则改为启动一个独立
   * 对话。Hero 选择器会等待返回的 Promise，因此两个
   * 分支都返回一个。
   */
  function openWorkspace(this: unknown, workspaceId: string, beforeOpen?: BeforeOpen, options?: EntryOptions): Promise<void> | undefined {
    if (workspaceId !== NO_WORKSPACE_OPTION_ID) {
      startEpoch += 1
      return originalOpenWorkspace?.apply(this ?? service, [workspaceId, beforeOpen, options]) as Promise<void> | undefined
    }
    // 在已处于工作区时选择“不在工作区中”是无操作。
    if (inFlight.size === 0 && currentNewConversation(ctx) === 'standalone') return Promise.resolve()
    return startStandalone(undefined, beforeOpen)
  }

  ctx.effect(
    () => {
      service.startSession = startSession as UiWorkspace['startSession']
      if (wrapsOpenWorkspace) service.openWorkspace = openWorkspace as NonNullable<UiWorkspace['openWorkspace']>
      return () => {
        disposed = true
        lifetime.abort()
        inFlight.clear()
        if (hadOwnStartSession) service.startSession = originalStartSession
        else delete (service as { startSession?: unknown }).startSession
        if (wrapsOpenWorkspace) {
          if (hadOwnOpenWorkspace) service.openWorkspace = originalOpenWorkspace
          else delete (service as { openWorkspace?: unknown }).openWorkspace
        }
      }
    },
    'no-workspace: wrap uiWorkspace startSession/openWorkspace',
  )

  return {
    wrapsOpenWorkspace,
    openOption: () => openWorkspace.call(service, NO_WORKSPACE_OPTION_ID, undefined, undefined),
  }
}
