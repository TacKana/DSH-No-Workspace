/**
 * 为 Host 入口所导入的两个 DSH 包提供环境声明。
 *
 * 两者都随附真正的 `.d.ts` 文件，但它们位于已安装的
 * 应用归档（`resources/app.asar/dsh/node_modules/...`）之内，该路径
 * 既不是 TypeScript 能遍历的目录，也不是 npm 能安装的路径。这些
 * 声明恰好覆盖本插件所用的接口；运行时导入保持不变，因此 DSH 中
 * 的形状变化会表现为运行时警告，而不是静默地变成错误类型。
 */

declare module '@deepseek-ai/schemastery' {
  /** 不透明的 schema 句柄；此处只有标识和推断出的值类型有意义。 */
  export interface Schema<T> {
    readonly '~type'?: T
  }

  export interface StringSchema extends Schema<string> {
    default(value: string): StringSchema
    description(text: string): StringSchema
  }

  export interface ObjectSchema<T> extends Schema<T> {
    description(text: string): ObjectSchema<T>
  }

  export interface Schemastery {
    string(): StringSchema
    object<T extends Record<string, unknown>>(shape: {
      [K in keyof T]: Schema<T[K]>
    }): ObjectSchema<T>
  }

  const z: Schemastery
  export default z
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  /** 由 Remote 方法抛出的失败；网关会原样转发 `code`。 */
  export class RemoteError extends Error {
    constructor(code: string, message: string, details?: Record<string, unknown>)
    readonly code: string
    readonly details: Record<string, unknown>
  }

  /** 一次网关调用的响应信封。 */
  export type RemoteResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }

  /** 针对一个带类型的 Remote 方法的网关请求。 */
  export interface TypertInvokeRequest {
    namespace: string
    method: string
    args: { request: Record<string, unknown> }
    /** 原始调用的 peer，以便 DSH 应用其自身的策略。 */
    peer: unknown
    signal: AbortSignal
  }

  export interface TypertGateway {
    invoke<T = unknown>(request: TypertInvokeRequest): Promise<T>
  }

  /** 本插件所依赖的 Host 上下文接口面。 */
  export interface HostContext {
    get(name: string): unknown
    readonly logger: { warn(message: string, ...args: unknown[]): void }
    readonly invocation: { peer: unknown; signal: AbortSignal }
    readonly typertGateway: TypertGateway
  }

  export abstract class TypertRemoteService {
    constructor(ctx: HostContext, name: string, options: { namespace: string })
    protected readonly ctx: HostContext
  }

  /** 手动（免构建）应用装饰器时所接受的装饰器上下文形状。 */
  export interface RemoteDecoratorContext {
    kind: 'method'
    name: string
    static: boolean
    private: boolean
    addInitializer(initializer: (this: object) => void): void
  }

  export function Remote<T extends object>(target: T, context: RemoteDecoratorContext): T | void
}

declare module '@deepseek-ai/dsh-app-boot' {
  /** 启动器拥有的 profile 信息（`ctx.profileContext`）。 */
  export interface ProfileContext {
    readonly name: string
    readonly dir: string
    readonly patchPath: string
    readonly installAnchor: string
    readonly cwd: string
    readonly home: string
  }
}
