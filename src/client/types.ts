/**
 * Client-facing shapes of the DSH services this plugin talks to.
 *
 * These are structural declarations, not imports: a client plugin receives the
 * live service objects from `ctx.get(...)`, and the packages that declare them
 * live inside the application bundle. Everything here is deliberately narrow —
 * only the members this plugin calls — and every optional member is probed at
 * runtime before use, so a DSH upgrade degrades into a warning instead of a
 * crash.
 */

/** Cancels one subscription. */
export interface Unsubscribe {
  (): void
}

/** A live value plus change notifications (DSH's observable source shape). */
export interface Source<T> {
  getSnapshot(): T
  subscribe(listener: () => void): Unsubscribe
}

/** One row of the Workspace list. */
export interface WorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
  createdAt: string
  updatedAt: string
}

/** Immutable snapshot of the Workspace list. */
export interface WorkspaceSnapshot {
  items: readonly WorkspaceView[]
  readonly [field: string]: unknown
}

/** One row of the Session list. */
export interface SessionSummary {
  sessionId?: string
  cwd?: string
  blank?: boolean
}

/** Immutable snapshot of the Session list. */
export interface SessionListSnapshot {
  byId?: Readonly<Record<string, SessionSummary | undefined>>
}

/** Binding of one Session in the current view scope. */
export interface SessionBinding {
  key?: string
  sessionId?: string
}

/** Draft options the native "new conversation" entry accepts. */
export interface DraftOptions {
  prompt?: string
  whenDraftExists?: 'keep' | 'replace'
  clearPreviousDraft?: boolean
}

/** Options accepted by `uiWorkspace.startSession`. */
export interface StartSessionOptions extends DraftOptions {
  agentPreset?: string
  readonly [option: string]: unknown
}

/** Callback invoked by the native navigation before the Session is published. */
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
  /** Navigation owned by the native start-up restore, when one is running. */
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

/** Descriptor registered through the Session-scope service. */
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

/** The subset of the plugin context used by the client entry. */
export interface ClientContext {
  get(name: string): unknown
  effect(dispose: () => Unsubscribe | void, label?: string): void
}

/** Returned from the lazy factory registered on `window.__ModuleLoader__`. */
export interface ClientModule {
  inject: readonly string[]
  apply(ctx: ClientContext): void
}

/** The browser-side module registry the DSH shell installs before loading plugins. */
export interface ModuleLoader {
  load(definition: { id: string; factory: () => ClientModule }): void
}
