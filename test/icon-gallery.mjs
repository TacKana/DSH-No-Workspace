// 导出运行中的 DSH Web 应用能渲染的每个图标，并渲染一张带标签的
// 缩略图总览。用法：node test/icon-gallery.mjs [out.png]
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const profile = 'dev_DSH-No-Workspace'
const cli = path.resolve(process.env.DSH_INSTALL_DIR, '../dsh-desktop-host/lib/cli.js')
const out = path.resolve(process.argv[2] ?? 'icon-gallery.png')
const tmp = await mkdtemp(path.join(os.tmpdir(), 'dsh-icons-'))
const dirs = Object.fromEntries(['sessions', 'storages', 'documents', 'chats'].map(name => [name, path.join(tmp, name)]))
await mkdir(dirs.documents)
const patch = path.join(tmp, 'verification.yml')
await writeFile(patch, JSON.stringify([
  { id: 'session-persistence-jsonl', config: { root: dirs.sessions } },
  { id: 'storage-json', config: { root: dirs.storages } },
  { id: 'workspace-controller', config: { documentsDirectory: dirs.documents } },
]))

const child = spawn(process.env.DSH_NODE_EXECUTABLE, [
  '--expose-internals', cli, '--profile', profile, '--patch', patch,
  '--no-open', '--host', '127.0.0.1', '--port', '0',
], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const done = once(child, 'exit')
let output = ''
child.stdout.on('data', chunk => { output += chunk.toString() })
child.stderr.on('data', chunk => { output += chunk.toString() })

const chrome = spawn(process.env.DSH_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-sync', '--window-size=1400,1600',
  `--user-data-dir=${path.join(tmp, 'browser')}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
const chromeDone = once(chrome, 'exit')
let buffer = ''
let serial = 0
const pending = new Map()
chrome.stdio[4].setEncoding('utf8')
chrome.stdio[4].on('data', chunk => {
  const frames = (buffer + chunk).split('\0')
  buffer = frames.pop()
  for (const frame of frames) {
    const response = JSON.parse(frame)
    pending.get(response.id)?.(response)
  }
})
function send(method, params = {}, sessionId) {
  const id = ++serial
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`timed out during ${method}`)) }, 15000)
    pending.set(id, response => {
      clearTimeout(timer)
      pending.delete(id)
      response.error ? reject(Error(response.error.message)) : resolve(response.result)
    })
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0')
  })
}

try {
  const deadline = Date.now() + 60000
  let launch
  while (launch === undefined) {
    launch = output.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/\?[^\s\x1b]+)/)?.[1]
    if (launch === undefined) {
      if (child.exitCode !== null) throw Error('dev Host exited')
      if (Date.now() > deadline) throw Error('dev Host did not print a URL')
      await delay(150)
    }
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  await send('Page.navigate', { url: launch }, sessionId)
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const started = Date.now()
  while (await run(`document.querySelectorAll('symbol[id^="dsw-icon-"]').length`) === 0) {
    if (Date.now() - started > 45000) throw Error('no icon symbols appeared')
    await delay(300)
  }
  const ids = await run(`[...document.querySelectorAll('symbol[id^="dsw-icon-"]')].map(s => s.id)`)
  await run(`(() => {
    const ids = ${JSON.stringify(ids)}
    // 雪碧图存在于页面中；保留每个定义了 symbol 的 <svg>。
    const defs = [...document.querySelectorAll('svg')]
      .filter(svg => svg.querySelector('symbol') !== null)
      .map(svg => svg.outerHTML)
      .join('')
    document.body.innerHTML = defs
    document.body.style.cssText = 'margin:0;padding:24px;background:#fff;font:12px/1.4 system-ui;color:#222'
    const head = document.createElement('h1')
    head.textContent = 'DSH icons (' + ids.length + ')'
    head.style.cssText = 'font:600 18px system-ui;margin:0 0 16px'
    document.body.append(head)
    const grid = document.createElement('div')
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:14px'
    for (const id of ids) {
      const cell = document.createElement('div')
      cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;border:1px solid #e6e6e6;border-radius:8px'
      const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      holder.setAttribute('width', '24')
      holder.setAttribute('height', '24')
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
      use.setAttribute('href', '#' + id)
      holder.append(use)
      const label = document.createElement('div')
      label.textContent = id.replace(/^dsw-icon-/, '')
      label.style.cssText = 'text-align:center;word-break:break-all;color:#555'
      cell.append(holder, label)
      grid.append(cell)
    }
    document.body.append(grid)
  })()`)
  const box = await run(`(() => { const r = document.body.getBoundingClientRect(); return { width: Math.ceil(r.width), height: Math.ceil(document.body.scrollHeight) } })()`)
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: box.width, height: box.height, scale: 1 },
  }, sessionId)
  await writeFile(out, Buffer.from(shot.data, 'base64'))
  await writeFile(out.replace(/\.png$/i, '.txt'), ids.map(id => id.replace(/^dsw-icon-/, '')).join('\n') + '\n')
  console.log(`icons: ${ids.length}`)
  console.log(`gallery: ${out}`)
  console.log(ids.map(id => id.replace(/^dsw-icon-/, '')).join(' '))
} finally {
  await send('Browser.close').catch(() => chrome.kill())
  await chromeDone
  if (child.exitCode === null) child.kill()
  await done
  await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
