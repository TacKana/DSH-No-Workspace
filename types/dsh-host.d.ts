/**
 * Ambient declarations for the two DSH packages the Host entry imports.
 *
 * Both ship real `.d.ts` files, but they live inside the installed
 * application archive (`resources/app.asar/dsh/node_modules/...`), which is
 * neither a directory TypeScript can walk nor a path npm can install. These
 * declarations cover exactly the surface this plugin uses; the runtime import
 * is unchanged, so a shape change in DSH surfaces as a runtime warning rather
 * than a silently wrong type.
 */

declare module '@deepseek-ai/schemastery' {
  /** Opaque schema handle; only identity and the inferred value type matter here. */
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
  /** Failure raised by a Remote method; the gateway forwards `code` verbatim. */
  export class RemoteError extends Error {
    constructor(code: string, message: string, details?: Record<string, unknown>)
    readonly code: string
    readonly details: Record<string, unknown>
  }

  /** Response envelope of one gateway call. */
  export type RemoteResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }

  /** Gateway request for one typed Remote method. */
  export interface TypertInvokeRequest {
    namespace: string
    method: string
    args: { request: Record<string, unknown> }
    /** Peer of the original invocation, so DSH applies its own policy. */
    peer: unknown
    signal: AbortSignal
  }

  export interface TypertGateway {
    invoke<T = unknown>(request: TypertInvokeRequest): Promise<T>
  }

  /** Host context surface this plugin relies on. */
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

  /** Decorator context shape accepted by the manual (build-free) application. */
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
  /** Launcher-owned profile facts (`ctx.profileContext`). */
  export interface ProfileContext {
    readonly name: string
    readonly dir: string
    readonly patchPath: string
    readonly installAnchor: string
    readonly cwd: string
    readonly home: string
  }
}
