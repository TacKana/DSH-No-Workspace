/**
 * Self-test for client/index.js. Runs under plain Node (no Harness needed):
 *   node client/index.test.mjs
 *
 * It loads the real module through a fake `window.__ModuleLoader__` and drives
 * the wrapped `uiWorkspace.startSession` plus the session-scope Workspace view
 * with fake services, asserting the single-RPC contract and interception
 * semantics.
 */
import assert from 'node:assert/strict'

let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(spec) { loaded = spec },
  },
}

await import('./index.js')

assert.ok(loaded, 'the module declared itself to the module loader')
assert.equal(loaded.id, '@local/dsh-no-workspace', 'module id equals the package name')

const calls = []
const drafts = []
let nextId = 0

/** Tiny observable store used by the fake controller services. */
function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

const workspaceView = (workspaceId, title, path, sessionIds = []) => ({
  workspaceId, title, path, sessionIds, createdAt: '', updatedAt: '',
})

function makeHarness({ rpc, items = [], sessions = [], current = undefined, withLocale = true } = {}) {
  const workspaceCalls = []
  const notices = []
  class FakeUiWorkspace {
    startSession(workspaceId, options) {
      workspaceCalls.push({ kind: 'native', workspaceId, options })
    }
    openWorkspace(workspaceId, beforeOpen, options) {
      workspaceCalls.push({ kind: 'nativeOpen', workspaceId, beforeOpen, options })
      return Promise.resolve()
    }
    openSession(sessionId) { workspaceCalls.push({ kind: 'open', sessionId }) }
    replaceMain(sessionId, signal, panel, beforeOpen) {
      workspaceCalls.push({ kind: 'replace', sessionId, signal, panel, beforeOpen })
    }
    notify(toast) { notices.push(toast) }
  }
  const service = new FakeUiWorkspace()

  const layoutSignals = []
  const layout = {
    beginNavigation() {
      const controller = new AbortController()
      layoutSignals.push(controller)
      // mimic the real service: a new navigation aborts the previous one
      if (layoutSignals.length > 1) layoutSignals[layoutSignals.length - 2].abort()
      return controller.signal
    },
  }

  const byId = {}
  for (const [sessionId, cwd] of sessions) byId[sessionId] = { id: sessionId, sessionId, cwd }
  const sessionsList = observable({ byId })
  const workspaceSnapshot = {
    items,
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'ready',
    phase: 'ready',
  }
  const workspacesList = observable(workspaceSnapshot)

  const currentSource = observable(current)
  const descriptors = []
  const provides = []
  const uiSession = {
    adapter: { current: currentSource },
    provide(descriptor) {
      const record = { descriptor, disposed: false }
      descriptors.push(record)
      provides.push(record)
      return () => {
        if (record.disposed) return
        record.disposed = true
        const index = descriptors.indexOf(record)
        if (index !== -1) descriptors.splice(index, 1)
      }
    },
  }

  // Stand-in for the Client locale runtime: dictionaries per namespace and the
  // active locale's revision, exactly what the plugin reads.
  const dictionaries = new Map()
  let localeRevision = 1
  const localeListeners = new Set()
  const locale = {
    register(namespace, dicts) {
      if (typeof namespace !== 'string' || namespace.length === 0) throw new Error('invalid namespace')
      if (dictionaries.has(namespace)) throw new Error(`duplicate namespace ${namespace}`)
      dictionaries.set(namespace, dicts)
      localeRevision += 1
      for (const listener of [...localeListeners]) listener()
      return () => {
        if (dictionaries.get(namespace) !== dicts) return
        dictionaries.delete(namespace)
        localeRevision += 1
        for (const listener of [...localeListeners]) listener()
      }
    },
    bind(namespace) {
      return (key) => {
        const dicts = dictionaries.get(namespace)
        if (dicts === undefined) return key
        const dict = dicts.zh ?? dicts.en ?? {}
        return dict[key] ?? key
      }
    },
    getLocale() { return { active: 'zh', locales: [], revision: localeRevision } },
    subscribe(listener) {
      localeListeners.add(listener)
      return () => { localeListeners.delete(listener) }
    },
  }

  const registry = new Map([
    ['uiWorkspace', service],
    ['layout', layout],
    ['uiSession', uiSession],
    ['workspaces', { list: workspacesList }],
    ['locale', locale],
    ['sessions', {
      list: sessionsList,
      binding(id) { return { sessionId: id } },
    }],
    ['conversation', {
      input: {
        requestDraftInitialization(binding, options) {
          drafts.push({ binding, options })
          return 'applied'
        },
      },
    }],
    ['connection', {
      rpc: {
        async call(channel, endpoint, payload, signal) {
          calls.push({ channel, endpoint, payload, signal })
          return rpc ? rpc(payload) : { ok: true, value: { sessionId: `s${++nextId}`, cwd: `/tmp/dsh-chat-s${nextId}` } }
        },
      },
    }],
  ])

  const disposers = []
  const labels = []
  if (!withLocale) registry.delete('locale')
  const ctx = {
    get(name) { return registry.get(name) },
    effect(fn, label) {
      labels.push(label)
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
  }

  const nativeStartSession = FakeUiWorkspace.prototype.startSession
  const nativeOpenWorkspace = FakeUiWorkspace.prototype.openWorkspace
  const plugin = loaded.factory(() => { throw new Error('no runtime requires expected') })
  plugin.apply(ctx)

  return {
    service,
    layout,
    nativeStartSession,
    nativeOpenWorkspace,
    workspaceCalls,
    layoutSignals,
    drafts,
    notices,
    labels,
    uiSession,
    descriptors,
    workspacesList,
    workspaceSnapshot,
    setCurrent(binding) { currentSource.set(binding) },
    setSession(sessionId, cwd, fields = {}) {
      sessionsList.set({
        byId: {
          ...sessionsList.getSnapshot().byId,
          [sessionId]: { id: sessionId, sessionId, cwd, ...fields },
        },
      })
    },
    dispose: () => { for (const dispose of disposers.reverse()) dispose() },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// 1. Explicit Workspace is delegated untouched.
{
  calls.length = 0
  const h = makeHarness()
  const options = { agentPreset: 'fast', prompt: 'hello' }
  h.service.startSession('workspace-1', options)
  assert.deepEqual(h.workspaceCalls, [{ kind: 'native', workspaceId: 'workspace-1', options }])
  assert.equal(calls.length, 0, 'explicit workspace must not call no-workspace RPC')
  h.dispose()
  assert.equal(h.service.startSession, h.nativeStartSession, 'disposal restores the native implementation')
  assert.equal(Object.prototype.hasOwnProperty.call(h.service, 'startSession'), false)
}

// 2. No explicit Workspace calls the one RPC and opens the created Session.
{
  calls.length = 0
  nextId = 0
  const h = makeHarness()
  h.service.startSession()
  await tick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].channel, '/api')
  assert.equal(calls[0].endpoint, 'no-workspace/create')
  assert.deepEqual(calls[0].payload, { args: { request: {} } })
  const replace = h.workspaceCalls.find((c) => c.kind === 'replace')
  assert.ok(replace, 'opened through the native replaceMain primitive')
  assert.equal(replace.sessionId, 's1')
  assert.equal(replace.panel, 'reveal')
  assert.equal(replace.beforeOpen, undefined)
  assert.ok(replace.signal instanceof AbortSignal)

  // 3. Disposal restores the original prototype method.
  h.dispose()
  assert.equal(h.service.startSession, h.nativeStartSession)
  assert.equal(Object.prototype.hasOwnProperty.call(h.service, 'startSession'), false)
}

// 4. Preset is forwarded and draft options run before publication.
{
  calls.length = 0
  drafts.length = 0
  nextId = 0
  const h = makeHarness()
  h.service.startSession(undefined, { agentPreset: 'precise', prompt: 'draft text' })
  await tick()
  assert.deepEqual(calls[0].payload, { args: { request: { agentPreset: 'precise' } } })
  const replace = h.workspaceCalls.find((c) => c.kind === 'replace')
  assert.ok(replace)
  assert.equal(typeof replace.beforeOpen, 'function')
  // replaceMain would call beforeOpen after retaining; the harness invokes it.
  replace.beforeOpen(replace.sessionId)
  assert.equal(drafts.length, 1)
  assert.deepEqual(drafts[0].binding, { sessionId: 's1' })
  assert.deepEqual(drafts[0].options, { prompt: 'draft text' })
}

// 5. Rapid identical requests share one RPC; only the latest navigation opens.
{
  calls.length = 0
  nextId = 0
  const h = makeHarness()
  h.service.startSession()
  h.service.startSession()
  await tick()
  assert.equal(calls.length, 1, 'identical in-flight requests are coalesced')
  const replaces = h.workspaceCalls.filter((c) => c.kind === 'replace')
  assert.equal(replaces.length, 1, 'a superseded request does not open')
  assert.equal(replaces[0].sessionId, 's1')
}

// 6. Host failure is contained (logged, not thrown through the caller).
{
  calls.length = 0
  const h = makeHarness({
    rpc: async () => ({ ok: false, error: { code: 'no-workspace/mkdir-failed', message: 'boom' } }),
  })
  const warnings = []
  const warn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  h.service.startSession()
  await tick()
  console.warn = warn
  assert.equal(h.workspaceCalls.length, 0)
  assert.ok(warnings.some((line) => line.includes('new conversation failed')), 'failure is reported to the console')
  assert.deepEqual(h.notices, [{ kind: 'createFailed', message: 'no-workspace/mkdir-failed: boom' }],
    'failure is shown through the Workspace notice channel')
}

// 7. A standalone Session gets a local Workspace row; real data stays intact.
{
  const real = [workspaceView('w1', 'Project', 'C:\\proj', ['n1'])]
  const h = makeHarness({ items: real, sessions: [['u1', 'C:\\tmp\\dsh-chat-u1']] })
  // Outside a conversation (the cold Hero) the root provider stays untouched.
  assert.equal(h.descriptors.length, 0, 'no contribution before a conversation is selected')
  h.setCurrent({ key: 'u1' })
  assert.equal(h.descriptors.length, 1, 'one session-scope provider for the conversation view')
  const descriptor = h.descriptors[0].descriptor
  assert.deepEqual(descriptor.hooks, ['workspaces'])

  const source = descriptor.resolve({ sessionId: 'u1' }).hooks.workspaces
  const snapshot = source.getSnapshot()
  assert.equal(snapshot.items.length, 2)
  const row = snapshot.items[1]
  assert.equal(row.title, '不在工作区中工作', 'the label is the localized phrase, never the folder name')
  assert.equal(row.path, '', 'no folder name or path is exposed')
  assert.deepEqual(row.sessionIds, ['u1'], 'owning the Session marks the row as selected')
  assert.equal(row.workspaceId, 'no-workspace:standalone')
  assert.equal(snapshot.phase, 'ready', 'the rest of the snapshot is preserved')
  assert.equal(h.workspaceSnapshot.items.length, 1, 'the real Workspace list is never mutated')
  assert.equal(source.getSnapshot(), snapshot, 'snapshot identity is stable while inputs are unchanged')

  // A Workspace conversation reads the untouched root list: the menu action is
  // mirrored into the menu's own DOM, never into the Workspace snapshot.
  h.setCurrent({ key: 'n1' })
  const other = h.descriptors[0].descriptor.resolve({ sessionId: 'n1' }).hooks.workspaces
  assert.equal(other.getSnapshot(), h.workspaceSnapshot,
    'a Workspace conversation sees the real list with no extra row')
  assert.equal(h.workspaceSnapshot.items.length, 1, 'the real Workspace list is still untouched')

  // Outside a conversation the root source is handed out untouched again.
  h.setCurrent(undefined)
  assert.equal(h.descriptors.length, 0, 'no contribution outside a conversation')
  assert.equal(h.workspacesList.getSnapshot(), h.workspaceSnapshot,
    'the root list stays untouched while no conversation is selected')

  // A view with no Session (the cold Hero) still resolves without throwing.
  assert.equal(descriptor.resolve(undefined).hooks.workspaces.getSnapshot(), h.workspaceSnapshot,
    'the resolver tolerates an absent Session binding')

  h.dispose()
  assert.equal(h.descriptors.length, 0, 'disposal removes the provider')
}

// 8. Refresh recovery: decision comes from SessionId + cwd alone.
{
  const h = makeHarness({ sessions: [['u2', 'D:\\work\\dsh-chat-u2']] })
  h.setCurrent({ key: 'u2' })
  const source = h.descriptors[0].descriptor.resolve({ sessionId: 'u2' }).hooks.workspaces
  assert.deepEqual(source.getSnapshot().items.at(-1).sessionIds, ['u2'],
    'a refreshed Session is recognised without local storage')
  h.dispose()
}

// 9. With no Workspace to leave, a normal Session is offered no extra row.
{
  const h = makeHarness({ sessions: [['n1', 'C:\\proj\\sub']] })
  h.setCurrent({ key: 'n1' })
  const source = h.descriptors[0].descriptor.resolve({ sessionId: 'n1' }).hooks.workspaces
  assert.equal(source.getSnapshot(), h.workspaceSnapshot, 'the native add-only flow stays untouched')
  h.dispose()
}

// 10. The owning row appears once the Session summary carries its cwd.
{
  const h = makeHarness()
  h.setCurrent({ key: 'u3' })
  let source = h.descriptors[0].descriptor.resolve({ sessionId: 'u3' }).hooks.workspaces
  assert.equal(source.getSnapshot(), h.workspaceSnapshot, 'nothing to recognise before the summary carries cwd')
  h.setSession('u3', '/home/me/dsh-chat-u3')
  source = h.descriptors[0].descriptor.resolve({ sessionId: 'u3' }).hooks.workspaces
  assert.deepEqual(source.getSnapshot().items.at(-1).sessionIds, ['u3'],
    'the row follows the Session summary update, for POSIX paths too')
  h.dispose()
}

// 11. The cwd returned by the RPC recognises the Session immediately, before the
//     Session summary is updated (or when the summary never carries `cwd`).
{
  calls.length = 0
  nextId = 0
  const h = makeHarness()
  h.service.startSession()
  await tick()
  assert.equal(calls.length, 1)
  h.setCurrent({ key: 's1' })
  const source = h.descriptors[0].descriptor.resolve({ sessionId: 's1' }).hooks.workspaces
  const snapshot = source.getSnapshot()
  assert.equal(snapshot.items.length, 1)
  assert.equal(snapshot.items[0].title, '不在工作区中工作')
  h.dispose()
}

// 12. Only the exact `dsh-chat-${sessionId}` leaf marks a standalone Session;
//     a merely prefixed directory from another source is left alone.
{
  const h = makeHarness({ sessions: [['x1', '/tmp/dsh-chat-unrelated']] })
  h.setCurrent({ key: 'x1' })
  assert.equal(h.descriptors[0].descriptor.resolve({ sessionId: 'x1' }).hooks.workspaces.getSnapshot(),
    h.workspaceSnapshot, 'bare prefix is not this Session')
  h.setSession('x2', '/tmp/dsh-chat-x2-extra')
  h.setCurrent({ key: 'x2' })
  assert.equal(h.descriptors[0].descriptor.resolve({ sessionId: 'x2' }).hooks.workspaces.getSnapshot(),
    h.workspaceSnapshot, 'extra suffix is not this Session')
  h.dispose()
}

// 13. Start-up race: the native initial restore begins after the click and
//     aborts the click's navigation. The user's creation must still win and
//     abort the not-yet-finished restore.
{
  calls.length = 0
  let release
  const h = makeHarness({ rpc: () => new Promise((resolve) => { release = resolve }) })
  h.service.startSession()
  const userSignal = h.layoutSignals[0].signal
  // The list becomes ready and the native restore calls beginNavigation().
  const restoreSignal = h.layout.beginNavigation()
  h.service.restorationNavigation = restoreSignal
  assert.equal(userSignal.aborted, true, 'the restore aborts the click navigation')
  release({ ok: true, value: { sessionId: 's9', cwd: '/tmp/dsh-chat-s9' } })
  await tick()
  await tick()
  const replace = h.workspaceCalls.find((call) => call.kind === 'replace')
  assert.ok(replace, 'the user creation is still opened')
  assert.equal(replace.sessionId, 's9')
  assert.equal(replace.panel, 'reveal')
  assert.equal(restoreSignal.aborted, true, 'the stale restore navigation is aborted')
  assert.equal(replace.signal.aborted, false, 'a fresh navigation signal opens the Session')
  h.dispose()
}

// 14. A later explicit Workspace selection cancels the pending creation.
{
  calls.length = 0
  let release
  const h = makeHarness({ rpc: () => new Promise((resolve) => { release = resolve }) })
  h.service.startSession()
  h.service.startSession('workspace-2', { agentPreset: 'fast' })
  assert.deepEqual(h.workspaceCalls,
    [{ kind: 'native', workspaceId: 'workspace-2', options: { agentPreset: 'fast' } }],
    'the explicit Workspace is delegated immediately')
  release({ ok: true, value: { sessionId: 's10', cwd: '/tmp/dsh-chat-s10' } })
  await tick()
  assert.equal(h.workspaceCalls.filter((call) => call.kind === 'replace').length, 0,
    'the superseded creation does not open')
  h.dispose()
}

// 15. Any later navigation (not another startSession) also cancels the creation.
{
  calls.length = 0
  let release
  const h = makeHarness({ rpc: () => new Promise((resolve) => { release = resolve }) })
  h.service.startSession()
  h.layout.beginNavigation()
  release({ ok: true, value: { sessionId: 's11', cwd: '/tmp/dsh-chat-s11' } })
  await tick()
  assert.equal(h.workspaceCalls.filter((call) => call.kind === 'replace').length, 0,
    'a later navigation still wins over the pending creation')
  h.dispose()
}

// 16. Pressing New Session while already in this plugin's blank conversation
//     must not allocate another directory or navigate.
{
  calls.length = 0
  const h = makeHarness()
  h.setSession('u20', '/tmp/dsh-chat-u20', { blank: true })
  h.setCurrent({ key: 'u20' })
  h.service.startSession()
  await tick()
  assert.equal(calls.length, 0, 'no directory RPC for an already blank standalone conversation')
  assert.equal(h.workspaceCalls.length, 0, 'no navigation either')
  h.dispose()
}

// 17. The same click inside a Workspace's blank conversation is delegated to the
//     native flow, which reuses that Session instead of creating a directory.
{
  calls.length = 0
  const h = makeHarness({ items: [workspaceView('w1', 'Project', 'C:\\proj', ['n20'])] })
  h.setSession('n20', 'C:\\proj', { blank: true })
  h.setCurrent({ key: 'n20' })
  h.service.startSession()
  await tick()
  assert.equal(calls.length, 0, 'no directory RPC for a Workspace conversation')
  assert.deepEqual(h.workspaceCalls, [{ kind: 'native', workspaceId: undefined, options: undefined }],
    'the native flow handles the already-blank Workspace conversation')
  h.dispose()
}

// 18. Once the standalone conversation has started a turn, a New Session click
//     creates a fresh directory again.
{
  calls.length = 0
  nextId = 0
  const h = makeHarness()
  h.setSession('u21', '/tmp/dsh-chat-u21', { blank: false })
  h.setCurrent({ key: 'u21' })
  h.service.startSession()
  await tick()
  assert.equal(calls.length, 1, 'an active conversation allows a new directory')
  assert.equal(h.workspaceCalls.filter((call) => call.kind === 'replace').length, 1)
  h.dispose()
}

// 19. Options that initialize a draft still create a Session even in a blank
//     conversation, because the caller asked for content to be placed.
{
  calls.length = 0
  nextId = 0
  const h = makeHarness()
  h.setSession('u22', '/tmp/dsh-chat-u22', { blank: true })
  h.setCurrent({ key: 'u22' })
  h.service.startSession(undefined, { prompt: 'typed while blank' })
  await tick()
  assert.equal(calls.length, 1, 'draft initialization is not suppressed')
  h.dispose()
}

// 20. Without the Client locale service the label falls back to the Chinese
//     phrase rather than exposing the folder name.
{
  const h = makeHarness({ sessions: [['u23', '/tmp/dsh-chat-u23']], withLocale: false })
  h.setCurrent({ key: 'u23' })
  assert.equal(h.descriptors.length, 1)
  const source = h.descriptors[0].descriptor.resolve({ sessionId: 'u23' }).hooks.workspaces
  assert.equal(source.getSnapshot().items[0].title, '不在工作区中工作')
  h.dispose()
}

// 21. A real Workspace id keeps the native `openWorkspace` flow untouched.
{
  calls.length = 0
  const h = makeHarness({ items: [workspaceView('w1', 'Project', 'C:\\proj', ['n1'])] })
  const beforeOpen = () => {}
  const options = { origin: 'chip' }
  h.service.openWorkspace('w1', beforeOpen, options)
  assert.deepEqual(h.workspaceCalls, [{ kind: 'nativeOpen', workspaceId: 'w1', beforeOpen, options }],
    'the native picker selection is forwarded unchanged')
  assert.equal(calls.length, 0, 'no directory is created for a real Workspace')
  h.dispose()
  assert.equal(h.service.openWorkspace, h.nativeOpenWorkspace, 'disposal restores the native openWorkspace')
  assert.equal(Object.prototype.hasOwnProperty.call(h.service, 'openWorkspace'), false)
}

// 22. The "not in a workspace" row starts a standalone conversation.
{
  calls.length = 0
  nextId = 0
  const h = makeHarness({ items: [workspaceView('w1', 'Project', 'C:\\proj', ['n1'])] })
  h.setSession('n1', 'C:\\proj', { blank: false })
  h.setCurrent({ key: 'n1' })
  const pending = h.service.openWorkspace('no-workspace:standalone')
  assert.ok(pending instanceof Promise, 'the Hero picker awaits the returned Promise')
  await pending
  assert.equal(calls.length, 1, 'exactly one directory RPC')
  const replace = h.workspaceCalls.find((call) => call.kind === 'replace')
  assert.ok(replace, 'opened through the native replaceMain primitive')
  assert.equal(replace.sessionId, 's1')
  h.dispose()
}

// 23. Choosing "not in a workspace" while already in one is a no-op.
{
  calls.length = 0
  const h = makeHarness({ items: [workspaceView('w1', 'Project', 'C:\\proj', ['n1'])] })
  h.setSession('u30', '/tmp/dsh-chat-u30', { blank: true })
  h.setCurrent({ key: 'u30' })
  await h.service.openWorkspace('no-workspace:standalone')
  assert.equal(calls.length, 0, 'no second directory while already blank standalone')
  assert.equal(h.workspaceCalls.length, 0, 'and no navigation')
  h.dispose()
}

// 24. The native draft migration reaches the new standalone Session.
{
  calls.length = 0
  nextId = 0
  const migrated = []
  const h = makeHarness({ items: [workspaceView('w1', 'Project', 'C:\\proj', ['n1'])] })
  h.setSession('n1', 'C:\\proj', { blank: false })
  h.setCurrent({ key: 'n1' })
  await h.service.openWorkspace('no-workspace:standalone', (id) => { migrated.push(id) })
  const replace = h.workspaceCalls.find((call) => call.kind === 'replace')
  assert.equal(typeof replace.beforeOpen, 'function')
  replace.beforeOpen(replace.sessionId)
  assert.deepEqual(migrated, ['s1'], 'the native draft migration is applied to the new Session')
  h.dispose()
}

console.log('client/index.test.mjs: all assertions passed')

