/**
 * 客户端入口（构建产物 dist/client/index.js）的自检。可在普通 Node 下运行（无需 Harness）：
 *   node test/client/index.test.mjs
 *
 * 它通过伪造的 `window.__ModuleLoader__` 加载真实模块，
 * 并用伪造的服务驱动包装后的 `uiWorkspace.startSession`
 * 以及会话作用域的 Workspace 视图，断言单次 RPC 调用
 * 约定与拦截语义。
 */
import assert from 'node:assert/strict'

let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(spec) { loaded = spec },
  },
}

await import('../../dist/client/index.js')

assert.ok(loaded, 'the module declared itself to the module loader')
assert.equal(loaded.id, '@neoxuxo/dsh-no-workspace', 'module id equals the package name')

const calls = []
const drafts = []
let nextId = 0

/** 伪造的控制器服务所用的极简可观察存储。 */
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
      // 模拟真实服务：新的导航会中止上一个导航
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

  // Client 本地化运行时的替身：按命名空间存放的词典，以及
  // 当前语言环境的修订号，正是插件所读取的内容。
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

// 1. 显式指定 Workspace 时原样委托，不作改动。
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

// 2. 未显式指定 Workspace 时调用唯一的 RPC，并打开新建的 Session。
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

  // 3. 销毁后恢复原有的原型方法。
  h.dispose()
  assert.equal(h.service.startSession, h.nativeStartSession)
  assert.equal(Object.prototype.hasOwnProperty.call(h.service, 'startSession'), false)
}

// 4. Preset 会被转发，草稿选项在发布之前运行。
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
  // 真实的 replaceMain 会在保留之后调用 beforeOpen；此处由测试夹具手动调用。
  replace.beforeOpen(replace.sessionId)
  assert.equal(drafts.length, 1)
  assert.deepEqual(drafts[0].binding, { sessionId: 's1' })
  assert.deepEqual(drafts[0].options, { prompt: 'draft text' })
}

// 5. 快速重复的相同请求共用一次 RPC；只有最新的一次导航会打开。
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

// 6. Host 失败被就地处理（记录日志，不向调用方抛出）。
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

// 7. 独立 Session 会获得一个本地 Workspace 行；真实数据保持完好。
{
  const real = [workspaceView('w1', 'Project', 'C:\\proj', ['n1'])]
  const h = makeHarness({ items: real, sessions: [['u1', 'C:\\tmp\\dsh-chat-u1']] })
  // 在会话之外（冷启动 Hero），根 provider 保持原样。
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

  // Workspace 会话读取的是未改动的根列表：菜单操作被镜像到菜单自身的 DOM，
  // 而绝不会进入 Workspace 快照。
  h.setCurrent({ key: 'n1' })
  const other = h.descriptors[0].descriptor.resolve({ sessionId: 'n1' }).hooks.workspaces
  assert.equal(other.getSnapshot(), h.workspaceSnapshot,
    'a Workspace conversation sees the real list with no extra row')
  assert.equal(h.workspaceSnapshot.items.length, 1, 'the real Workspace list is still untouched')

  // 在会话之外，再次原样交出根数据源。
  h.setCurrent(undefined)
  assert.equal(h.descriptors.length, 0, 'no contribution outside a conversation')
  assert.equal(h.workspacesList.getSnapshot(), h.workspaceSnapshot,
    'the root list stays untouched while no conversation is selected')

  // 没有 Session 的视图（冷启动 Hero）仍能解析而不抛错。
  assert.equal(descriptor.resolve(undefined).hooks.workspaces.getSnapshot(), h.workspaceSnapshot,
    'the resolver tolerates an absent Session binding')

  h.dispose()
  assert.equal(h.descriptors.length, 0, 'disposal removes the provider')
}

// 8. 刷新恢复：仅凭 SessionId + cwd 做出判断。
{
  const h = makeHarness({ sessions: [['u2', 'D:\\work\\dsh-chat-u2']] })
  h.setCurrent({ key: 'u2' })
  const source = h.descriptors[0].descriptor.resolve({ sessionId: 'u2' }).hooks.workspaces
  assert.deepEqual(source.getSnapshot().items.at(-1).sessionIds, ['u2'],
    'a refreshed Session is recognised without local storage')
  h.dispose()
}

// 9. 没有可离开的 Workspace 时，普通 Session 不会多出额外的行。
{
  const h = makeHarness({ sessions: [['n1', 'C:\\proj\\sub']] })
  h.setCurrent({ key: 'n1' })
  const source = h.descriptors[0].descriptor.resolve({ sessionId: 'n1' }).hooks.workspaces
  assert.equal(source.getSnapshot(), h.workspaceSnapshot, 'the native add-only flow stays untouched')
  h.dispose()
}

// 10. 一旦 Session 摘要带有其 cwd，所属行就会出现。
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

// 11. RPC 返回的 cwd 会立即识别出该 Session，早于 Session 摘要更新
//     （或在摘要始终不携带 `cwd` 的情况下）。
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

// 12. 只有精确的 `dsh-chat-${sessionId}` 叶子目录才标记为独立 Session；
//     仅带有前缀、来自其他来源的目录不予处理。
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

// 13. 启动竞态：原生初始恢复在点击之后开始，
//     并中止点击的导航。用户的创建仍必须获胜，
//     并中止尚未完成的恢复。
{
  calls.length = 0
  let release
  const h = makeHarness({ rpc: () => new Promise((resolve) => { release = resolve }) })
  h.service.startSession()
  const userSignal = h.layoutSignals[0].signal
  // 列表就绪后，原生恢复会调用 beginNavigation()。
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

// 14. 之后显式选择 Workspace 会取消挂起的创建。
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

// 15. 任何后续导航（而非另一次 startSession）也会取消该创建。
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

// 16. 已处于本插件的空白会话中时，再次点击“新建会话”
//     不得分配另一个目录或进行导航。
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

// 17. 在 Workspace 的空白会话中执行同样的点击，会委托给原生流程，
//     由原生流程复用该 Session，而不是新建目录。
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

// 18. 独立会话一旦已经开始一轮对话，点击“新建会话”
//     就会再次创建一个全新目录。
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

// 19. 用于初始化草稿的选项即使在空白会话中也会创建 Session，
//     因为调用方要求放置内容。
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

// 20. 没有 Client 本地化服务时，标签会回退为中文短语，
//     而不是暴露文件夹名。
{
  const h = makeHarness({ sessions: [['u23', '/tmp/dsh-chat-u23']], withLocale: false })
  h.setCurrent({ key: 'u23' })
  assert.equal(h.descriptors.length, 1)
  const source = h.descriptors[0].descriptor.resolve({ sessionId: 'u23' }).hooks.workspaces
  assert.equal(source.getSnapshot().items[0].title, '不在工作区中工作')
  h.dispose()
}

// 21. 真实的 Workspace id 会保持原生 `openWorkspace` 流程不变。
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

// 22. “不在工作区中”这一行会启动一个独立会话。
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

// 23. 已处于某个工作区时再选择“不在工作区中”属于空操作。
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

// 24. 原生草稿迁移会到达新的独立 Session。
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

