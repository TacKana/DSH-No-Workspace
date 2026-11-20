import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Use Chromium's debugging pipe and an empty browser profile owned by the test.
function chromium(tmp) {
  const executable = process.env.DSH_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const browser = spawn(executable, [
    '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync', '--window-size=1280,900',
    `--user-data-dir=${path.join(tmp, 'browser')}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
  const pending = new Map()
  const events = []
  let serial = 0
  let buffer = ''
  const exited = once(browser, 'exit')
  browser.stdio[4].setEncoding('utf8')
  browser.stdio[4].on('data', chunk => {
    const frames = (buffer + chunk).split('\0')
    buffer = frames.pop()
    for (const frame of frames) {
      const response = JSON.parse(frame)
      if (response.id !== undefined) {
        pending.get(response.id)?.(response)
      } else if (response.method === 'Runtime.exceptionThrown') {
        events.push(`EXC ${response.params.exceptionDetails.exception?.description ?? response.params.exceptionDetails.text}`)
      } else if (response.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(response.params.type)) {
        events.push(`${response.params.type.toUpperCase()} ${response.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400)}`)
      }
    }
  })
  function send(method, params = {}, sessionId) {
    const id = ++serial
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(Error(`Browser timed out during ${method}`))
      }, 10000)
      pending.set(id, response => {
        clearTimeout(timeout)
        pending.delete(id)
        if (response.error) reject(Error(response.error.message))
        else resolve(response.result)
      })
      browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0')
    })
  }
  return { send, events, async close() {
    await send('Browser.close').catch(() => browser.kill())
    await exited
  } }
}

export async function verifyBrowser({ launch, tmp, dirs, rpc, until }) {
  const browser = chromium(tmp)
  let probe
  try {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
    const call = (method, params) => browser.send(method, params, sessionId)
    const run = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
      return result.result.value
    }
    probe = run
    const buttons = `Array.from(document.querySelectorAll('button[aria-label]'))`
    const editor = `document.querySelector('[data-conversation-session] [contenteditable="true"]')`
    const currentId = () => run(`document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session')`)
    async function changedSession(previous, label) {
      return until(async () => {
        const id = await currentId()
        if (id && id !== previous) return id
      }, label, 15000)
    }
    async function click(selector, label) {
      await until(() => run(`!!(${selector})`), label)
      await run(`(${selector}).click()`)
    }
    async function press(key) {
      for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, ...key })
    }
    async function summary(id) {
      const { items } = await rpc('session/list', { _request: {} })
      return items.find(row => row.sessionId === id)
    }
    const directoryCount = async () => (await readdir(dirs.chats)).length

    await call('Runtime.enable')
    await call('Page.enable')
    await call('Page.navigate', { url: launch })
    const initialCount = await directoryCount()
    const newButton = `${buttons}.filter(b => /^(new (session|chat|conversation)|新建(会话|对话))$/i.test(b.getAttribute('aria-label')) && b.offsetWidth > 0).at(-1)`
    await until(() => run(`!!(${newButton})`), 'global New Session button')
    const previous = await currentId()
    await run(`(${newButton}).click()`)
    const created = await changedSession(previous, 'native global creation')
    assert.equal((await summary(created)).cwd, path.join(dirs.chats, `dsh-chat-${created}`))
    assert.equal(await directoryCount(), initialCount + 1)
    await until(() => run(`!!(${editor})`), 'editable native composer')
    await call('Page.reload', { ignoreCache: true })
    await until(async () => await currentId() === created && await run(`!!(${editor})`), 'restored composer')

    const heroChip = `Array.from(document.querySelectorAll('[data-conversation-session] button[aria-label]')).find(b => /choose workspace|选择工作区/i.test(b.getAttribute('aria-label')))`
    assert.equal(await run(`(${heroChip})?.textContent.trim()`), '不在工作区中工作',
      'the chip shows the localized phrase, not the folder name')
    const beforeSecondClick = await directoryCount()
    await run(`(${newButton}).click()`)
    await delay(1200)
    assert.equal(await currentId(), created, 'a second New Session click keeps the blank conversation')
    assert.equal(await directoryCount(), beforeSecondClick, 'and allocates no other directory')
    console.log('Browser verified: localized hero label and no extra directory on a repeat New Session click.')

    await run(`(${editor}).focus()`)
    await call('Input.insertText', { text: 'Reply with OK. This is an integration test.' })
    await press({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await until(async () => (await summary(created))?.blank === false, 'first message accepted')
    console.log('Browser verified: global New Session, refresh, editable composer and first message submission.')

    // The native shortcut also allocates its own directory once the previous
    // conversation has started a turn.
    await press({ key: 'n', code: 'KeyN', modifiers: 3, windowsVirtualKeyCode: 78 })
    const keyboard = await changedSession(created, 'native New Session shortcut')
    assert.equal((await summary(keyboard)).cwd, path.join(dirs.chats, `dsh-chat-${keyboard}`))
    assert.equal(await directoryCount(), initialCount + 2)
    console.log('Browser verified: native New Session shortcut allocates its own directory.')

    // From the blank automatic chat, pick an existing Workspace. The picker must
    // never list an automatic directory.
    const project = path.join(dirs.documents, 'Manual project')
    await mkdir(project)
    await rpc('workspace/create', { request: { path: project } })
    const chip = `${buttons}.find(b => b.closest('[data-conversation-session]') && /choose workspace|选择工作区/i.test(b.getAttribute('aria-label')))`
    const choices = `Array.from(document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"]'))`
    const texts = `${choices}.map(e => e.textContent.trim())`

    await click(chip, 'workspace selector')
    await until(() => run(`${texts}.some(t => t.includes('Manual project'))`), 'manual project in picker')
    assert(!await run(`${texts}.some(t => t.includes('dsh-chat-'))`), 'an automatic directory reached the picker')
    await run(`(${choices}.find(e => e.textContent.includes('Manual project'))).click()`)
    const selected = await changedSession(keyboard, 'choose existing project')
    assert.equal((await summary(selected)).cwd, project)
    assert.equal(await directoryCount(), initialCount + 2)
    console.log('Browser verified: clean picker and selection of an existing project.')

    // That conversation belongs to the Workspace, so the chip names the project.
    await until(async () => await run(`${chip}?.textContent.trim()`) === 'Manual project', 'workspace chip title')

    // A New Session click in the blank Workspace conversation keeps it (native reuse).
    const beforeRepeat = await directoryCount()
    await run(`(${newButton}).click()`)
    await delay(1200)
    assert.equal(await currentId(), selected, 'a New Session click keeps the blank Workspace conversation')
    assert.equal(await directoryCount(), beforeRepeat, 'and allocates no directory')
    assert.equal((await summary(selected)).cwd, project, 'the project directory is untouched')
    console.log('Browser verified: workspace conversation kept its cwd with zero extra automatic directories.')

    // The menu's footer group carries 不使用工作区 immediately above 添加工作区.
    // The action lives in the menu DOM, not in the Workspace snapshot, so no
    // other surface (sidebar, counts, palette) can ever see it.
    const sidebarText = `(document.querySelector('[data-slot="sidebar"]')?.innerText ?? '')`
    await click(chip, 'workspace selector (from a project)')
    const entry = `${choices}.find(e => e.textContent.trim() === '不使用工作区')`
    await until(() => run(`!!(${entry})`), 'not-in-workspace entry')
    const placement = await run(`(() => {
      const entry = ${entry}
      const footer = entry.closest('[role="presentation"][class*="footer"]')
      if (footer === null) return { inFooter: false }
      const add = Array.from(footer.querySelectorAll('[role="menuitem"]'))
        .find(e => /添加工作区|Add .*folder/i.test(e.textContent))
      return {
        inFooter: true,
        addFound: add !== undefined,
        // Document order inside the same footer group: the action precedes the add row.
        beforeAdd: add !== undefined
          && (entry.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        hasCheck: entry.querySelector('[class*="check"]') !== null,
        icon: entry.querySelector('[class*="itemIcon"] svg')?.getAttribute('data-icon') ?? null,
      }
    })()`)
    assert.equal(placement.inFooter, true, 'the entry renders inside the footer group')
    assert.equal(placement.addFound, true, 'the footer still carries 添加工作区')
    assert.equal(placement.beforeAdd, true, 'the entry sits in the footer above 添加工作区')
    assert.equal(placement.hasCheck, false, 'the action shows no selection tick')
    assert.equal(placement.icon, 'dsw-icon-close-outline-regular', 'the action shows its own glyph')
    assert(!await run(`${texts}.some(t => t.includes('dsh-chat-'))`), 'an automatic directory reached the picker')
    assert.equal(await run(`${sidebarText}.includes('Manual project')`), true, 'the real Workspace row is visible')
    assert.equal(await run(`${sidebarText}.includes('不使用工作区')`), false, 'the sidebar never shows the menu action')

    await run(`(${entry}).click()`)
    const left = await changedSession(selected, 'leave the workspace')
    assert.equal((await summary(left)).cwd, path.join(dirs.chats, `dsh-chat-${left}`))
    assert.equal(await directoryCount(), initialCount + 3)
    await until(() => run(`!!(${editor})`), 'editable composer in the new automatic chat')
    assert.equal(await run(`${heroChip}?.textContent.trim()`), '不在工作区中工作')
    assert.equal(await run(`${sidebarText}.includes('不使用工作区')`), false, 'the sidebar still shows no action row')
    console.log('Browser verified: 不使用工作区 sits beside 添加工作区 and leaves the Workspace.')

    // The caret lands in the composer, so the user can type without clicking.
    await until(() => run(`Boolean(document.activeElement && document.activeElement.closest('[contenteditable="true"]'))`),
      'composer focused after leaving a Workspace', 8000)
    console.log('Browser verified: the new chat leaves the caret in the composer.')

    // Other menus are never injected: the session actions menu has no such row.
    const actions = `${buttons}.find(b => /^会话.*的操作$/.test(b.getAttribute('aria-label')))`
    await click(actions, 'session actions menu')
    await until(() => run(`!!(document.querySelector('[role="menu"]'))`), 'session actions menu open')
    assert(!await run(`Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]'))
      .some(e => e.textContent.trim() === '不使用工作区')`), 'the session actions menu is not injected')
    await press({ key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    console.log('Browser verified: unrelated menus never gain the picker action.')
  } catch (error) {
    if (browser.events.length > 0) console.error('Browser page errors:\n' + browser.events.slice(-12).join('\n'))
    try {
      console.error('State:', JSON.stringify(await probe(`({
        session: document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null,
        labels: Array.from(document.querySelectorAll('button[aria-label]')).map(b => b.getAttribute('aria-label')).slice(0, 40),
        editors: document.querySelectorAll('[contenteditable="true"]').length,
        menuInSession: Boolean(document.querySelector('[role="menu"]')?.closest('[data-conversation-session]')),
        menuParent: document.querySelector('[role="menu"]')?.parentElement?.className ?? null,
        text: document.body.innerText.slice(0, 300),
      })`)))
    } catch (stateError) { console.error('State unavailable:', stateError.message) }
    throw error
  } finally {
    await browser.close()
  }
}
