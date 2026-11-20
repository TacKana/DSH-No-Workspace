import type {
  ClientContext,
  Connection,
  Conversation,
  Layout,
  Locale,
  Sessions,
  UiSession,
  UiWorkspace,
  Workspaces,
} from './types.js'

/**
 * 读取一个服务，但不假设它存在。
 * 对于插件 `inject` 列表之外的服务，`ctx.get` 返回 `undefined`，
 * 这也是重命名后经过加固的构建所呈现的样子。
 */
export function service<T>(ctx: ClientContext, name: string): T | undefined {
  const value = ctx.get(name)
  return value === undefined || value === null ? undefined : (value as T)
}

export function uiWorkspace(ctx: ClientContext): UiWorkspace | undefined {
  const value = service<UiWorkspace>(ctx, 'uiWorkspace')
  return value !== undefined && typeof value.startSession === 'function' ? value : undefined
}

export function uiSession(ctx: ClientContext): UiSession | undefined {
  const value = service<UiSession>(ctx, 'uiSession')
  return value !== undefined && value.adapter !== undefined && value.adapter.current !== undefined ? value : undefined
}

export function workspaces(ctx: ClientContext): Workspaces | undefined {
  const value = service<Workspaces>(ctx, 'workspaces')
  return value !== undefined && value.list !== undefined ? value : undefined
}

export function sessions(ctx: ClientContext): Sessions | undefined {
  const value = service<Sessions>(ctx, 'sessions')
  return value !== undefined && value.list !== undefined ? value : undefined
}

export function connection(ctx: ClientContext): Connection | undefined {
  const value = service<Connection>(ctx, 'connection')
  return value !== undefined && value.rpc !== undefined && typeof value.rpc.call === 'function' ? value : undefined
}

export function layout(ctx: ClientContext): Layout | undefined {
  const value = service<Layout>(ctx, 'layout')
  return value !== undefined && typeof value.beginNavigation === 'function' ? value : undefined
}

export function conversation(ctx: ClientContext): Conversation | undefined {
  const value = service<Conversation>(ctx, 'conversation')
  return value !== undefined && value.input !== undefined ? value : undefined
}

export function locale(ctx: ClientContext): Locale | undefined {
  const value = service<Locale>(ctx, 'locale')
  return value !== undefined && typeof value.register === 'function' && typeof value.bind === 'function'
    ? value
    : undefined
}

/** 读取一个较旧 DSH 构建可能未实现的成员。 */
export function supports<T extends object, K extends keyof T>(value: T, member: K): boolean {
  return typeof value[member] === 'function'
}
