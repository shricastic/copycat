// Copycat site: the live demo popup and the download links. No dependencies.

const REPO = 'shricastic/copycat'
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

// ---------- menu bar clock ----------

const clock = document.getElementById('clock')
function tickClock() {
  clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
tickClock()
setInterval(tickClock, 15_000)

// ---------- demo popup ----------

const MAX_ITEMS = 8
const now = () => Date.now()
const ago = (seconds) => now() - seconds * 1000

// Starting history: the kind of things people copy.
let items = [
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

const list = document.getElementById('demo-list')
const search = document.getElementById('demo-search')
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
function copyIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('class', 'row-copy')
  svg.setAttribute('aria-hidden', 'true')
  const rect = document.createElementNS(SVG_NS, 'rect')
  for (const [k, v] of Object.entries({ x: 5.25, y: 5.25, width: 8.5, height: 8.5, rx: 2 })) {
    rect.setAttribute(k, v)
  }
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute(
    'd',
    'M10.75 3.25v-.5a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5v6a1.5 1.5 0 0 0 1.5 1.5h.5'
  )
  svg.append(rect, path)
  return svg
}

function render() {
  const q = search.value.trim().toLowerCase()
  const visible = q ? items.filter((i) => i.text.toLowerCase().includes(q)) : items
  list.replaceChildren()

  if (visible.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'popup-empty'
    empty.textContent = items.length
      ? `Nothing matches “${search.value.trim()}”.`
      : 'Text you copy will appear here.'
    list.append(empty)
    return
  }

  for (const item of visible) {
    const li = document.createElement('li')
    li.className = 'row'
    if (item.text === arrivedText) li.classList.add('arrived')
    li.title = 'Click to copy'

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
      const age = document.createElement('span')
      age.className = 'row-age'
      age.textContent = compactAge(item.at)
      aside.append(age, copyIcon())
    }

    li.append(text, aside)
    li.addEventListener('click', () => copyFromDemo(item.text))
    list.append(li)
  }
}

/** Like the app: a new copy goes to the top; copying an existing item moves it up. */
function record(text) {
  items = [{ text, at: now() }, ...items.filter((i) => i.text !== text)].slice(0, MAX_ITEMS)
  arrivedText = text
  search.value = ''
  render()
  list.scrollTop = 0
  setTimeout(() => {
    if (arrivedText === text) arrivedText = null
  }, 1500)
}

// Anything copied on this page lands in the demo, as it would in the real app.
document.addEventListener('copy', () => {
  const text = (document.getSelection()?.toString() ?? '').trim()
  if (text) record(text)
})

// Clicking a demo row puts it on the real clipboard, like picking an item in Copycat.
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

search.addEventListener('input', render)
setInterval(() => {
  if (!document.hidden) render()
}, 1000)
render()

// ---------- downloads ----------

const PLATFORM_ASSETS = {
  'mac-arm64': /-arm64\.dmg$/,
  'mac-x64': /-x64\.dmg$/,
  'win-x64': /-setup\.exe$/
}

const PLATFORM_LABELS = {
  'mac-arm64': 'Download for Mac',
  'mac-x64': 'Download for Mac (Intel)',
  'win-x64': 'Download for Windows'
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
    alt.textContent = detected.startsWith('mac') ? 'Intel Mac or Windows' : 'Download for Mac'
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
    `Version ${version}. Free for macOS and Windows.`
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
