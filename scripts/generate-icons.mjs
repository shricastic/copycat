// Generates tray and app icons without any image dependencies.
//
//   node scripts/generate-icons.mjs
//
// Outputs:
//   resources/iconTemplate.png, resources/iconTemplate@2x.png  macOS menu bar (template: black + alpha)
//   resources/tray.ico                                         Windows tray (16/20/24/32/40/48)
//   resources/iconPausedTemplate.png (+@2x), trayPaused.ico    the same, while recording is paused
//   build/icon.png (1024), build/icon.ico, build/icon.icns     app icon placeholder for packaging
//
// Shapes are described in a 16x16 unit grid and rasterized with supersampling.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- geometry (16-unit grid) ----------

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/**
 * Clipboard glyph: board outline, clip on top, and two text lines inside. The paused variant
 * swaps the text lines for a pause symbol, so the state reads at a glance in the menu bar.
 */
function glyph(x, y, paused = false) {
  const outer = inRoundRect(x, y, 2.5, 2.5, 13.5, 15.5, 2)
  const inner = inRoundRect(x, y, 4, 4, 12, 14, 0.75)
  const board = outer && !inner
  const clip = inRoundRect(x, y, 5, 1, 11, 5, 1)
  if (paused) {
    // Two 2-unit bars on whole units: crisp at 16 px, centred on the board (x = 8).
    const bar1 = inRoundRect(x, y, 5, 7, 7, 12, 0.5)
    const bar2 = inRoundRect(x, y, 9, 7, 11, 12, 0.5)
    return board || clip || bar1 || bar2
  }
  const line1 = inRoundRect(x, y, 6, 7.5, 10, 8.5, 0.5)
  const line2 = inRoundRect(x, y, 6, 10.5, 9, 11.5, 0.5)
  return board || clip || line1 || line2
}

// ---------- rasterizer ----------

/**
 * Render an RGBA buffer of `size` px. `shade(u, v)` gets coordinates in the 16-unit
 * grid and returns [r, g, b, a] (0-255) or null for transparent.
 */
function render(size, shade, samples = 4) {
  const buf = Buffer.alloc(size * size * 4)
  const scale = 16 / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (px + (sx + 0.5) / samples) * scale
          const v = (py + (sy + 0.5) / samples) * scale
          const c = shade(u, v)
          if (!c) continue
          const ca = c[3] / 255
          r += c[0] * ca
          g += c[1] * ca
          b += c[2] * ca
          a += ca
        }
      }
      const i = (py * size + px) * 4
      const n = samples * samples
      if (a > 0) {
        // Store un-premultiplied color.
        buf[i] = Math.round(r / a)
        buf[i + 1] = Math.round(g / a)
        buf[i + 2] = Math.round(b / a)
      }
      buf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return buf
}

// Template icon: pure black, shape only in alpha. macOS tints it for light/dark menu bars.
const templateShade = (paused) => (u, v) => (glyph(u, v, paused) ? [0, 0, 0, 255] : null)

// Windows tray / app icon: tile with a white glyph, readable on light and dark taskbars.
// Blue normally; grey while paused (Windows tray icons aren't tinted by the OS).
function tileShade(inset, radius, paused = false) {
  return (u, v) => {
    if (!inRoundRect(u, v, inset, inset, 16 - inset, 16 - inset, radius)) return null
    // Map the glyph into the tile with some padding.
    const pad = inset + (16 - 2 * inset) * 0.16
    const k = (16 - 2 * pad) / 16
    const gu = (u - pad) / k
    const gv = (v - pad) / k
    if (glyph(gu, gv, paused)) return [255, 255, 255, 255]
    const t = v / 16
    // Vertical gradient: grey #8e939a -> #62676e, or blue #4f8cff -> #2d5be3.
    if (paused) {
      return [Math.round(142 - 44 * t), Math.round(147 - 44 * t), Math.round(154 - 44 * t), 255]
    }
    return [Math.round(79 - 34 * t), Math.round(140 - 49 * t), 255 - Math.round(28 * t), 255]
  }
}

// ---------- encoders ----------

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}
/** ICO containing PNG-compressed images (supported since Windows Vista). */
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, png } of images) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

const png = (size, shade, samples) => encodePng(size, render(size, shade, samples))
const write = (rel, data) => {
  const p = join(root, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, data)
  console.log('wrote', rel)
}

// ---------- outputs ----------

// macOS menu bar template icons (16pt @1x / @2x), normal and paused.
for (const [name, paused] of [
  ['iconTemplate', false],
  ['iconPausedTemplate', true]
]) {
  write(`resources/${name}.png`, png(16, templateShade(paused), 8))
  write(`resources/${name}@2x.png`, png(32, templateShade(paused), 8))
}

// Windows tray: sizes for 100%-250% DPI scaling. Full-bleed tile with a small corner radius.
for (const [name, paused] of [
  ['tray', false],
  ['trayPaused', true]
]) {
  const shade = tileShade(0.5, 3, paused)
  write(
    `resources/${name}.ico`,
    encodeIco([16, 20, 24, 32, 40, 48].map((s) => ({ size: s, png: png(s, shade, 8) })))
  )
}

// App icon placeholder. macOS icon grid: ~10% transparent margin around the rounded tile.
const appShade = tileShade(1.6, 3.2)
write('build/icon.png', png(1024, appShade, 3))
write(
  'build/icon.ico',
  encodeIco([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, png: png(s, appShade, 4) })))
)

if (process.platform === 'darwin') {
  const iconset = join(tmpdir(), `copycat-${process.pid}.iconset`)
  mkdirSync(iconset, { recursive: true })
  for (const s of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${s}x${s}.png`), png(s, appShade, 4))
    writeFileSync(
      join(iconset, `icon_${s}x${s}@2x.png`),
      png(s * 2, appShade, s * 2 >= 512 ? 3 : 4)
    )
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')])
  rmSync(iconset, { recursive: true, force: true })
  console.log('wrote build/icon.icns')
} else {
  console.log('skipped build/icon.icns (requires macOS iconutil)')
}
