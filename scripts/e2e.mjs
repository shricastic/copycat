// Scripted smoke checks against a running dev app, driven over the Chrome DevTools Protocol.
//
//   node scripts/e2e.mjs
//
// Starts `electron-vite dev` with COPYCAT_E2E=1 (exposes a test hook on globalThis.__copycat in
// the main process), connects to the main-process inspector and the renderer, runs checks,
// then shuts the app down. Synthetic OS-level clicks are not used, so this cannot prove how a
// real tray click interleaves with blur; it checks our handling of that sequence.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const MAIN_PORT = 9339
const RENDERER_PORT = 9223

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
