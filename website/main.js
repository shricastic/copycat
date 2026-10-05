// Copycat site: the live demo popup and the download links. No dependencies.

const REPO = 'shricastic/copycat'
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

const isWindows = /Windows/i.test(navigator.userAgentData?.platform ?? navigator.userAgent)

// ---------- shortcut labels ----------

// The markup shows ⌘⇧V; Windows visitors see Ctrl Shift V instead.
if (isWindows) {
  for (const el of document.querySelectorAll('[data-shortcut]')) {
    for (const kbd of el.querySelectorAll('kbd')) {
      if (kbd.textContent === '⌘') kbd.textContent = 'Ctrl'
      else if (kbd.textContent === '⇧') kbd.textContent = 'Shift'
    }
  }
}

// ---------- menu bar clock ----------

const clock = document.getElementById('clock')
function tickClock() {
  clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
tickClock()
setInterval(tickClock, 15_000)

// ---------- demo popup ----------

const MAX_UNPINNED = 7
const now = () => Date.now()
const ago = (seconds) => now() - seconds * 1000

// Starting history: the kind of things people copy, with two pinned favourites.
let items = [
  { text: '221B Baker Street, London NW1 6XE', at: ago(9 * 86400), pinned: true },
  { text: 'pnpm install && pnpm dev', at: ago(3 * 86400), pinned: true },
  { text: 'https://github.com/shricastic/copycat', at: ago(40) },
  {
    text: 'const accent = systemPreferences.getAccentColor()\nreturn `#${accent.slice(0, 6)}`',
    at: ago(3 * 60)
  },
  { text: 'Meeting moved to Thursday 3pm, same room', at: ago(26 * 60) },
  { text: '#2f6cf6', at: ago(70 * 60) },
  { text: 'git commit -m "Fix tray icon on Windows"', at: ago(3 * 3600) },
  { text: 'Ship the landing page before Friday', at: ago(2 * 86400) }
]

const popup = document.getElementById('demo-popup')
const list = document.getElementById('demo-list')
const search = document.getElementById('demo-search')
const trayIcon = document.getElementById('tray-icon')
const hero = document.querySelector('.desktop')

let selected = 0
let arrivedText = null
let copiedText = null

/** Same compact ages as the app: 5s, 3m, 2h, 4d, 1w. */
function compactAge(at) {
  const s = Math.max(1, Math.floor((now() - at) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return `${Math.floor(s / 604800)}w`
}

const SVG_NS = 'http://www.w3.org/2000/svg'
function icon(className, shapes) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('class', className)
  svg.setAttribute('aria-hidden', 'true')
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    svg.append(el)
  }
  return svg
}
const copyIcon = () =>
  icon('row-copy', [
    ['rect', { x: 5.25, y: 5.25, width: 8.5, height: 8.5, rx: 2 }],
    [
      'path',
      {
        d: 'M10.75 3.25v-.5a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5v6a1.5 1.5 0 0 0 1.5 1.5h.5'
      }
    ]
  ])
const pinIcon = () =>
  icon('row-pin', [
    [
      'path',
      {
        d: 'M9.6 1.9 14.1 6.4a.6.6 0 0 1-.25 1L11.2 8.2 8.9 10.5l.35 2.6a.6.6 0 0 1-1 .5L2.4 7.75a.6.6 0 0 1 .5-1l2.6.35L7.8 4.8 8.6 2.15a.6.6 0 0 1 1-.25Z'
      }
    ],
    ['path', { d: 'M5.3 10.7 1.75 14.25' }]
  ])

/** What the list shows: pinned first, then the rest, filtered by the search box. */
function visibleItems() {
  const q = search.value.trim().toLowerCase()
  const matches = q ? items.filter((i) => i.text.toLowerCase().includes(q)) : items
  return [...matches.filter((i) => i.pinned), ...matches.filter((i) => !i.pinned)]
}

function render() {
  const visible = visibleItems()
  selected = Math.min(selected, Math.max(0, visible.length - 1))
  const pinnedCount = visible.filter((i) => i.pinned).length
  list.replaceChildren()

  if (visible.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'popup-empty'
    empty.textContent = `Nothing matches “${search.value.trim()}”.`
    list.append(empty)
    return
  }

  visible.forEach((item, index) => {
    const li = document.createElement('li')
    li.className = 'row'
    li.setAttribute('role', 'option')
    li.setAttribute('aria-selected', String(index === selected))
    if (index === selected) li.classList.add('selected')
    if (index === pinnedCount - 1 && pinnedCount < visible.length) li.classList.add('last-pinned')
    if (item.text === arrivedText) li.classList.add('arrived')

    const text = document.createElement('div')
    const trimmed = item.text.trim()
    text.className = trimmed.includes('\n') ? 'row-text mono' : 'row-text'
    // textContent, never innerHTML: copied text is untrusted.
    text.textContent = trimmed.slice(0, 400)

    const aside = document.createElement('div')
    aside.className = 'row-aside'
    if (item.text === copiedText) {
      const done = document.createElement('span')
      done.className = 'row-done'
      done.textContent = 'Copied'
      aside.append(done)
    } else {
      if (item.pinned) {
        aside.append(pinIcon())
      } else {
        const age = document.createElement('span')
        age.className = 'row-age'
        age.dataset.at = String(item.at)
        age.textContent = compactAge(item.at)
        aside.append(age)
      }
      aside.append(copyIcon())
    }

    li.append(text, aside)
    li.addEventListener('mousemove', () => select(index))
    li.addEventListener('click', () => copyFromDemo(item.text))
    list.append(li)
  })
}

/** Move the highlight without rebuilding the list (rows stay put under the pointer). */
function select(index) {
  if (index === selected) return
  const rows = list.querySelectorAll('.row')
  rows[selected]?.classList.remove('selected')
  rows[selected]?.setAttribute('aria-selected', 'false')
  selected = index
  rows[selected]?.classList.add('selected')
  rows[selected]?.setAttribute('aria-selected', 'true')
}

function scrollSelectedIntoView() {
  list.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
}

/** Like the app: a new copy goes to the top; copying an existing item moves it up. */
function record(text) {
  const existing = items.find((i) => i.text === text)
  const entry = { text, at: now(), pinned: existing?.pinned ?? false }
  const rest = items.filter((i) => i !== existing)
  const pinned = rest.filter((i) => i.pinned)
  const unpinned = rest.filter((i) => !i.pinned)
  items = entry.pinned
    ? [entry, ...pinned, ...unpinned]
    : [...pinned, entry, ...unpinned.slice(0, MAX_UNPINNED - 1)]
  arrivedText = text
  search.value = ''
  selected = 0
  render()
  list.scrollTop = 0
  setTimeout(() => {
    if (arrivedText === text) arrivedText = null
  }, 1500)
}

// Anything copied on this page lands in the demo, as it would in the real app.
// The popup opens (without taking focus) so the visitor sees their copy arrive.
document.addEventListener('copy', () => {
  const text = (document.getSelection()?.toString() ?? '').trim()
  if (!text) return
  if (!isOpen()) setOpen(true, { focus: false })
  record(text)
})

// Picking a row puts it on the real clipboard, like choosing an item in Copycat.
async function copyFromDemo(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return // clipboard access denied (e.g. insecure context): nothing to confirm
  }
  copiedText = text
  render()
  setTimeout(() => {
    if (copiedText === text) {
      copiedText = null
      render()
    }
  }, 1200)
}

