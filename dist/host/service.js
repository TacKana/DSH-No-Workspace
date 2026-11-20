import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { Config } from './config.js';
import { argumentsInvalid, mkdirFailed, rootInvalid } from './errors.js';
import { allocate, createDirectory, discardDirectory, resolveRoot } from './paths.js';
/**
 * no-workspace 插件的 Host 半边。
 *
 * 它只承担一项职责：为未经 Workspace 启动的会话预留一个私有目录，
 * 然后通过*原生*的 `session/create` 网关方法创建 Session，
 * 并把该目录作为其 `cwd` —— 绝不使用 `workspaceId`，
 * 从而保持 Workspace 注册表不变，让该会话始终出现在 "未分组" 之下。
 */
export default class NoWorkspaceService extends TypertRemoteService {
    static inject = ['typertGateway', 'sessionController'];
    static Config = Config;
    configuredRoot;
    constructor(ctx, config = {}) {
        super(ctx, 'noWorkspace', { namespace: 'no-workspace' });
        this.configuredRoot = config.root ?? '';
    }
    /**
     * 创建一个独立会话。
     * @param request - 来自网关的不可信载荷。
     * @returns 新的 SessionId 以及与其绑定的目录。
     */
    async create(request) {
        const parsed = parseRequest(request);
        const profileDir = this.profileDirectory();
        const root = resolveRoot(this.configuredRoot, profileDir);
        if (root === undefined)
            throw rootInvalid();
        const allocation = allocate(root);
        try {
            await createDirectory(allocation, root);
        }
        catch (error) {
            throw mkdirFailed(root, error);
        }
        try {
            const { peer, signal } = this.ctx.invocation;
            const session = await this.ctx.typertGateway.invoke({
                namespace: 'session',
                method: 'create',
                args: {
                    request: parsed.agentPreset === undefined
                        ? { sessionId: allocation.sessionId, cwd: allocation.cwd }
                        : { sessionId: allocation.sessionId, cwd: allocation.cwd, agentPreset: parsed.agentPreset },
                },
                // 使用原始 peer 委托调用，可保留 DSH 自身 `session/create`
                // 的策略与访问控制。
                peer,
                signal,
            });
            if (typeof session?.sessionId !== 'string' || session.sessionId.length === 0) {
                throw new Error('session/create returned no sessionId');
            }
            return { sessionId: session.sessionId, cwd: allocation.cwd };
        }
        catch (error) {
            await discardDirectory(allocation.cwd, this.ctx.logger.warn.bind(this.ctx.logger));
            throw error;
        }
    }
    /** 由启动器提供的 profile 目录（当本进程运行在其下时）。 */
    profileDirectory() {
        const profile = this.ctx.get('profileContext');
        if (profile !== undefined && typeof profile.dir === 'string' && profile.dir.length > 0)
            return profile.dir;
        const fromEnvironment = process.env['DSH_PROFILE_DIR'];
        return fromEnvironment !== undefined && fromEnvironment.length > 0 ? fromEnvironment : undefined;
    }
}
/**
 * 校验网关转发过来的载荷。
 * 网关已对外层 `request` 对象做过类型检查，但 Remote 方法
 * 也可能被其它 peer 触达，因此这里在创建目录之前
 * 再次检查请求体。
 */
function parseRequest(raw) {
    if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw argumentsInvalid();
    const candidate = raw;
    const preset = candidate.agentPreset;
    if (preset === undefined)
        return {};
    if (typeof preset !== 'string' || preset.trim().length === 0)
        throw argumentsInvalid();
    return { agentPreset: preset };
}
