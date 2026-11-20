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

/** Id the shell uses for this plugin; it must equal the package name. */
const PACKAGE_ID = '@local/dsh-no-workspace'

/** Services that must be ready before {@link apply} runs. */
const inject = ['uiWorkspace', 'connection', 'sessions', 'uiSession', 'workspaces', 'locale'] as const

/** Build the notice channel the picker action uses when creating fails. */
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
      // the notice channel is best-effort
    }
  }
}

/** Wire the plugin into one Client context. */
function apply(ctx: ClientContext): void {
  const navigation = installNavigation(ctx)
  if (navigation === undefined) return

  // The Hero chip shows this label for the plugin's own blank Sessions, so the
  // raw `dsh-chat-<uuid>` folder name never reaches the reader.
  ctx.effect(
    () => registerDictionaries(localeService(ctx)),
    'no-workspace: locale dictionaries',
  )
  const text = createText(localeService(ctx))

  // The Hero composer stays inert for an ungrouped Session because no Workspace
  // lists it. Give those Sessions (and only those) a local Workspace row without
  // touching the Host list or the real picker.
  const uiSession = uiSessionService(ctx)
  const workspaces = workspacesService(ctx)
  const sessions = sessionsService(ctx)
  if (uiSession !== undefined && workspaces !== undefined && sessions !== undefined) {
    ctx.effect(
      () => installWorkspacePickerView(uiSession, workspaces, sessions, text),
      'no-workspace: conversation workspace view',
    )
    // The Hero picker's menu portals to the document body and builds its footer
    // only from the native add action, so the extra action is mirrored into that
    // open menu instead of the Workspace snapshot.
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