// Open and close, like the real popup: ⌘⇧V, the tray icon, or Esc.
function isOpen() {
  return !popup.classList.contains('closed')
}

/** Open or close. `focus: false` shows it without moving focus (used when text is copied). */
function setOpen(open, { focus = true } = {}) {
  popup.classList.toggle('closed', !open)
  trayIcon.setAttribute('aria-expanded', String(open))
  if (open) {
    search.value = ''
    selected = 0
    render()
    list.scrollTop = 0
    if (focus) search.focus({ preventScroll: true })
  } else if (popup.contains(document.activeElement)) {
    trayIcon.focus({ preventScroll: true })
  }
}

trayIcon.addEventListener('click', () => setOpen(!isOpen()))
// The "Try the menu bar demo" button: same as the tray icon, for mouse and touch visitors.
document.getElementById('demo-chip')?.addEventListener('click', () => setOpen(!isOpen()))

document.addEventListener('keydown', (e) => {
  const mod = isWindows ? e.ctrlKey : e.metaKey
  if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
    // Leave paste-and-match-style alone in other editable fields on the page.
    const t = e.target
    const editable =
      t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))
    if (editable && t !== search) return
    e.preventDefault()
    // If the hero is scrolled away, bring it back so the popup is actually visible.
    if (!isOpen() && hero.getBoundingClientRect().bottom < 120) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    setOpen(!isOpen())
    return
  }

  if (!isOpen() || !popup.contains(document.activeElement)) return
  const visible = visibleItems()
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      select(Math.min(selected + 1, visible.length - 1))
      scrollSelectedIntoView()
      break
    case 'ArrowUp':
      e.preventDefault()
      select(Math.max(selected - 1, 0))
      scrollSelectedIntoView()
      break
    case 'Enter':
      e.preventDefault()
      if (visible[selected]) copyFromDemo(visible[selected].text)
      break
    case 'Escape':
      e.preventDefault()
      setOpen(false)
      break
  }
})

search.addEventListener('input', () => {
  selected = 0
  render()
})

// Ages tick like the app's: update the text in place, so rows never change under a click.
setInterval(() => {
  if (document.hidden || !isOpen()) return
  for (const age of list.querySelectorAll('.row-age')) {
    age.textContent = compactAge(Number(age.dataset.at))
  }
}, 1000)
render()

// ---------- product demo video ----------

