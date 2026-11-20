/**
 * Integration check against the real Cordis runtime shipped with DeepSeek Harness.
 * Skipped when DSH_INSTALL_DIR is not present (e.g. CI outside a DSH install).
 */
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const installDir = process.env.DSH_INSTALL_DIR
if (!installDir) {
  console.log('client/cordis.integration.test.mjs: skipped (DSH_INSTALL_DIR unset)')
  process.exit(0)
}

const packages = path.join(installDir, '..')
const { Context, Service } = await import(pathToFileURL(path.join(packages, 'cordis', 'lib', 'index.js')).href)

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
assert(spec.id === '@local/dsh-no-workspace', 'module id')
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

// The standalone-Session provider follows the real Cordis scope binding, and it
// is only registered while a conversation is selected (the cold Hero keeps the
// root provider).
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

// The picker row: a real Workspace id delegates, the sentinel creates.
await ctx.uiWorkspace.openWorkspace('ws-real', undefined, { from: 'picker' })
const delegated = workspace.nativeCalls.at(-1)
assert(delegated.kind === 'openWorkspace' && delegated.workspaceId === 'ws-real', 'real Workspace delegated to native openWorkspace')
assert(calls.length === 2, 'a real Workspace creates no directory')
await ctx.uiWorkspace.openWorkspace('no-workspace:standalone')
assert(calls.length === 3 && calls[2].endpoint === 'no-workspace/create', 'the sentinel row creates a standalone directory')
assert(workspace.replaceCalls.at(-1).id === 's-real', 'and opens it with replaceMain')

console.log('client/cordis.integration.test.mjs: all assertions passed')

