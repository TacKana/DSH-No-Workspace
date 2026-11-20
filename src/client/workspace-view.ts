import type { Sessions, UiSession, WorkspaceSnapshot, Workspaces, WorkspaceView } from './types.js'
import { isStandaloneSession, settlePending, clearPending } from './identity.js'
import type { Text } from './locale.js'
import { noWorkspaceOption } from './options.js'
import { cwdOf, identityOf, summaryOf } from './sessions.js'

/** At most one entry per recently seen Session identity and directory. */
const MAX_SOURCES = 16

/** One derived Session-scope view of the Workspace list. */
interface View {
  list: WorkspaceSnapshot | undefined
  row: WorkspaceView | undefined
  snapshot: WorkspaceSnapshot | undefined
}

/** The observable shape handed to the Session-scope hook. */
interface ShadowSource {
  getSnapshot(): WorkspaceSnapshot
  subscribe(listener: () => void): () => void
}

/**
 * Shadow the standard `useWorkspaces` hook at Session scope so a conversation
 * sees the real Workspace list plus one extra row naming this plugin's own
 * automatic directory.
 *
 * `ConversationContent` disables the Hero composer exactly when no Workspace
 * lists the Session and the list is ready, so that row is what gives a blank
 * standalone Session a title (不在工作区中工作). The Host list, the sidebar and
 * the picker's own data are never modified, and dropping the provider on unload
 * restores the untouched root view.
 * @param uiSession - Session-scope service (`ctx.get('uiSession')`).
 * @param workspaces - Workspace controller (`ctx.get('workspaces')`).
 * @param sessions - Session controller (`ctx.get('sessions')`).
 * @param text - localized labels and the revision that changes them.
 * @returns plugin teardown.
 */
export function installWorkspacePickerView(
  uiSession: UiSession,
  workspaces: Workspaces,
  sessions: Sessions,
  text: Text,
): () => void {
  const current = uiSession.adapter.current
  const sources = new Map<string, ShadowSource>()

  /** A view of the root list, with one extra row for the plugin's own Session. */
  function build(sessionId: string, standalone: boolean, title: string): ShadowSource {
    const entry: View = { list: undefined, row: undefined, snapshot: undefined }
    return {
      getSnapshot(): WorkspaceSnapshot {
        // A conversation inside a real Workspace reads the untouched root list;
        // the menu action for leaving it is mirrored into the menu's own DOM.
        if (!standalone) return workspaces.list.getSnapshot()
        const list = workspaces.list.getSnapshot()
        if (entry.list === list && entry.snapshot !== undefined) return entry.snapshot
        entry.list = list
        entry.row ??= noWorkspaceOption(sessionId, title)
        entry.snapshot = { ...list, items: [...list.items, entry.row] }
        return entry.snapshot
      },
      subscribe(listener: () => void): () => void {
        const offList = workspaces.list.subscribe(listener)
        const offSessions = sessions.list.subscribe(listener)
        const offText = text.subscribe(listener)
        return () => {
          offList()
          offSessions()
          offText?.()
        }
      },
    }
  }

  /** Source handed to one Session binding; the root list outside one. */
  const sourceFor = (rawSessionId: string | undefined) => {
    const sessionId = rawSessionId !== undefined && rawSessionId.length > 0 ? rawSessionId : undefined
    // No conversation selected: hand out the root list untouched.
    if (sessionId === undefined) return workspaces.list
    const cwd = cwdOf(sessions, sessionId)
    const standalone = isStandaloneSession(sessionId, cwd)
    const title = standalone ? text.label() : ''
    const key = `${sessionId}\u0000${cwd ?? ''}\u0000${String(standalone)}\u0000${title}\u0000${String(text.revision())}`
    const known = sources.get(key)
    if (known !== undefined) return known
    const source = build(sessionId, standalone, title)
    if (sources.size > MAX_SOURCES) sources.clear()
    sources.set(key, source)
    return source
  }

  let providerDispose: (() => void) | undefined
  let installingProvider = false
  const syncProvider = (): void => {
    const sessionId = identityOf(current.getSnapshot())
    // The summary caught up with the creation hand-off: drop it.
    if (sessionId !== undefined) settlePending(sessionId, summaryOf(sessions, sessionId)?.cwd)
    // A Session-scoped hook is declared for every Session binding at once, so
    // this contribution exists only while a conversation is selected. Outside
    // one (the cold Hero) the root provider must stay untouched, or the
    // declared-but-absent hook would shadow it with `undefined`.
    if (sessionId === undefined) {
      if (providerDispose !== undefined) {
        const dispose = providerDispose
        providerDispose = undefined
        dispose()
      }
      return
    }
    // Registering a descriptor rebuilds every binding and publishes the current
    // one, which re-enters this listener; the flag keeps that re-entry from
    // registering the same hook twice (a duplicate hook throws).
    if (providerDispose === undefined && !installingProvider) {
      installingProvider = true
      try {
        providerDispose = uiSession.provide({
          hooks: ['workspaces'],
          resolve: (binding) => ({ hooks: { workspaces: sourceFor(identityOf(binding)) } }),
        })
      } finally {
        installingProvider = false
      }
    }
  }

  const offCurrent = current.subscribe(syncProvider)
  const offSessions = sessions.list.subscribe(syncProvider)
  syncProvider()

  return () => {
    offCurrent()
    offSessions()
    if (providerDispose !== undefined) {
      const dispose = providerDispose
      providerDispose = undefined
      dispose()
    }
    sources.clear()
    clearPending()
  }
}