// Autoplay (muted, looping) only while the video is on screen, so it isn't downloaded or
// decoded for visitors who never scroll to it. Visitors who asked for reduced motion or
// data saving get a normal video with controls instead.
const demoVideo = document.getElementById('product-demo')
const demoToggle = document.getElementById('product-demo-toggle')
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const saveData = navigator.connection?.saveData === true

if (demoVideo && (prefersReducedMotion || saveData || !('IntersectionObserver' in window))) {
  demoVideo.controls = true
} else if (demoVideo) {
  let pausedByUser = false
  demoToggle.hidden = false

  const syncToggle = () => {
    demoToggle.classList.toggle('paused', demoVideo.paused)
    demoToggle.setAttribute('aria-label', demoVideo.paused ? 'Play video' : 'Pause video')
  }
  demoVideo.addEventListener('play', syncToggle)
  demoVideo.addEventListener('pause', syncToggle)

  const play = () =>
    demoVideo.play().catch(() => {
      // Autoplay refused by the browser: fall back to normal controls.
      demoVideo.controls = true
      demoToggle.hidden = true
    })

  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && !pausedByUser) play()
      else if (!entry.isIntersecting) demoVideo.pause()
    },
    { threshold: 0.35 }
  ).observe(demoVideo)

  demoToggle.addEventListener('click', () => {
    pausedByUser = !demoVideo.paused
    if (pausedByUser) demoVideo.pause()
    else play()
  })
}

// ---------- downloads ----------

const PLATFORM_ASSETS = {
  'mac-arm64': /-arm64\.dmg$/,
  'mac-x64': /-x64\.dmg$/,
  'win-x64': /-setup\.exe$/,
  'linux-appimage': /\.AppImage$/,
  'linux-deb': /\.deb$/
}

const PLATFORM_LABELS = {
  'mac-arm64': 'Download for Mac',
  'mac-x64': 'Download for Mac (Intel)',
  'win-x64': 'Download for Windows',
  'linux-appimage': 'Download for Linux'
}

/**
 * Best guess at the visitor's platform. Chromium browsers can report the CPU architecture;
 * Safari and Firefox can't, so a Mac defaults to Apple silicon (every Mac sold since 2023)
 * and the Intel download stays one click away.
 */
async function detectPlatform() {
  const ua = navigator.userAgent
  const uaData = navigator.userAgentData
  const platform = uaData?.platform ?? ''
  if (/Windows/i.test(platform) || /Windows NT/.test(ua)) return 'win-x64'
  // Linux desktops get the AppImage (runs on most distributions); Android isn't a target.
  if ((/Linux/i.test(platform) || /Linux/.test(ua)) && !/Android/i.test(ua)) return 'linux-appimage'
  if (!/mac/i.test(platform) && !/Macintosh/.test(ua)) return null
  // iPhone/iPad (iPadOS also reports Macintosh): no desktop app to offer.
  if (navigator.maxTouchPoints > 1) return null
  try {
    const { architecture } = await uaData.getHighEntropyValues(['architecture'])
    if (architecture === 'x86') return 'mac-x64'
  } catch {
    // not available
  }
  return 'mac-arm64'
}

function formatSize(bytes) {
  return `${Math.round(bytes / 1048576)} MB`
}

async function setUpDownloads() {
  const detected = await detectPlatform()
  const primary = document.getElementById('primary-download')
  const alt = document.getElementById('alt-download')

  if (detected) {
    primary.textContent = PLATFORM_LABELS[detected]
    document.querySelector(`[data-platform="${detected}"]`)?.classList.add('recommended')
    const row = document.querySelector(`[data-platform="${detected}"] h3`)
    if (row) {
      const tag = document.createElement('span')
      tag.className = 'this-computer'
      tag.textContent = 'This computer'
      row.append(tag)
    }
    alt.textContent = detected.startsWith('mac') ? 'Other downloads' : 'Other platforms'
  }

  // Point every button at the latest release's files. If GitHub can't be reached, the
  // buttons keep linking to the Releases page.
  let release
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    release = await res.json()
  } catch {
    if (detected) primary.href = RELEASES_PAGE
    return
  }

  const version = release.tag_name?.replace(/^v/, '')
  document.getElementById('version-note').textContent =
    `Version ${version}. Free for macOS, Windows and Linux.`
  document.getElementById('download-version').textContent = `Version ${version}`

  for (const [key, pattern] of Object.entries(PLATFORM_ASSETS)) {
    const asset = release.assets?.find((a) => pattern.test(a.name))
    const row = document.querySelector(`[data-platform="${key}"]`)
    if (!asset || !row) continue
    const button = row.querySelector('.button')
    button.href = asset.browser_download_url
    button.title = `${asset.name} (${formatSize(asset.size)})`
    row.querySelector('p').textContent += `. ${formatSize(asset.size)}`
    if (key === detected) primary.href = asset.browser_download_url
  }
}

setUpDownloads()
