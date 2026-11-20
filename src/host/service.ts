import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { HostContext } from '@deepseek-ai/dsh-typert-protocol'
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'

import { Config } from './config.js'
import type { NoWorkspaceConfig } from './config.js'
import { argumentsInvalid, mkdirFailed, rootInvalid } from './errors.js'
import { allocate, createDirectory, discardDirectory, resolveRoot } from './paths.js'

/** Request body of `no-workspace/create` (the gateway sends `{ request }`). */
export interface CreateRequest {
  agentPreset?: string
}

/** Value returned by `no-workspace/create`. */
export interface CreateResult {
  sessionId: string
  cwd: string
}

/**
 * Host half of the no-workspace plugin.
 *
 * It owns exactly one responsibility: reserve a private directory for a
 * conversation that was started without a Workspace, then create the Session
 * through the *native* `session/create` gateway method with that directory as
 * its `cwd` — never with a `workspaceId`, so the Workspace registry stays
 * untouched and the conversation keeps appearing under "未分组".
 */
export default class NoWorkspaceService extends TypertRemoteService {
  static inject = ['typertGateway', 'sessionController']

  static Config = Config

  private readonly configuredRoot: string

  constructor(ctx: HostContext, config: Partial<NoWorkspaceConfig> = {}) {
    super(ctx, 'noWorkspace', { namespace: 'no-workspace' })
    this.configuredRoot = config.root ?? ''
  }

  /**
   * Create one standalone conversation.
   * @param request - untrusted gateway payload.
   * @returns the new SessionId and the directory bound to it.
   */
  async create(request: unknown): Promise<CreateResult> {
    const parsed = parseRequest(request)
    const profileDir = this.profileDirectory()
    const root = resolveRoot(this.configuredRoot, profileDir)
    if (root === undefined) throw rootInvalid()

    const allocation = allocate(root)
    try {
      await createDirectory(allocation, root)
    } catch (error) {
      throw mkdirFailed(root, error)
    }

    try {
      const { peer, signal } = this.ctx.invocation
      const session = await this.ctx.typertGateway.invoke<{ sessionId?: unknown }>({
        namespace: 'session',
        method: 'create',
        args: {
          request: parsed.agentPreset === undefined
            ? { sessionId: allocation.sessionId, cwd: allocation.cwd }
            : { sessionId: allocation.sessionId, cwd: allocation.cwd, agentPreset: parsed.agentPreset },
        },
        // Delegating with the original peer keeps DSH's own `session/create`
        // policy and access control in force.
        peer,
        signal,
      })
      if (typeof session?.sessionId !== 'string' || session.sessionId.length === 0) {
        throw new Error('session/create returned no sessionId')
      }
      return { sessionId: session.sessionId, cwd: allocation.cwd }
    } catch (error) {
      await discardDirectory(allocation.cwd, this.ctx.logger.warn.bind(this.ctx.logger))
      throw error
    }
  }

  /** Launcher-provided profile directory, when this process runs under one. */
  private profileDirectory(): string | undefined {
    const profile = this.ctx.get('profileContext') as ProfileContext | undefined
    if (profile !== undefined && typeof profile.dir === 'string' && profile.dir.length > 0) return profile.dir
    const fromEnvironment = process.env['DSH_PROFILE_DIR']
    return fromEnvironment !== undefined && fromEnvironment.length > 0 ? fromEnvironment : undefined
  }
}

/**
 * Validate the payload the gateway forwards.
 * The gateway already type-checks the outer `request` object, but a Remote
 * method is reachable from other peers as well, so the body is re-checked here
 * before it can create a directory.
 */
function parseRequest(raw: unknown): CreateRequest {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw argumentsInvalid()
  const candidate = raw as { agentPreset?: unknown }
  const preset = candidate.agentPreset
  if (preset === undefined) return {}
  if (typeof preset !== 'string' || preset.trim().length === 0) throw argumentsInvalid()
  return { agentPreset: preset }
}
