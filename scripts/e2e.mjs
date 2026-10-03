// Scripted smoke checks against a running dev app, driven over the Chrome DevTools Protocol.
//
//   node scripts/e2e.mjs
//
// Starts `electron-vite dev` with COPYCAT_E2E=1 (exposes a test hook on globalThis.__copycat in
// the main process), connects to the main-process inspector and the renderer, runs checks,
// then shuts the app down. Synthetic OS-level clicks are not used, so this cannot prove how a
// real tray click interleaves with blur; it checks our handling of that sequence.

import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, basename } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const MAIN_PORT = 9339
const RENDERER_PORT = 9223

// A running Copycat instance would record the test strings this script copies into your real
// history. Refuse to run alongside one.
if (process.platform !== 'win32') {
  try {
    const running = execFileSync('pgrep', ['-f', 'copycat/node_modules/electron/dist'], {
      encoding: 'utf8'
    })
    if (running.trim()) {
      console.error(
        'Another Copycat dev instance is running (it would record test clipboard data).'
      )
      console.error(`Quit it first. PIDs: ${running.trim().split('\n').join(', ')}`)
      process.exit(2)
    }
  } catch {
    // pgrep exits 1 when nothing matches
  }
}

const child = spawn(
  'npx',
  [
    'electron-vite',
    'dev',
    '--inspect',
    String(MAIN_PORT),
    '--remoteDebuggingPort',
    String(RENDERER_PORT)
  ],
  { env: { ...process.env, COPYCAT_E2E: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true }
)
let appLog = ''
child.stdout.on('data', (d) => (appLog += d))
child.stderr.on('data', (d) => (appLog += d))

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

async function waitFor(fn, timeoutMs = 30000) {
  const start = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      // not ready yet
    }
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await sleep(250)
  }
}

async function connect(wsUrl, onEvent = () => {}) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method) onEvent(msg)
  }
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id
      pending.set(i, res)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
      includeCommandLineAPI: true
    })
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed')
    }
    return r.result?.result?.value
  }
  return { ws, send, evaluate }
}

const rendererLogs = []

// These checks use the real system clipboard; save and restore the user's text.
const isMac = process.platform === 'darwin'
const clipBackup = isMac ? execFileSync('pbpaste') : null
const tag = `e2e-${Date.now().toString(36)}`

/** Put text on the macOS pasteboard together with marker types, like a password manager. */
function writeMarkedPasteboard(text, markers) {
  const script = `ObjC.import('AppKit');
    const pb = $.NSPasteboard.generalPasteboard; pb.clearContents;
    const types = ['public.utf8-plain-text', ...${JSON.stringify(markers)}];
    pb.declareTypesOwner($(types), $());
    pb.setStringForType($(${JSON.stringify(text)}), 'public.utf8-plain-text');
    for (const m of ${JSON.stringify(markers)}) pb.setStringForType($(''), m);`
  execFileSync('osascript', ['-l', 'JavaScript', '-e', script])
}

