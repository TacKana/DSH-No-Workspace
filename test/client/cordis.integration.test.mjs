/**
 * 针对 DeepSeek Harness 随附的真实 Cordis 运行时进行的集成检查。
 * 当 DSH_INSTALL_DIR 不存在时跳过（例如在 DSH 安装环境之外的 CI）。
 */
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const installDir = process.env.DSH_INSTALL_DIR
if (!installDir) {
  console.log('test/client/cordis.integration.test.mjs: skipped (DSH_INSTALL_DIR unset)')
  process.exit(0)
}

// Cordis 运行时位于 app.asar 内部，只有 Electron 自带的 Node 才能读取。
// 请使用 ELECTRON_RUN_AS_NODE=1 配合该可执行文件运行本文件。
const packages = path.join(installDir, '..')
let Context
let Service
try {
  ({ Context, Service } = await import(pathToFileURL(path.join(packages, 'cordis', 'lib', 'index.js')).href))
} catch (error) {
  console.log(
    'test/client/cordis.integration.test.mjs: skipped (run with ELECTRON_RUN_AS_NODE=1 and the DSH Node executable):',
    error instanceof Error ? error.message.split('\n')[0] : error,
  )
  process.exit(0)
}

let spec
globalThis.window = { __ModuleLoader__: { load(value) { spec = value } } }
await import(pathToFileURL(path.join(import.meta.dirname, '..', '..', 'dist', 'client', 'index.js')).href)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

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

const calls = []
class FakeWorkspace extends Service {
  constructor(ctx) {
    super(ctx, 'uiWorkspace')
    this.replaceCalls = []
    this.nativeCalls = []
  }
  startSession(workspaceId, options) { this.nativeCalls.push({ workspaceId, options }) }
  openWorkspace(workspaceId, beforeOpen, options) {
    this.nativeCalls.push({ kind: 'openWorkspace', workspaceId, beforeOpen, options })
    return Promise.resolve()
  }
  openSession(id) { this.replaceCalls.push({ kind: 'open', id }) }
  replaceMain(id, signal, panel, beforeOpen) {
    this.replaceCalls.push({ kind: 'replace', id, panel, beforeOpen })
  }
}

const ctx = new Context()
const workspace = new FakeWorkspace(ctx)
const layout = new AbortController()

const byId = {}
const sessionsList = observable({ byId })
const workspaceSnapshot = {
  items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'ready', phase: 'ready',
}
const workspacesList = observable(workspaceSnapshot)
const currentSource = observable(undefined)
const descriptors = []
const uiSession = {
  adapter: { current: currentSource },
  provide(descriptor) {
    descriptors.push(descriptor)
    return () => {
      const index = descriptors.indexOf(descriptor)
      if (index !== -1) descriptors.splice(index, 1)
    }
  },
}

ctx.reflect.provide('connection', {
  rpc: {
    async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint, payload })
      return { ok: true, value: { sessionId: 's-real', cwd: '/tmp/x' } }
    },
  },
})
ctx.reflect.provide('sessions', { list: sessionsList, binding(id) { return { sessionId: id } } })
ctx.reflect.provide('conversation', { input: { requestDraftInitialization() { return 'applied' } } })
ctx.reflect.provide('layout', { beginNavigation() { return layout.signal } })
ctx.reflect.provide('uiSession', uiSession)
ctx.reflect.provide('workspaces', { list: workspacesList })

const plugin = spec.factory(() => { throw new Error('unexpected require') })
plugin.apply(ctx)
assert(spec.id === 'dsh-no-workspace', 'module id')
assert(Object.prototype.hasOwnProperty.call(workspace, 'startSession'), 'instance startSession installed')
assert(Object.prototype.hasOwnProperty.call(workspace, 'openWorkspace'), 'instance openWorkspace installed')

ctx.uiWorkspace.startSession('ws-native', { agentPreset: 'p0' })
assert(workspace.nativeCalls.length === 1, 'explicit workspace delegated')
assert(workspace.nativeCalls[0].workspaceId === 'ws-native', 'explicit workspace id forwarded')
assert(calls.length === 0, 'explicit workspace makes no RPC')

ctx.uiWorkspace.startSession()
await new Promise(resolve => setTimeout(resolve, 0))
assert(calls.length === 1, 'no-workspace RPC issued')
assert(calls[0].channel === '/api' && calls[0].endpoint === 'no-workspace/create', 'RPC route')
assert(JSON.stringify(calls[0].payload) === JSON.stringify({ args: { request: {} } }), 'default payload has an empty request')
assert(workspace.replaceCalls.length === 1, 'session opened with replaceMain')
assert(workspace.replaceCalls[0].id === 's-real' && workspace.replaceCalls[0].panel === 'reveal', 'replaceMain args')

ctx.uiWorkspace.startSession(undefined, { agentPreset: 'precise' })
await new Promise(resolve => setTimeout(resolve, 0))
assert(JSON.stringify(calls[1].payload) === JSON.stringify({ args: { request: { agentPreset: 'precise' } } }), 'preset forwarded')

// 独立 Session 的 provider 遵循真实 Cordis 的作用域绑定，
// 且仅在选中某个会话时才注册（冷启动 Hero
// 保留根 provider）。
assert(descriptors.length === 0, 'no contribution before a conversation is selected')
sessionsList.set({ byId: { 'u-real': { id: 'u-real', sessionId: 'u-real', cwd: 'C:\\tmp\\dsh-chat-u-real' } } })
currentSource.set({ key: 'u-real' })
assert(descriptors.length === 1, 'session-scope provider registered')
const source = descriptors[0].resolve({ sessionId: 'u-real' }).hooks.workspaces
const snapshot = source.getSnapshot()
assert(snapshot.items.length === 1 && snapshot.items[0].sessionIds[0] === 'u-real', 'synthetic Workspace row')
assert(workspaceSnapshot.items.length === 0, 'root Workspace data untouched')
currentSource.set(undefined)
assert(descriptors.length === 0, 'the contribution is withdrawn outside a conversation')

// 选择器中的行：真实 Workspace id 走委托，哨兵值则负责创建。
await ctx.uiWorkspace.openWorkspace('ws-real', undefined, { from: 'picker' })
const delegated = workspace.nativeCalls.at(-1)
assert(delegated.kind === 'openWorkspace' && delegated.workspaceId === 'ws-real', 'real Workspace delegated to native openWorkspace')
assert(calls.length === 2, 'a real Workspace creates no directory')
await ctx.uiWorkspace.openWorkspace('no-workspace:standalone')
assert(calls.length === 3 && calls[2].endpoint === 'no-workspace/create', 'the sentinel row creates a standalone directory')
assert(workspace.replaceCalls.at(-1).id === 's-real', 'and opens it with replaceMain')

console.log('client/cordis.integration.test.mjs: all assertions passed')

