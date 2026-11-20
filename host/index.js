import { mkdir, rmdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export default class NoWorkspace extends TypertRemoteService {
  static inject = ['typertGateway', 'sessionController']
  static Config = z.object({
    root: z.string().default('').description('自动会话目录的绝对路径。留空时使用当前 profile 下的 session-workspaces 目录。'),
  })

  constructor(ctx, config = {}) {
    super(ctx, 'noWorkspace', { namespace: 'no-workspace' })
    this.configuredRoot = config.root ?? ''
  }

  async create(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        (request.agentPreset !== undefined && (typeof request.agentPreset !== 'string' || !request.agentPreset.trim()))) {
      throw new RemoteError('no-workspace/arguments-invalid', '新建会话参数无效。', {})
    }
    const profileDir = this.ctx.get('profileContext')?.dir ?? process.env.DSH_PROFILE_DIR
    const root = this.configuredRoot || (profileDir && path.join(profileDir, 'session-workspaces'))
    if (!root || !path.isAbsolute(root) || (process.platform === 'win32' && /^[\\/](?![\\/])/.test(root))) {
      throw new RemoteError('no-workspace/root-invalid', '请在插件配置中填写主机上的完整绝对路径。', {})
    }

    const sessionId = randomUUID()
    const cwd = path.join(root, `dsh-chat-${sessionId}`)
    try {
      await mkdir(root, { recursive: true, mode: 0o700 })
      await mkdir(cwd, { mode: 0o700 })
    } catch (error) {
      throw new RemoteError('no-workspace/mkdir-failed', `无法在 ${root} 创建会话目录。${error.message}`, { root })
    }

    try {
      const { peer, signal } = this.ctx.invocation
      const options = { sessionId, cwd }
      if (request.agentPreset !== undefined) options.agentPreset = request.agentPreset
      // Delegate with the original peer so DSH applies the native session/create policy.
      const session = await this.ctx.typertGateway.invoke({
        namespace: 'session', method: 'create', args: { request: options }, peer, signal,
      })
      return { sessionId: session.sessionId, cwd }
    } catch (error) {
      // rmdir can only remove the empty directory allocated by this request.
      try {
        await rmdir(cwd)
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') this.ctx.logger.warn('保留未能清理的会话目录', cwd, cleanupError.message)
      }
      throw error
    }
  }
}

// Apply the standard method decorator to this ESM entry without a build step.
const prototype = NoWorkspace.prototype
Remote(prototype.create, {
  kind: 'method', name: 'create', static: false, private: false,
  addInitializer(initialize) { initialize.call(Object.create(prototype)) },
})
