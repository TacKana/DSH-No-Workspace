/**
 * @local/dsh-no-workspace — client entry.
 *
 * Makes the *native* New Session entry (the sidebar button and the built-in
 * `session.new` shortcut) start an ungrouped conversation without a Workspace
 * when the caller did not name an explicit Workspace.
 *
 * The native callers do not go through this plugin's UI: they hold the
 * `uiWorkspace` service object and call `service.startSession(...)` with a
 * dynamic property lookup, so wrapping that instance method intercepts every
 * existing entry without adding a button, a shortcut or an extra confirmation.
 *
 * Only one Host RPC exists:
 *   channel `/api`, endpoint `no-workspace/create`
 *   request  `{ args: { request: { agentPreset?: string } } }`
 *   response `{ ok: true, value: { sessionId, cwd } }`
 *          | `{ ok: false, error: { code, message, details? } }`
 *
 * Contract:
 * - `startSession(workspaceId, options)` with an explicit `workspaceId` is
 *   delegated unchanged to the original implementation.
 * - `startSession(undefined, options)` creates a fresh Host-owned directory and
 *   an ungrouped Session through the RPC, honours `agentPreset` and the same
 *   draft-initialisation options the original understands, and opens the new
 *   Session with the original navigation primitives (so concurrent navigation
 *   keeps its "latest wins" behaviour).
 * - Start-up race: when the user clicks before the native initial restoration
 *   has called `beginNavigation()`, that restoration would abort the click's
 *   navigation and leave a blank page. Such a restore is treated as stale once
 *   the user asks for a Session: the click takes a fresh navigation signal
 *   (aborting the restore) and still opens its Session. Any later switch still
 *   cancels the pending creation.
 * - The wrapper is installed inside `ctx.effect` and the original instance
 *   method is restored when the plugin fiber unloads.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-no-workspace',
  factory() {
    // Services are looked up with ctx.get() (a plain ctx.<name> read throws for
    // services outside the plugin's inject map).
    const inject = ['uiWorkspace', 'connection', 'sessions', 'uiSession', 'workspaces', 'locale']

    /** Directory name prefix the Host uses for one standalone conversation. */
    const STANDALONE_DIR_PREFIX = 'dsh-chat-'

    /** Locale namespace and dictionaries owned by this client entry. */
    const LOCALE_NS = 'no-workspace'
    const LOCALE_DICTS = {
      zh: {
        standalone: '不在工作区中工作',
        option: '不使用工作区',
      },
      en: {
        standalone: 'Not in a workspace',
        option: 'Use no workspace',
      },
    }
    /** Label used when the Client locale service is unavailable. */
    const FALLBACK_STANDALONE_LABEL = LOCALE_DICTS.zh.standalone
    /** Menu entry used when the Client locale service is unavailable. */
    const FALLBACK_OPTION_LABEL = LOCALE_DICTS.zh.option

    /**
     * Picker entry id for the "not in a workspace" choice. It is a stable
     * sentinel, never a real WorkspaceId: the wrapped `openWorkspace` answers it
     * by starting a standalone conversation instead of opening a Workspace.
     */
    const NO_WORKSPACE_OPTION_ID = 'no-workspace:standalone'

    /**
     * Icon for the picker's "not in a workspace" action. Any sprite id the app
     * ships works (`svg[data-icon="dsw-icon-…"]`); run `node test/icon-gallery.mjs`
     * to render a contact sheet of every available icon.
     */
    const NO_WORKSPACE_ICON = 'dsw-icon-close-outline-regular'

    /**
     * Cwd the Host returned for the Session this page created most recently.
     * It bridges the short window between creation and the Session summary
     * carrying `cwd`; it is replaced on every creation and dropped once the
     * summary reports the directory. After a refresh the directory name alone
     * identifies the Session, so nothing is persisted.
     * @type {{ sessionId: string, cwd: string } | undefined}
     */
    let pendingCreated

    /**
     * Leaf name of a Host path across both path separators.
     * @param {string} path - POSIX or Windows path.
     * @returns {string} the final segment ('' for an empty path).
     */
    function baseName(path) {
      if (typeof path !== 'string') return ''
      return path.split(/[\\/]+/).filter(Boolean).at(-1) ?? ''
    }

    /**
     * Whether a Session was created by this plugin. The Host pre-allocates a
     * UUID as the SessionId and names the fresh directory exactly
     * `dsh-chat-<uuid>`, so the cwd leaf must equal that name. The comparison
     * is exact (both path separators understood) and holds after a refresh or
     * on another device without extra metadata or an API.
     * @param {string | undefined} sessionId - Session identity.
     * @param {string | undefined} cwd - Session working directory.
     * @returns {boolean} whether the pair names a standalone conversation.
     */
    function isStandaloneSession(sessionId, cwd) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return false
      return baseName(cwd) === `${STANDALONE_DIR_PREFIX}${sessionId}`
    }

    /**
     * List-row summary the Client already published for one Session.
     * @param {object | undefined} sessions - Session controller.
     * @param {string | undefined} sessionId - Session identity.
     * @returns {object | undefined} the summary row, when the list has it.
     */
    function summaryOf(sessions, sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
      const list = sessions === undefined || sessions.list === undefined ? undefined : sessions.list.getSnapshot()
      const byId = list === undefined ? undefined : list.byId
      return byId === undefined ? undefined : byId[sessionId]
    }

    /**
     * Working directory of one Session, including the just-created hand-off.
     * @param {object | undefined} sessions - Session controller.
     * @param {string | undefined} sessionId - Session identity.
     * @returns {string | undefined} the directory, when known.
     */
    function cwdOf(sessions, sessionId) {
      if (pendingCreated !== undefined && pendingCreated.sessionId === sessionId) return pendingCreated.cwd
      const summary = summaryOf(sessions, sessionId)
      return summary === undefined ? undefined : summary.cwd
    }

    /**
     * The synthetic in-memory Workspace row for the "not in a workspace"
     * choice. It never enters the Host state or the real Workspace picker data:
     * the Hero chip and the picker read it from a session-scope hook shadow.
     * For this plugin's own Session it also owns that Session, so the chip
     * resolves a title and the picker marks the row as selected; in any other
     * conversation it is an unselected action row.
     * @param {string | undefined} sessionId - owning Session, when standalone.
     * @param {string} title - display title (no folder name is ever shown).
     * @returns {object} a WorkspaceView-shaped row.
     */
    function noWorkspaceOption(sessionId, title) {
      return {
        workspaceId: NO_WORKSPACE_OPTION_ID,
        path: '',
        title,
        sessionIds: sessionId === undefined ? [] : [sessionId],
        createdAt: '',
        updatedAt: '',
      }
    }

    /**
     * Add the "not in a workspace" action to the open Workspace menu, inside the
     * same footer group as the add action. The native menu builds its footer from
     * its own add entries and never reads the Workspace snapshot for it, so this
     * clones the live add row and inserts an equivalent row just before it.
     * Clicking it runs the wrapped `openWorkspace` sentinel path. Nothing is added
     * to the Workspace snapshot, so no other surface (sidebar, counts, palette)
     * can see the action.
     * @param {{ option: () => string, revision: () => number, subscribe: (fn: () => void) => (() => void) | undefined }} text
     *   localized menu label and the locale revision that changes it.
     * @param {() => void} chooseNotInWorkspace - runs the sentinel open.
     * @param {() => ((error: unknown) => void) | undefined} conversationNotice
     *   resolves the native failure notice used when the open rejects.
     * @returns {() => void} disposer.
     */
    function installPickerFooterAction(text, chooseNotInWorkspace, conversationNotice) {
      if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return () => {}
      const MARK = 'data-no-workspace-action'
      let observer = null
      let applying = false

      /** Adopt a cloned add row as the standalone action. */
      const adopt = (row, menu, label) => {
        const button = row.querySelector('button[role="menuitem"]')
        if (button === null) return
        // Reuse the cloned icon slot but point it at the "leave a project" glyph:
        // one plus (the add row) is enough, two read as "another new folder".
        for (const icon of row.querySelectorAll('[class*="itemIcon"] svg')) {
          icon.setAttribute('data-icon', NO_WORKSPACE_ICON)
          const use = icon.querySelector('use')
          if (use !== null) use.setAttribute('href', `#${NO_WORKSPACE_ICON}`)
        }
        button.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          // The Menu listens for Escape on the document and closes once.
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          try {
            Promise.resolve(chooseNotInWorkspace()).catch((error) => {
              console.warn('no-workspace: opening a standalone chat failed:', error)
              // The menu is already closed, so report through the normal channel.
              try {
                const notice = conversationNotice()
                if (notice !== undefined) notice(error)
              } catch {
                // the notice channel is best-effort
              }
            })
          } catch (error) {
            console.warn('no-workspace: opening a standalone chat failed:', error)
          }
        })
        const labelNode = row.querySelector('[class*="itemLabel"]')
        if (labelNode !== null) labelNode.textContent = label
      }

      /**
       * True only for the Workspace picker: it is not a context menu, it lists at
       * least one project, and its footer carries the add-folder action.
       */
      const isWorkspacePicker = (menu, footer) => {
        if (menu.closest('[data-context-menu]') !== null) return false
        if (menu.querySelector('svg[data-icon*="folder-close"]') === null) return false
        return [...footer.children].some(wrap => wrap.querySelector('svg[data-icon*="plus-outline"]') !== null)
      }

      /** Mirror the action into every open Workspace menu; idempotent per pass. */
      const apply = () => {
        if (applying) return
        applying = true
        // Ignore the mutations this pass performs; otherwise re-inserting a row
        // React re-rendered away would trigger the observer forever.
        if (observer !== null) observer.disconnect()
        try {
          const label = text.option()
          for (const menu of document.querySelectorAll('[role="menu"]')) {
            const footer = menu.querySelector('[role="presentation"][class*="footer"]')
            if (footer === null || !isWorkspacePicker(menu, footer)) continue
            const template = [...footer.children].find(wrap => wrap.querySelector('svg[data-icon*="plus-outline"]') !== null)
            if (template === undefined) continue
            const rows = footer.querySelectorAll(`[${MARK}]`)
            for (let index = 1; index < rows.length; index += 1) rows[index].remove()
            let row = footer.querySelector(`[${MARK}]`)
            if (row === null) {
              row = template.cloneNode(true)
              row.setAttribute(MARK, '1')
              for (const check of row.querySelectorAll('[class*="check"]')) check.remove()
              for (const button of row.querySelectorAll('button')) {
                for (const name of [...button.classList]) {
                  if (name.includes('selected')) button.classList.remove(name)
                }
              }
              adopt(row, menu, label)
              footer.insertBefore(row, template)
            } else {
              const labelNode = row.querySelector('[class*="itemLabel"]')
              if (labelNode !== null && labelNode.textContent !== label) labelNode.textContent = label
              if (row.nextElementSibling !== template) footer.insertBefore(row, template)
            }
          }
        } finally {
          if (observer !== null) {
            observer.observe(document.body, { childList: true, subtree: true, characterData: true })
          }
          applying = false
        }
      }

      apply()
      // Menus mount at the document body on open; only re-scan while one exists.
      observer = new MutationObserver(() => {
        if (document.querySelector('[role="menu"]') !== null) apply()
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      return () => {
        if (observer !== null) observer.disconnect()
        observer = null
      }
    }

    /**
     * Shadow the factory's standard `useWorkspaces` hook at Session scope so a
     * conversation sees the real Workspace list plus one extra row naming this
     * plugin's own automatic directory. `ConversationContent` disables the Hero
     * composer exactly when no Workspace lists the Session and the list is ready,
     * so that row gives the blank Session a title (不在工作区中工作). The Host
     * list, the sidebar, and the picker's own data are never modified, and
     * dropping the provider on unload restores the untouched root view.
     * @param {object} uiSession - Session scope service (`ctx.get('uiSession')`).
     * @param {object} workspaces - Workspace controller (`ctx.get('workspaces')`).
     * @param {object} sessions - Session controller (`ctx.get('sessions')`).
     * @param {{
     *   label: () => string,
     *   option: () => string,
     *   revision: () => number,
     *   subscribe: (fn: () => void) => (() => void) | undefined,
     * }} text - localized labels and the locale revision that changes them.
     * @returns {() => void} disposer.
     */
    function installWorkspacePickerView(uiSession, workspaces, sessions, text) {
      const current = uiSession.adapter.current
      /** Sources derived per Session; stale keys are cleared on growth. */
      const sources = new Map()

      const summaryCwdOf = (sessionId) => {
        const summary = summaryOf(sessions, sessionId)
        return summary === undefined ? undefined : summary.cwd
      }

      const sourceFor = (rawSessionId) => {
        const sessionId = typeof rawSessionId === 'string' && rawSessionId.length > 0 ? rawSessionId : undefined
        // No conversation selected: hand out the root list untouched.
        if (sessionId === undefined) return workspaces.list
        const cwd = cwdOf(sessions, sessionId)
        const standalone = sessionId !== undefined && isStandaloneSession(sessionId, cwd)
        const title = standalone ? text.label() : ''
        const revision = text.revision()
        const key = `${sessionId ?? ''}\u0000${cwd ?? ''}\u0000${standalone}\u0000${title}\u0000${revision}`
        const known = sources.get(key)
        if (known !== undefined) return known
        const entry = { list: undefined, row: undefined, snapshot: undefined }
        const source = {
          getSnapshot() {
            // A conversation inside a real Workspace reads the untouched root list;
            // the menu action for leaving it is mirrored into the menu's own DOM.
            if (!standalone) return workspaces.list.getSnapshot()
            const list = workspaces.list.getSnapshot()
            if (entry.list === list) return entry.snapshot
            entry.list = list
            const items = Array.isArray(list.items) ? list.items : []
            if (entry.row === undefined) entry.row = noWorkspaceOption(sessionId, title)
            entry.snapshot = { ...list, items: [...items, entry.row] }
            return entry.snapshot
          },
          subscribe(listener) {
            const offList = workspaces.list.subscribe(listener)
            const offSessions = sessions.list.subscribe(listener)
            const offLocale = text.subscribe(listener)
            return () => {
              offList()
              offSessions()
              if (typeof offLocale === 'function') offLocale()
            }
          },
        }
        if (sources.size > 16) sources.clear()
        sources.set(key, source)
        return source
      }

      let providerDispose
      let installingProvider = false
      const syncProvider = () => {
        const binding = current.getSnapshot()
        const identity = binding === undefined ? undefined : (binding.key ?? binding.sessionId)
        const sessionId = typeof identity === 'string' && identity.length > 0 ? identity : undefined
        // The summary caught up with the creation hand-off: drop it.
        if (pendingCreated !== undefined && pendingCreated.sessionId === sessionId
          && summaryCwdOf(sessionId) !== undefined) {
          pendingCreated = undefined
        }
        // A Session-scoped hook is declared for every Session binding at once, so
        // the contribution is only registered while a conversation is selected.
        // Outside one (the cold Hero) the root provider must stay untouched, or
        // the declared-but-absent hook would shadow it with `undefined`.
        if (sessionId === undefined) {
          if (providerDispose !== undefined) {
            const dispose = providerDispose
            providerDispose = undefined
            dispose()
          }
          return
        }
        // Registering a descriptor rebuilds every binding and publishes the
        // current one, which re-enters this listener; the flag keeps that
        // re-entry from registering the same hook twice (a duplicate hook throws).
        if (providerDispose === undefined && !installingProvider) {
          installingProvider = true
          try {
            providerDispose = uiSession.provide({
              hooks: ['workspaces'],
              resolve: (sessionBinding) => {
                const target = sessionBinding === undefined ? undefined : (sessionBinding.key ?? sessionBinding.sessionId)
                return { hooks: { workspaces: sourceFor(target) } }
              },
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
        pendingCreated = undefined
      }
    }

    /** True when `options` asks the blank Session to adopt initial content. */
    function wantsDraftInitialization(draftOptions) {
      if (draftOptions === undefined) return false
      return draftOptions.prompt !== undefined
        || (draftOptions.whenDraftExists
          ?? (draftOptions.clearPreviousDraft === true ? 'replace' : 'keep')) === 'replace'
    }

    /**
     * Whether the main view already shows a brand-new conversation. Pressing
     * New Session again in that state must not allocate another directory.
     * @param {object} ctx - client plugin context.
     * @returns {'standalone' | 'workspace' | 'active' | undefined}
     *   `standalone` for this plugin's blank Session, `workspace` for a blank
     *   Session already listed by a Workspace (the native flow reuses it),
     *   `active` when the current Session has started a turn, otherwise
     *   undefined when the state cannot be determined.
     */
    function currentNewConversation(ctx) {
      const uiSession = ctx.get('uiSession')
      const adapter = uiSession === undefined ? undefined : uiSession.adapter
      const source = adapter === undefined ? undefined : adapter.current
      const binding = source === undefined || typeof source.getSnapshot !== 'function'
        ? undefined
        : source.getSnapshot()
      const sessionId = binding === undefined ? undefined : (binding.key ?? binding.sessionId)
      if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined

      const sessions = ctx.get('sessions')
      const summary = summaryOf(sessions, sessionId)
      const blank = summary === undefined
        ? pendingCreated !== undefined && pendingCreated.sessionId === sessionId
        : summary.blank === true
      if (!blank) return 'active'

      if (isStandaloneSession(sessionId, cwdOf(sessions, sessionId))) return 'standalone'
      const workspaces = ctx.get('workspaces')
      const list = workspaces === undefined || workspaces.list === undefined
        ? undefined
        : workspaces.list.getSnapshot()
      const items = list === undefined || !Array.isArray(list.items) ? [] : list.items
      return items.some(item => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))
        ? 'workspace'
        : undefined
    }

    /**
     * Create one ungrouped Session through the single Host endpoint.
     * @param {object} ctx - client plugin context.
     * @param {string | undefined} agentPreset - optional per-Session preset.
     * @param {AbortSignal} signal - plugin lifetime cancellation.
     * @returns {Promise<{ sessionId: string, cwd: string | undefined }>} the created Session.
     */
    async function createUngroupedSession(ctx, agentPreset, signal) {
      const connection = ctx.get('connection')
      if (connection === undefined || connection.rpc === undefined) {
        throw new Error('no-workspace: connection service is unavailable')
      }
      // The gateway requires the single outer `args` key and a required SRC
      // parameter, so the request object is always present.
      const payload = { args: { request: agentPreset === undefined ? {} : { agentPreset } } }
      const result = await connection.rpc.call('/api', 'no-workspace/create', payload, signal)
      if (result === undefined || result === null || result.ok !== true) {
        const error = result && result.error ? result.error : undefined
        const failure = new Error(
          error && error.message ? error.message : 'no-workspace/create returned no value',
        )
        if (error && error.code) failure.code = error.code
        throw failure
      }
      const value = result.value
      if (!value || typeof value.sessionId !== 'string' || value.sessionId.length === 0) {
        throw new Error('no-workspace/create returned no sessionId')
      }
      const cwd = typeof value.cwd === 'string' && value.cwd.length > 0 ? value.cwd : undefined
      pendingCreated = cwd === undefined ? undefined : { sessionId: value.sessionId, cwd }
      return { sessionId: value.sessionId, cwd }
    }

    function apply(ctx) {
      const service = ctx.get('uiWorkspace')
      if (service === undefined || typeof service.startSession !== 'function') {
        console.warn('no-workspace: uiWorkspace.startSession is unavailable; client entry skipped')
        return
      }

      // Remember whether the wrapped methods were own properties so disposal can
      // put the object back exactly as it was (normally on the prototype).
      const hadOwnStartSession = Object.prototype.hasOwnProperty.call(service, 'startSession')
      const originalStartSession = service.startSession
      const hadOwnOpenWorkspace = Object.prototype.hasOwnProperty.call(service, 'openWorkspace')
      const originalOpenWorkspace = service.openWorkspace

      const lifetime = new AbortController()
      /** preset key -> in-flight creation, so rapid identical clicks share one request. */
      const inFlight = new Map()
      let disposed = false
      /** Monotonic marker so a later navigation supersedes an in-flight creation. */
      let startEpoch = 0

      const requestSession = (agentPreset) => {
        const key = agentPreset === undefined ? '' : `preset:${agentPreset}`
        const pending = inFlight.get(key)
        if (pending !== undefined) return pending
        const created = createUngroupedSession(ctx, agentPreset, lifetime.signal)
          .finally(() => {
            if (inFlight.get(key) === created) inFlight.delete(key)
          })
        inFlight.set(key, created)
        return created
      }

      /**
       * Surface a creation failure through the Workspace notice channel the
       * native flow uses (`toast.createFailed`). Guarded: the channel is an
       * implementation detail of ui-workspace, so an absent one only logs.
       */
      const reportFailure = (error) => {
        const code = error && typeof error.code === 'string' ? error.code : undefined
        const message = error && error.message ? error.message : String(error)
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
       * view, so the user can type immediately. Best-effort: the conversation
       * service is an implementation detail and may lag one frame behind.
       * @param {number} [attempts] - remaining retries while the view mounts.
       */
      function focusComposer(attempts = 12) {
        try {
          const conversation = ctx.get('conversation')
          if (conversation !== undefined && conversation !== null
            && typeof conversation.input?.focus === 'function') {
            conversation.input.focus()
          }
        } catch (error) {
          console.warn('no-workspace: focusing the composer failed:', error)
        }
        if (attempts > 1) {
          const timer = setTimeout(() => { if (!disposed) focusComposer(attempts - 1) }, 120)
          if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') timer.unref()
        }
      }

      /** Apply the same draft options the native implementation would. */
      const applyDraft = (sessionId, draftOptions) => {
        if (draftOptions === undefined) return
        try {
          const sessions = ctx.get('sessions')
          const conversation = ctx.get('conversation')
          const binding = sessions === undefined ? undefined : sessions.binding(sessionId)
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
       * "not in a workspace" picker row.
       * @param {object} [options] - draft initialization options and `agentPreset`.
       * @param {((sessionId: string) => void) | undefined} [migrate] - optional
       *   native draft migration applied to the new Session before it is shown.
       * @returns {Promise<void>} settles once the navigation was published or skipped.
       */
      function startStandalone(options, migrate) {
        const { agentPreset, ...draftOptionsPartial } = options ?? {}
        const draftOptions = options === undefined ? undefined : draftOptionsPartial
        const initializeDraft = wantsDraftInitialization(draftOptions)

        const epoch = ++startEpoch

        // The native initial restore is allowed to lose against a user creation;
        // any later navigation keeps cancelling it. Record whether a restore had
        // already claimed the stage when the user asked for the Session.
        const restorationAtStart = service.restorationNavigation

        // Starting a navigation cancels the previous pending one (the native
        // flow does the same in openWorkspaceSession).
        const layout = ctx.get('layout')
        const navigation = layout !== undefined && typeof layout.beginNavigation === 'function'
          ? layout.beginNavigation()
          : lifetime.signal

        return requestSession(agentPreset).then(({ sessionId }) => {
          if (disposed || epoch !== startEpoch) return
          let activeNavigation = navigation
          if (activeNavigation.aborted) {
            // The only start-up race this plugin tolerates: the native initial
            // restoration calls beginNavigation() after the user already asked
            // for a Session, aborting the user's signal. A restore that had not
            // started when the user clicked must yield; a genuine later switch
            // (another startSession or any other navigation) still wins.
            const restoration = service.restorationNavigation
            const initialRestoreTookOver = restorationAtStart === undefined
              && restoration !== undefined && restoration.aborted === false
            if (!initialRestoreTookOver) return
            // Abort that restore's navigation and open the user's Session with
            // the fresh navigation signal.
            activeNavigation = layout.beginNavigation()
          }
          const beforeOpen = initializeDraft || migrate !== undefined
            ? (id) => {
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
          // `replaceMain` is the native primitive behind openWorkspaceSession:
          // it retains the Session, applies the draft before publishing the
          // selection, and yields to a later navigation via the signal.
          if (typeof service.replaceMain === 'function') {
            service.replaceMain(sessionId, activeNavigation, 'reveal', beforeOpen)
          } else {
            if (beforeOpen !== undefined) beforeOpen(sessionId)
            service.openSession(sessionId)
          }
          // `replaceMain` publishes the selection without moving focus, so a chat
          // started from a menu would leave the caret outside the composer.
          if (!initializeDraft) focusComposer()
        }).catch((error) => {
          if (!disposed && epoch === startEpoch && error?.name !== 'AbortError') reportFailure(error)
        })
      }

      /** Whether the caller asked for the blank Session to adopt initial content. */
      function requestsDraft(options) {
        if (options === undefined) return false
        const { agentPreset, ...draftOptions } = options
        return wantsDraftInitialization(draftOptions)
      }

      /**
       * Replacement for `uiWorkspace.startSession`.
       * @param {string} [workspaceId] - explicit Workspace keeps the native flow.
       * @param {object} [options] - draft initialization options and `agentPreset`.
       */
      function startSession(workspaceId, options) {
        if (workspaceId !== undefined) {
          // Any startSession call (explicit Workspace or standalone) supersedes
          // a still-pending creation from an earlier click.
          startEpoch += 1
          return originalStartSession.apply(this === undefined ? service : this, [workspaceId, options])
        }

        // Already a brand-new conversation: pressing New Session again must not
        // create another directory. The standalone blank Session is kept as is,
        // and for a Workspace blank Session the native flow reuses that Session.
        // A creation still in flight is allowed to finish and open instead.
        if (!requestsDraft(options) && inFlight.size === 0) {
          const existing = currentNewConversation(ctx)
          if (existing === 'standalone') return
          if (existing === 'workspace') {
            startEpoch += 1
            return originalStartSession.apply(this === undefined ? service : this, [workspaceId, options])
          }
        }

        return startStandalone(options)
      }

      /**
       * Replacement for `uiWorkspace.openWorkspace`. A real Workspace id keeps
       * the native flow; the synthetic "not in a workspace" row starts a
       * standalone conversation instead. The Hero picker awaits the returned
       * Promise (`selectWorkspace(...).catch(...)`), so both branches return one.
       * @param {string} workspaceId - real Workspace id or the sentinel row id.
       * @param {((sessionId: string) => void)} [beforeOpen] - native draft migration.
       * @param {object} [options] - native open options, forwarded unchanged.
       * @returns {Promise<void>} settles once the requested view was published.
       */
      function openWorkspace(workspaceId, beforeOpen, options) {
        if (workspaceId !== NO_WORKSPACE_OPTION_ID) {
          startEpoch += 1
          return originalOpenWorkspace.apply(this === undefined ? service : this, [workspaceId, beforeOpen, options])
        }
        // Choosing "not in a workspace" while already in one is a no-op.
        if (inFlight.size === 0 && currentNewConversation(ctx) === 'standalone') {
          return Promise.resolve()
        }
        return startStandalone(undefined, beforeOpen)
      }

      const wrapsOpenWorkspace = typeof originalOpenWorkspace === 'function'
      ctx.effect(() => {
        service.startSession = startSession
        if (wrapsOpenWorkspace) service.openWorkspace = openWorkspace
        return () => {
          disposed = true
          lifetime.abort()
          inFlight.clear()
          if (hadOwnStartSession) service.startSession = originalStartSession
          else delete service.startSession
          if (wrapsOpenWorkspace) {
            if (hadOwnOpenWorkspace) service.openWorkspace = originalOpenWorkspace
            else delete service.openWorkspace
          }
        }
      }, 'no-workspace: wrap uiWorkspace startSession/openWorkspace')

      // The Hero chip shows this label for the plugin's own blank Sessions, so
      // the raw `dsh-chat-<uuid>` folder name never reaches the reader.
      const locale = ctx.get('locale')
      if (locale !== undefined && typeof locale.register === 'function') {
        ctx.effect(() => {
          try {
            return locale.register(LOCALE_NS, LOCALE_DICTS)
          } catch (error) {
            console.warn('no-workspace: locale registration failed:', error)
            return () => {}
          }
        }, 'no-workspace: locale dictionaries')
      }
      const translate = locale !== undefined && typeof locale.bind === 'function'
        ? locale.bind(LOCALE_NS)
        : undefined
      const text = {
        label() {
          if (translate === undefined) return FALLBACK_STANDALONE_LABEL
          const value = translate('standalone')
          return typeof value === 'string' && value.length > 0 && value !== 'standalone'
            ? value
            : FALLBACK_STANDALONE_LABEL
        },
        option() {
          if (translate === undefined) return FALLBACK_OPTION_LABEL
          const value = translate('option')
          return typeof value === 'string' && value.length > 0 && value !== 'option'
            ? value
            : FALLBACK_OPTION_LABEL
        },
        revision() {
          const snapshot = locale === undefined || typeof locale.getLocale !== 'function'
            ? undefined
            : locale.getLocale()
          return snapshot === undefined || typeof snapshot.revision !== 'number' ? 0 : snapshot.revision
        },
        subscribe(listener) {
          return locale !== undefined && typeof locale.subscribe === 'function'
            ? locale.subscribe(listener)
            : undefined
        },
      }

      // The Hero composer stays inert for an ungrouped Session because no
      // Workspace lists it. Give those Sessions (and only those) a local
      // Workspace row without touching the Host list or the real picker.
      const uiSession = ctx.get('uiSession')
      const workspaces = ctx.get('workspaces')
      const sessions = ctx.get('sessions')
      if (uiSession !== undefined && uiSession.adapter !== undefined
        && workspaces !== undefined && workspaces.list !== undefined
        && sessions !== undefined && sessions.list !== undefined) {
        ctx.effect(
          () => installWorkspacePickerView(uiSession, workspaces, sessions, text),
          'no-workspace: conversation workspace view',
        )
        // The Hero picker's menu portals to the document body and builds its
        // footer only from the native add action, so the extra action is mirrored
        // into that open menu instead of the Workspace snapshot.
        if (wrapsOpenWorkspace) {
          ctx.effect(
            () => installPickerFooterAction(
              text,
              () => service.openWorkspace(NO_WORKSPACE_OPTION_ID),
              () => (typeof service.notify === 'function'
                ? (error) => {
                  const message = error && error.message ? error.message : String(error)
                  const code = error && typeof error.code === 'string' ? error.code : undefined
                  try {
                    service.notify({ kind: 'createFailed', message: code === undefined ? message : `${code}: ${message}` })
                  } catch {
                    // the notice channel is best-effort
                  }
                }
                : undefined),
            ),
            'no-workspace: picker footer action',
          )
        }
      }
    }

    return { inject, apply }
  },
})
