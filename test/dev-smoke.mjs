// 在 DSH 的 Windows shell 中运行。加 --browser 还会验证原生 Web UI。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const profile = 'dev_DSH-No-Workspace'
const cli = path.resolve(process.env.DSH_INSTALL_DIR, '../dsh-desktop-host/lib/cli.js')
const tmp = await mkdtemp(path.join(os.tmpdir(), 'dsh-no-workspace-test-'))
const dirs = Object.fromEntries(['sessions', 'storages', 'documents', 'chats'].map(name => [name, path.join(tmp, name)]))
const defaultRoot = process.argv.includes('--default-root')
const profileRoot = path.resolve(process.env.DSH_HOME, 'profiles', profile, 'session-workspaces')
const rootExisted = defaultRoot && await stat(profileRoot).then(() => true, error => {
  if (error.code === 'ENOENT') return false
  throw error
})
const owned = []
if (defaultRoot) {
  assert(!process.argv.includes('--browser'), '--default-root verifies the Host default only; drop --browser')
  assert.equal(rootExisted, false, `refusing to create sessions in the existing ${profileRoot}; use the temp-root mode`)
  dirs.chats = profileRoot
}
const patch = path.join(tmp, 'verification.yml')
await mkdir(dirs.documents)
await writeFile(patch, JSON.stringify([
  { id: 'session-persistence-jsonl', config: { root: dirs.sessions } },
  { id: 'storage-json', config: { root: dirs.storages } },
  { id: 'workspace-controller', config: { documentsDirectory: dirs.documents } },
  { id: 'no-workspace', config: { root: defaultRoot ? '' : dirs.chats } },
]))

const child = spawn(process.env.DSH_NODE_EXECUTABLE, [
  '--expose-internals', cli, '--profile', profile, '--patch', patch,
  '--no-open', '--host', '127.0.0.1', '--port', '0',
], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const done = once(child, 'exit')
let output = ''
function collect(chunk) { output = (output + chunk.toString()).slice(-120000) }
child.stdout.on('data', collect)
child.stderr.on('data', collect)

async function until(check, label, timeout = 45000) {
  const deadline = Date.now() + timeout
  do {
    const found = await check()
    if (found) return found
    if (child.exitCode !== null) throw Error(`test Host exited during ${label}`)
    await delay(120)
  } while (Date.now() < deadline)
  throw Error(`timed out during ${label}`)
}

try {
  const launch = await until(() => output.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/\?[^\s\x1b]+)/)?.[1], 'test Host startup')
  const base = new URL(launch).origin
  const login = await fetch(launch, { redirect: 'manual' })
  const cookie = login.headers.getSetCookie().map(entry => entry.split(';')[0]).join('; ')
  assert(cookie, 'dev launch URL must produce a login cookie')

  async function rpc(method, args) {
    const response = await fetch(`${base}/api/${method}`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', method, rpcId: crypto.randomUUID(), payload: { args } }),
      signal: AbortSignal.timeout(30000),
    })
    assert(response.ok, `${method} returned HTTP ${response.status}`)
    const { result } = await response.json()
    if (!result.ok) throw Error(`${method}: ${JSON.stringify(result.error)}`)
    return result.value
  }
  const create = () => rpc('no-workspace/create', { request: {} })
  const created = await Promise.all([create(), create()])
  assert.notEqual(created[0].sessionId, created[1].sessionId)
  assert.notEqual(created[0].cwd, created[1].cwd)
  const list = await rpc('session/list', { _request: {} })
  for (const { sessionId, cwd } of created) {
    assert.equal(cwd, path.join(dirs.chats, `dsh-chat-${sessionId}`))
    assert((await stat(cwd)).isDirectory())
    assert.equal(list.items.find(row => row.sessionId === sessionId)?.cwd, cwd)
    owned.push(cwd)
  }
  const before = await readdir(dirs.chats)
  await assert.rejects(rpc('no-workspace/create', { request: { agentPreset: 'no-such-test-preset' } }))
  assert.deepEqual(await readdir(dirs.chats), before)
  console.log('Host verified: concurrent independent directories, native session cwd, invalid-preset rollback.')

  if (process.argv.includes('--browser')) {
    const { verifyBrowser } = await import('./dev-browser.mjs')
    await verifyBrowser({ launch, tmp, dirs, rpc, until })
  }
  if (defaultRoot) console.log(`Host verified: empty root falls back to ${dirs.chats}.`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (child.exitCode === null) child.kill()
  await done
  if (defaultRoot) {
    for (const dir of owned) {
      assert.equal(path.dirname(dir), profileRoot)
      await rmdir(dir).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    if (!rootExisted) await rmdir(profileRoot).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
  if (path.dirname(tmp) === os.tmpdir() && path.basename(tmp).startsWith('dsh-no-workspace-test-')) {
    await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}
