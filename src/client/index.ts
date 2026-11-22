import type { ClientContext, ClientModule, ModuleLoader } from './types.js'
import { createText, registerDictionaries } from './locale.js'
import { installNavigation } from './navigation.js'
import { installPickerFooterAction } from './picker-menu.js'
import {
  locale as localeService,
  sessions as sessionsService,
  uiSession as uiSessionService,
  uiWorkspace as uiWorkspaceService,
  workspaces as workspacesService,
} from './services.js'
import { installWorkspacePickerView } from './workspace-view.js'

/** 外壳用来标识此插件的 Id；它必须与包名一致。 */
const PACKAGE_ID = 'dsh-no-workspace'

/** 在 {@link apply} 运行之前必须就绪的服务。 */
const inject = ['uiWorkspace', 'connection', 'sessions', 'uiSession', 'workspaces', 'locale'] as const

/** 构建选择器操作在创建失败时使用的通知通道。 */
function noticeChannel(ctx: ClientContext): ((error: unknown) => void) | undefined {
  const service = uiWorkspaceService(ctx)
  if (service === undefined || typeof service.notify !== 'function') return undefined
  return (error: unknown) => {
    const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
    const code = typeof record['code'] === 'string' ? record['code'] : undefined
    const message = typeof record['message'] === 'string' && record['message'].length > 0 ? record['message'] : String(error)
    try {
      service.notify?.({ kind: 'createFailed', message: code === undefined ? message : `${code}: ${message}` })
    } catch {
      // 通知通道是尽力而为的
    }
  }
}

/** 将插件接入一个 Client 上下文。 */
function apply(ctx: ClientContext): void {
  const navigation = installNavigation(ctx)
  if (navigation === undefined) return

  // Hero 芯片为插件自己的空白会话显示此标签，因此原始 `dsh-chat-<uuid>`
  // 文件夹名永远不会呈现给读者。
  ctx.effect(
    () => registerDictionaries(localeService(ctx)),
    'no-workspace: locale dictionaries',
  )
  const text = createText(localeService(ctx))

  // 对于未分组的会话，Hero 编写器保持不活动，因为没有工作区列出它。
  // 在不触及 Host 列表或真实选择器的情况下，为这些会话（且仅那些）提供一个
  // 本地工作区行。
  const uiSession = uiSessionService(ctx)
  const workspaces = workspacesService(ctx)
  const sessions = sessionsService(ctx)
  if (uiSession !== undefined && workspaces !== undefined && sessions !== undefined) {
    ctx.effect(
      () => installWorkspacePickerView(uiSession, workspaces, sessions, text),
      'no-workspace: conversation workspace view',
    )
    // Hero 选择器的菜单传送到文档 body，并且仅根据原生添加操作构建其页脚，
    // 因此额外的操作被镜像到那个已打开的菜单中，而不是工作区快照。
    if (navigation.wrapsOpenWorkspace) {
      ctx.effect(
        () =>
          installPickerFooterAction({
            text,
            chooseNotInWorkspace: () => navigation.openOption(),
            conversationNotice: () => noticeChannel(ctx),
          }),
        'no-workspace: picker footer action',
      )
    }
  }
}

const module: ClientModule = { inject, apply }

const loader = (window as unknown as { __ModuleLoader__?: ModuleLoader }).__ModuleLoader__
if (loader !== undefined) loader.load({ id: PACKAGE_ID, factory: () => module })
