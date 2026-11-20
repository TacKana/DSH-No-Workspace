import type {
  BeforeOpen,
  ClientContext,
  DraftOptions,
  Layout,
  SessionBinding,
  StartSessionOptions,
  UiWorkspace,
} from './types.js'
import { NO_WORKSPACE_OPTION_ID } from './options.js'
import { conversation as conversationService, layout as layoutService, sessions as sessionsService } from './services.js'
import { currentNewConversation } from './sessions.js'
import { createUngroupedSession, type CreatedSession } from './standalone.js'

/** Options accepted by the two wrapped entry points; callers are untyped. */
type EntryOptions = StartSessionOptions | undefined

/** Whether the caller asked the blank Session to adopt initial content. */
export function wantsDraftInitialization(draftOptions: DraftOptions | undefined): boolean {
  if (draftOptions === undefined) return false
  return (
    draftOptions.prompt !== undefined ||
    (draftOptions.whenDraftExists ?? (draftOptions.clearPreviousDraft === true ? 'replace' : 'keep')) === 'replace'
  )
}

/** What the picker action needs from this entry. */
export interface NavigationHandle {
  /** The native service exposes `openWorkspace`, so the picker can be extended. */
  wrapsOpenWorkspace: boolean
  /** Start a standalone conversation as if the picker sentinel had been chosen. */
  openOption(): Promise<void> | undefined
}

/**
 * Take over the native "new conversation" entry points.
 *
 * `startSession` is the single entry behind the global New Session button, the
 * built-in shortcut and the Workspace rows; `openWorkspace` is what the Hero
 * picker calls when a Workspace row is chosen. Both keep the native behaviour
 * whenever the caller named something explicit, and only an unnamed new
 * conversation is redirected into a private directory.
 * @param ctx - client plugin context.
 * @returns the picker hook, or `undefined` when the service is unavailable.
 */