try {
  const mainTarget = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${MAIN_PORT}/json/list`)).json()
    return list[0]
  })
  const main = await connect(mainTarget.webSocketDebuggerUrl)
  // Main-process prelude: electron module + test hook.
  const M = `const { screen } = globalThis.__copycat.electron;
    const h = globalThis.__copycat; const w = h.windowApi; const win = w.getPopupWindow();`
  await waitFor(() => main.evaluate(`return !!globalThis.__copycat`))

  const pageTarget = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${RENDERER_PORT}/json/list`)).json()
    return list.find((t) => t.type === 'page')
  })
  const page = await connect(pageTarget.webSocketDebuggerUrl, (msg) => {
    if (msg.method === 'Log.entryAdded') rendererLogs.push(msg.params.entry)
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
      rendererLogs.push({
        level: msg.params.type,
        text: msg.params.args.map((a) => a.value).join(' ')
      })
    if (msg.method === 'Runtime.exceptionThrown')
      rendererLogs.push({ level: 'exception', text: msg.params.exceptionDetails.text })
  })
  await page.send('Log.enable')
  await page.send('Runtime.enable')
  // Reload so CSP violations during initial load are captured.
  await page.send('Page.reload')
  await waitFor(() => page.evaluate(`return !!document.querySelector('.app')`))

  // ---- renderer isolation
  const iso = await page.evaluate(
    `return { require: typeof require, process: typeof process, api: Object.keys(window.api ?? {}).sort() }`
  )
  check(
    'renderer has no require/process',
    iso.require === 'undefined' && iso.process === 'undefined'
  )
  check(
    'window.api exposed',
    iso.api.includes('getState') && iso.api.includes('quit'),
    iso.api.join(',')
  )

  // ---- tray + initial state
  const init = await main.evaluate(`${M} return {
    visible: win.isVisible(), tray: h.getTray().getBounds(),
    display: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea }`)
  check('popup hidden at start', init.visible === false)
  if (process.platform === 'darwin') {
    const dock = await main.evaluate(`return globalThis.__copycat.electron.app.dock.isVisible()`)
    check('no Dock icon', dock === false)
  }
  check(
    'tray bounds non-empty',
    init.tray.width > 0 && init.tray.height > 0,
    JSON.stringify(init.tray)
  )

  // ---- open from tray
  const open = await main.evaluate(`${M}
    w.togglePopupFromTray(h.getTray().getBounds());
    await new Promise(r => setTimeout(r, 300));
    const b = win.getBounds(); const t = h.getTray().getBounds();
    const wa = screen.getDisplayNearestPoint({ x: t.x + t.width / 2, y: t.y + t.height / 2 }).workArea;
    return { visible: win.isVisible(), focused: win.isFocused(), b, t, wa }`)
  check('tray click opens popup', open.visible)
  check('popup is focused', open.focused)
  const { b, t, wa } = open
  const inside =
    b.x >= wa.x &&
    b.y >= wa.y &&
    b.x + b.width <= wa.x + wa.width &&
    b.y + b.height <= wa.y + wa.height
  check(
    'popup inside work area',
    inside,
    `popup ${JSON.stringify(b)} workArea ${JSON.stringify(wa)}`
  )
  if (process.platform === 'darwin') {
    check(
      'popup is below the menu bar icon',
      b.y >= t.y + t.height,
      `popup.y=${b.y} tray.bottom=${t.y + t.height}`
    )
    const dx = Math.abs(b.x + b.width / 2 - (t.x + t.width / 2))
    check(
      'popup horizontally under icon (or clamped)',
      dx < 1 || b.x + b.width === wa.x + wa.width,
      `dx=${dx}`
    )
  }

  // ---- second click closes
  const closed = await main.evaluate(
    `${M} w.togglePopupFromTray(h.getTray().getBounds()); return win.isVisible()`
  )
  check('tray click while open closes it', closed === false)

  // ---- blur-then-click race: the click that caused the blur must not reopen
  const race = await main.evaluate(`${M}
    w.togglePopupFromTray(h.getTray().getBounds());
    await new Promise(r => setTimeout(r, 200));
    win.emit('blur');              // OS delivers blur first...
    const afterBlur = win.isVisible();
    w.togglePopupFromTray(h.getTray().getBounds()); // ...then the tray click
    const afterClick = win.isVisible();
    await new Promise(r => setTimeout(r, 450));
    w.togglePopupFromTray(h.getTray().getBounds()); // a later, separate click reopens
    const later = win.isVisible();
    return { afterBlur, afterClick, later }`)
  check('blur hides popup', race.afterBlur === false)
  check('tray click right after blur does not reopen', race.afterClick === false)
  check('a later tray click reopens', race.later === true)

  // ---- Esc closes (real key event into the renderer)
  const esc = await main.evaluate(`${M}
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await new Promise(r => setTimeout(r, 300));
    return win.isVisible()`)
  check('Esc closes popup', esc === false)

  // ---- shortcut-style open near cursor stays on screen
  const cur = await main.evaluate(`${M}
    w.togglePopupAtCursor(); await new Promise(r => setTimeout(r, 200));
    const b = win.getBounds(); const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const ok = b.x >= wa.x && b.y >= wa.y && b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height;
    w.hidePopup(); return { ok, b, wa }`)
  check('cursor-positioned popup inside work area', cur.ok, JSON.stringify(cur.b))

  const displays = await main.evaluate(`${M} return screen.getAllDisplays().map(d => d.workArea)`)
  console.log(`info  displays: ${JSON.stringify(displays)}`)

  // ================= Phase 2: watcher, store, IPC, UI =================

  const H = `const h = globalThis.__copycat; const { clipboard } = h.electron;`
  const copy = (text) => main.evaluate(`${H} clipboard.writeText(${JSON.stringify(text)})`)
  const settle = () => sleep(900) // > 2 poll intervals
  const history = () => main.evaluate(`${H} return h.store.getHistory()`)
  const texts = async () => (await history()).map((i) => i.text)

  const A = `${tag}-alpha`
  const B = `${tag}-beta`
  const C = `${tag}-gamma`

  await copy(A)
  await settle()
  check('external copy is recorded', (await texts())[0] === A)

  await copy(B)
  await settle()
  const afterB = await texts()
  check('newest first', afterB[0] === B && afterB[1] === A)

  await copy(A)
  await settle()
  const afterA2 = await texts()
  check(
    're-copy moves to top without duplicating',
    afterA2[0] === A &&
      afterA2.filter((t) => t === A).length === 1 &&
      afterA2.length === afterB.length
  )

  await copy('   \n\t  ')
  await settle()
  check('whitespace-only copy ignored', (await texts())[0] === A)

  if (isMac) {
    writeMarkedPasteboard(`${tag}-concealed`, ['org.nspasteboard.ConcealedType'])
    await settle()
    check('ConcealedType copy ignored', !(await texts()).includes(`${tag}-concealed`))
    writeMarkedPasteboard(`${tag}-transient`, ['org.nspasteboard.TransientType'])
    await settle()
    check('TransientType copy ignored', !(await texts()).includes(`${tag}-transient`))
    writeMarkedPasteboard(`${tag}-plain-native`, [])
    await settle()
    check('unmarked native copy recorded', (await texts())[0] === `${tag}-plain-native`)
  }

  // Renderer received pushed history.
  const domFirst = await page.evaluate(
    `return document.querySelector('.item .item-text')?.textContent`
  )
  check('renderer list updated via push', domFirst === (await texts())[0], domFirst)

  // Paste from the popup (own write): clipboard set, popup hidden, history not reordered.
  const beforePaste = await texts()
  const bItem = (await history()).find((i) => i.text === B)
  await main.evaluate(`${M} w.togglePopupAtCursor()`)
  await page.evaluate(`await window.api.pasteItem(${JSON.stringify(bItem.id)})`)
  await settle()
  const afterPaste = await main.evaluate(
    `${M} return { clip: globalThis.__copycat.electron.clipboard.readText(), visible: win.isVisible() }`
  )
  check('paste writes clipboard', afterPaste.clip === B)
  check('paste closes popup', afterPaste.visible === false)
  check(
    'own write not recorded as a new copy',
    JSON.stringify(await texts()) === JSON.stringify(beforePaste)
  )
  // ...but an external copy of the same text later still counts.
  await copy(C)
  await settle()
  await copy(B)
  await settle()
  check('later external copy of pasted text is recorded', (await texts())[0] === B)

  // Pause / resume.
  await page.evaluate(`await window.api.updateSettings({ paused: true })`)
  await copy(`${tag}-during-pause`)
  await settle()
  check('paused: copy not recorded', !(await texts()).includes(`${tag}-during-pause`))
  const banner = await page.evaluate(`return document.querySelector('.banner')?.textContent`)
  check('paused banner shown', /^Paused\./.test(banner ?? ''), banner)
  await page.evaluate(`await window.api.updateSettings({ paused: false })`)
  await settle()
  check(
    'resume does not record what was copied while paused',
    !(await texts()).includes(`${tag}-during-pause`)
  )
  await copy(`${tag}-after-pause`)
  await settle()
  check('resumed: copy recorded', (await texts())[0] === `${tag}-after-pause`)

  // IPC validation.
  const v = await page.evaluate(`
    const out = {};
    try { await window.api.deleteItem({ evil: 1 }); out.badId = 'accepted' } catch { out.badId = 'rejected' }
    out.neg = (await window.api.updateSettings({ maxHistory: -1 })).ok;
    out.str = (await window.api.updateSettings({ maxHistory: '5' })).ok;
    out.unknown = (await window.api.updateSettings({ __proto__: null, evil: true })).ok;
    out.arr = (await window.api.updateSettings([1])).ok;
    return out`)
  check(
    'invalid IPC payloads rejected',
    v.badId === 'rejected' && !v.neg && !v.str && !v.unknown && !v.arr,
    JSON.stringify(v)
  )

  // Cap: pinned items survive eviction.
  const oldest = (await history()).at(-1)
  await page.evaluate(`await window.api.togglePin(${JSON.stringify(oldest.id)})`)
  await page.evaluate(`await window.api.updateSettings({ maxHistory: 2 })`)
  for (const n of [1, 2, 3]) {
    await copy(`${tag}-cap-${n}`)
    await settle()
  }
  const capped = await history()
  check(
    'cap keeps N newest unpinned + all pinned',
    capped.filter((i) => !i.pinned).length === 2 &&
      capped.some((i) => i.id === oldest.id && i.pinned) &&
      capped[0].text === `${tag}-cap-3`,
    capped.map((i) => `${i.text}${i.pinned ? '*' : ''}`).join(', ')
  )
  await page.evaluate(`await window.api.updateSettings({ maxHistory: 100 })`)

  // Keyboard navigation + search in the real UI.
  await copy(`${tag}-kb-one`)
  await settle()
  await copy(`${tag}-kb-two`)
  await settle()
  const kb = await main.evaluate(`${M}
    const key = (k) => win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k });
    w.togglePopupAtCursor(); await new Promise(r => setTimeout(r, 300));
    key('Down'); await new Promise(r => setTimeout(r, 100));
    key('Return'); await new Promise(r => setTimeout(r, 300));
    return { clip: h.electron.clipboard.readText(), visible: win.isVisible() }`)
  check(
    'ArrowDown + Enter pastes second item',
    kb.clip === `${tag}-kb-one` && !kb.visible,
    JSON.stringify(kb)
  )

  const search = await main.evaluate(`${M}
    w.togglePopupAtCursor(); await new Promise(r => setTimeout(r, 300));
    win.webContents.insertText('kb-tw'); await new Promise(r => setTimeout(r, 200));
    const items = await win.webContents.executeJavaScript(
      "[...document.querySelectorAll('.item .item-text')].map(e => e.textContent)");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await new Promise(r => setTimeout(r, 200));
    return items`)
  check(
    'search filters list',
    search.length === 1 && search[0] === `${tag}-kb-two`,
    JSON.stringify(search)
  )

  const reopened = await main.evaluate(`${M}
    w.togglePopupAtCursor(); await new Promise(r => setTimeout(r, 300));
    const r = await win.webContents.executeJavaScript(
      "({ q: document.querySelector('.search').value, n: document.querySelectorAll('.item').length, focused: document.activeElement?.className })");
    w.hidePopup(); return r`)
  check(
    'reopening resets search and focuses it',
    reopened.q === '' && reopened.n > 1 && reopened.focused === 'search',
    JSON.stringify(reopened)
  )

  // Delete + clear all (keeps pinned).
  const del = (await history())[0]
  await page.evaluate(`await window.api.deleteItem(${JSON.stringify(del.id)})`)
  check('delete removes item', !(await history()).some((i) => i.id === del.id))
  await page.evaluate(`await window.api.clearAll()`)
  const afterClear = await history()
  check('clear all keeps only pinned', afterClear.length === 1 && afterClear[0].pinned)

  // Persistence: debounced atomic write.
  await copy(`${tag}-persist`)
  await settle()
  const file = await main.evaluate(
    `${H} return h.electron.app.getPath('userData') + '/copycat.json'`
  )
  const onDisk = JSON.parse(readFileSync(file, 'utf8'))
  check('saved to disk (debounced)', onDisk.history[0]?.text === `${tag}-persist`)
  check('no temp files left', !readdirSync(dirname(file)).some((f) => f.endsWith('.tmp')))

  // Flush on quit: copy, then quit before the 500 ms debounce fires.
  await copy(`${tag}-last`)
  await waitFor(async () => (await texts())[0] === `${tag}-last`, 2000)
  const savedEarly = JSON.parse(readFileSync(file, 'utf8')).history[0]?.text === `${tag}-last`
  check('recorded but not yet saved (debounce pending)', !savedEarly)
  await main.evaluate(`${H} setTimeout(() => h.electron.app.quit(), 0)`).catch(() => {})
  await sleep(1500)
  const final = JSON.parse(readFileSync(file, 'utf8'))
  check('pending save flushed on quit', final.history[0]?.text === `${tag}-last`)
  if (basename(dirname(file)).startsWith('copycat-e2e-'))
    rmSync(dirname(file), { recursive: true, force: true })

  const bad = rendererLogs.filter(
    (l) =>
      /Content Security Policy|Refused/i.test(l.text) ||
      l.level === 'exception' ||
      l.level === 'error'
  )
  check('no renderer errors / CSP violations', bad.length === 0, bad.map((l) => l.text).join(' | '))
  const warn = rendererLogs.filter((l) => !bad.includes(l))
  for (const l of warn) console.log(`info  renderer ${l.level}: ${l.text}`)

  main.ws.close()
  page.ws.close()
} catch (e) {
  failures++
  console.error('ERROR', e)
  console.error(appLog.slice(-3000))
} finally {
  if (clipBackup !== null) execFileSync('pbcopy', { input: clipBackup })
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // already gone
  }
}

const mainNoise = appLog
  .split('\n')
  .filter((l) => /error|warn|NSWindow/i.test(l) && !/shamefully-hoist/.test(l))
for (const l of mainNoise) console.log(`info  main: ${l.trim()}`)
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
