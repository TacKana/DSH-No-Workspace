/**
 * 此插件所交互的 DSH 服务的客户端侧形状。
 *
 * 这些是结构化声明，而非导入：客户端插件从 `ctx.get(...)` 接收
 * 实时服务对象，声明它们的包位于应用程序 bundle 内。此处的一切都刻意保持狭窄——
 * 仅包含此插件调用的成员——并且每个可选成员在使用前都会在运行时探测，
 * 因此 DSH 升级只会退化为警告，而不会崩溃。
 */

/** 取消一个订阅。 */
export interface Unsubscribe {
  (): void
}

/** 一个实时值加上变更通知（DSH 的可观察源形状）。 */
export interface Source<T> {
  getSnapshot(): T
  subscribe(listener: () => void): Unsubscribe
}

/** 工作区列表的一行。 */
export interface WorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
  createdAt: string
  updatedAt: string
}

/** 工作区列表的不可变快照。 */
export interface WorkspaceSnapshot {
  items: readonly WorkspaceView[]
  readonly [field: string]: unknown
}

/** 会话列表的一行。 */
export interface SessionSummary {
  sessionId?: string
  cwd?: string
  blank?: boolean
}

/** 会话列表的不可变快照。 */
export interface SessionListSnapshot {
  byId?: Readonly<Record<string, SessionSummary | undefined>>
}

/** 当前视图作用域中一个会话的绑定。 */
export interface SessionBinding {
  key?: string
  sessionId?: string
}

/** 原生“新对话”入口接受的草稿选项。 */
export interface DraftOptions {
  prompt?: string
  whenDraftExists?: 'keep' | 'replace'
  clearPreviousDraft?: boolean
}

/** `uiWorkspace.startSession` 接受的选项。 */
export interface StartSessionOptions extends DraftOptions {
  agentPreset?: string
  readonly [option: string]: unknown
}

/** 原生导航在会话发布之前调用的回调。 */
export interface BeforeOpen {
  (sessionId: string): void
}

/** `ctx.get('uiWorkspace')` */
export interface UiWorkspace {
  startSession(workspaceId?: string, options?: StartSessionOptions): unknown
  openSession(sessionId: string): void
  openWorkspace?(workspaceId: string, beforeOpen?: BeforeOpen, options?: StartSessionOptions): Promise<void> | void
  replaceMain?(sessionId: string, navigation: AbortSignal, mode: 'reveal', beforeOpen?: BeforeOpen): void
  notify?(notice: { kind: string; message: string }): void
  /** 原生启动恢复所拥有的导航（当有恢复正在运行时）。 */
  restorationNavigation?: AbortSignal
}

/** `ctx.get('workspaces')` */
export interface Workspaces {
  list: Source<WorkspaceSnapshot>
}

/** `ctx.get('sessions')` */
export interface Sessions {
  list: Source<SessionListSnapshot>
  binding(sessionId: string): SessionBinding | undefined
}

/** 通过会话作用域服务注册的描述符。 */
export interface SessionHookDescriptor {
  hooks: readonly string[]
  resolve(binding: SessionBinding | undefined): { hooks: { workspaces: Source<WorkspaceSnapshot> } }
}

/** `ctx.get('uiSession')` */
export interface UiSession {
  adapter: { current: Source<SessionBinding | undefined> }
  provide(descriptor: SessionHookDescriptor): Unsubscribe
}

/** `ctx.get('connection')` */
export interface Connection {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown>
  }
}

/** `ctx.get('layout')` */
export interface Layout {
  beginNavigation(): AbortSignal
}

/** `ctx.get('conversation')` */
export interface Conversation {
  input: {
    focus(): void
    requestDraftInitialization(binding: SessionBinding, options: DraftOptions): string
  }
}

/** `ctx.get('locale')` */
export interface Locale {
  register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): Unsubscribe
  bind(namespace: string): (key: string) => string | undefined
  getLocale(): { revision: number }
  subscribe(listener: () => void): Unsubscribe
}

/** 客户端入口所用插件上下文的子集。 */
export interface ClientContext {
  get(name: string): unknown
  effect(dispose: () => Unsubscribe | void, label?: string): void
}

/** 从注册在 `window.__ModuleLoader__` 上的惰性工厂返回。 */
export interface ClientModule {
  inject: readonly string[]
  apply(ctx: ClientContext): void
}

/** DSH 外壳在加载插件之前安装的浏览器侧模块注册表。 */
export interface ModuleLoader {
  load(definition: { id: string; factory: () => ClientModule }): void
}