export function installNavigation(ctx: ClientContext): NavigationHandle | undefined {
  const resolved = ctx.get('uiWorkspace') as UiWorkspace | undefined
  if (resolved === undefined || typeof resolved.startSession !== 'function') {
    console.warn('no-workspace: uiWorkspace.startSession is unavailable; client entry skipped')
    return undefined
  }
  const service: UiWorkspace = resolved

  // Remember whether the wrapped methods were own properties so disposal can put
  // the object back exactly as it was (normally they live on the prototype).
  const hadOwnStartSession = Object.prototype.hasOwnProperty.call(service, 'startSession')
  const originalStartSession = service.startSession
  const hadOwnOpenWorkspace = Object.prototype.hasOwnProperty.call(service, 'openWorkspace')
  const originalOpenWorkspace = service.openWorkspace
  const wrapsOpenWorkspace = typeof originalOpenWorkspace === 'function'

  const lifetime = new AbortController()
  /** preset key -> in-flight creation, so a repeated click shares one request. */
  const inFlight = new Map<string, Promise<CreatedSession>>()
  let disposed = false
  /** Monotonic marker so a later navigation supersedes an in-flight creation. */
  let startEpoch = 0

  const requestSession = (agentPreset: string | undefined): Promise<CreatedSession> => {
    const key = agentPreset === undefined ? '' : `preset:${agentPreset}`
    const pending = inFlight.get(key)
    if (pending !== undefined) return pending
    const created = createUngroupedSession(ctx, agentPreset, lifetime.signal).finally(() => {
      if (inFlight.get(key) === created) inFlight.delete(key)
    })
    inFlight.set(key, created)
    return created
  }

  /**
   * Surface a failure through the notice channel the native flow uses
   * (`toast.createFailed`). Guarded: the channel is an implementation detail of
   * ui-workspace, so an absent one only logs.
   */
  const reportFailure = (error: unknown): void => {
    const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
    const code = typeof record['code'] === 'string' ? record['code'] : undefined
    const message = typeof record['message'] === 'string' && record['message'].length > 0 ? record['message'] : String(error)
    if (typeof service.notify === 'function') {
      try {
        service.notify({ kind: 'createFailed', message: code === undefined ? message : `${code}: ${message}` })
      } catch {
        // the notice channel is best-effort
      }
    }
    console.warn('no-workspace: new conversation failed:', error)
  }

  /**
   * Move the caret into the composer of the Session that just became the main
   * view. Best-effort: the conversation service is an implementation detail and
   * may lag one frame behind, so the call is retried a few times.
   */
  function focusComposer(attempts = 12): void {
    try {
      // `input.focus` is the shell's public focus hook; guard the shape because
      // the conversation service is an implementation detail that may lag.
      const input = conversationService(ctx)?.input as { focus?: () => void } | undefined
      if (typeof input?.focus === 'function') input.focus()
    } catch (error) {
      console.warn('no-workspace: focusing the composer failed:', error)
    }
    if (attempts > 1) {
      const timer: unknown = setTimeout(() => {
        if (!disposed) focusComposer(attempts - 1)
      }, 120)
      const maybeNodeTimer = timer as { unref?: () => void }
      if (typeof maybeNodeTimer.unref === 'function') maybeNodeTimer.unref()
    }
  }

  /** Apply the same draft options the native implementation would. */
  const applyDraft = (sessionId: string, draftOptions: DraftOptions | undefined): void => {
    if (draftOptions === undefined) return
    try {
      const sessions = sessionsService(ctx)
      const conversation = conversationService(ctx)
      const binding: SessionBinding | undefined = sessions?.binding(sessionId)
      if (conversation === undefined || binding === undefined) {
        throw new Error('draft initialization services are unavailable')
      }
      const outcome = conversation.input.requestDraftInitialization(binding, draftOptions)
      if (outcome === 'blocked') throw new Error('the draft is blocked by a pending submission')
    } catch (error) {
      console.warn('no-workspace: draft initialization failed:', error)
    }
  }

  /**
   * Create and open one standalone Session, honouring draft options and the
   * start-up restore race. Shared by the native New Session entries and the
   * "not in a workspace" picker action.
   */
  function startStandalone(options: EntryOptions, migrate?: BeforeOpen): Promise<void> | undefined {
    const { agentPreset, ...draftOptions } = options ?? {}
    const initializeDraft = wantsDraftInitialization(options === undefined ? undefined : draftOptions)
    const epoch = ++startEpoch

    // The native initial restore is allowed to lose against a user creation; a
    // later navigation still wins. Record whether a restore had already claimed
    // the stage when the user asked for the Session.
    const restorationAtStart = service.restorationNavigation

    // Starting a navigation cancels the previous pending one, as the native
    // flow does in openWorkspaceSession.
    const layout: Layout | undefined = layoutService(ctx) ?? undefined
    const navigation = typeof layout?.beginNavigation === 'function' ? layout.beginNavigation() : lifetime.signal

    return requestSession(agentPreset)
      .then(({ sessionId }) => {
        if (disposed || epoch !== startEpoch) return
        let activeNavigation = navigation
        if (activeNavigation.aborted) {
          // The only start-up race this plugin tolerates: the native initial
          // restoration calls beginNavigation() after the user already asked for
          // a Session, aborting the user's signal. A restore that had not started
          // when the user clicked must yield; a genuine later switch still wins.
          const restoration = service.restorationNavigation
          const initialRestoreTookOver = restorationAtStart === undefined && restoration !== undefined && !restoration.aborted
          if (!initialRestoreTookOver) return
          // Abort that restore's navigation and open the user's Session with the
          // fresh navigation signal.
          activeNavigation = layout!.beginNavigation()
        }
        const beforeOpen: BeforeOpen | undefined =
          initializeDraft || migrate !== undefined
            ? (id: string) => {
                if (migrate !== undefined) {
                  try {
                    migrate(id)
                  } catch (error) {
                    console.warn('no-workspace: draft migration failed:', error)
                  }
                }
                if (initializeDraft) applyDraft(id, draftOptions)
              }
            : undefined
        // `replaceMain` is the native primitive behind openWorkspaceSession: it
        // retains the Session, applies the draft before publishing the selection,
        // and yields to a later navigation via the signal.
        if (typeof service.replaceMain === 'function') {
          service.replaceMain(sessionId, activeNavigation, 'reveal', beforeOpen)
        } else {
          beforeOpen?.(sessionId)
          service.openSession(sessionId)
        }
        // `replaceMain` publishes the selection without moving focus, so a chat
        // started from a menu would leave the caret outside the composer.
        if (!initializeDraft) focusComposer()
      })
      .catch((error: unknown) => {
        const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
        if (!disposed && epoch === startEpoch && name !== 'AbortError') reportFailure(error)
      })
  }

  /**
   * Replacement for `uiWorkspace.startSession`.
   * @param workspaceId - an explicit Workspace keeps the native flow.
   * @param options - draft initialization options and `agentPreset`.
   */
  function startSession(this: unknown, workspaceId?: string, options?: EntryOptions): unknown {
    if (workspaceId !== undefined) {
      // Any startSession call (explicit Workspace or standalone) supersedes a
      // still-pending creation from an earlier click.
      startEpoch += 1
      return originalStartSession.apply(this ?? service, [workspaceId, options])
    }

    // Already a brand-new conversation: pressing New Session again must not
    // create another directory. The standalone blank Session is kept as is, and
    // for a Workspace blank Session the native flow reuses that Session.
    // A creation still in flight is allowed to finish and open instead.
    if (!wantsDraftInitialization(options) && inFlight.size === 0) {
      const existing = currentNewConversation(ctx)
      if (existing === 'standalone') return undefined
      if (existing === 'workspace') {
        startEpoch += 1
        return originalStartSession.apply(this ?? service, [workspaceId, options])
      }
    }

    return startStandalone(options)
  }

  /**
   * Replacement for `uiWorkspace.openWorkspace`. A real Workspace id keeps the
   * native flow; the synthetic "not in a workspace" row starts a standalone
   * conversation instead. The Hero picker awaits the returned Promise, so both
   * branches return one.
   */
  function openWorkspace(this: unknown, workspaceId: string, beforeOpen?: BeforeOpen, options?: EntryOptions): Promise<void> | undefined {
    if (workspaceId !== NO_WORKSPACE_OPTION_ID) {
      startEpoch += 1
      return originalOpenWorkspace?.apply(this ?? service, [workspaceId, beforeOpen, options]) as Promise<void> | undefined
    }
    // Choosing "not in a workspace" while already in one is a no-op.
    if (inFlight.size === 0 && currentNewConversation(ctx) === 'standalone') return Promise.resolve()
    return startStandalone(undefined, beforeOpen)
  }

  ctx.effect(
    () => {
      service.startSession = startSession as UiWorkspace['startSession']
      if (wrapsOpenWorkspace) service.openWorkspace = openWorkspace as NonNullable<UiWorkspace['openWorkspace']>
      return () => {
        disposed = true
        lifetime.abort()
        inFlight.clear()
        if (hadOwnStartSession) service.startSession = originalStartSession
        else delete (service as { startSession?: unknown }).startSession
        if (wrapsOpenWorkspace) {
          if (hadOwnOpenWorkspace) service.openWorkspace = originalOpenWorkspace
          else delete (service as { openWorkspace?: unknown }).openWorkspace
        }
      }
    },
    'no-workspace: wrap uiWorkspace startSession/openWorkspace',
  )

  return {
    wrapsOpenWorkspace,
    openOption: () => openWorkspace.call(service, NO_WORKSPACE_OPTION_ID, undefined, undefined),
  }
}
