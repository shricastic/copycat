# Copycat

Clipboard history that lives in the macOS menu bar (or the Windows system tray). Every text
you copy is kept; click the icon or press <kbd>⌘⇧V</kbd> to find it again and put it back on
the clipboard.

macOS is the primary platform. Windows is supported in the code but has not been tested yet
(see [Known limitations](#known-limitations)).

## Features

- Menu bar / tray app: no Dock icon on macOS, no taskbar entry on Windows.
- Records every new text copy with a timestamp; copying something already in the list moves
  it to the top instead of duplicating it.
- Popup with search, newest first. Click an item (or select it and press <kbd>Enter</kbd>) to
  copy it back to the clipboard.
- Pin items to keep them at the top. Pinned items are never removed by the history limit,
  "Clear all" or "Clear history on quit".
- Skips passwords and other content that apps mark as private (see [Privacy](#privacy)).
- Pause recording from the popup, the tray menu or settings. While paused, the menu bar icon
  shows a pause symbol (a grey tile on Windows).
- Global shortcut to open the popup near the cursor (configurable).
- Launch at login.
- Native glass look: macOS vibrancy, Windows 11 acrylic, light and dark mode, system accent
  colour.

### Keyboard

| Keys                                      | Action                                          |
| ----------------------------------------- | ----------------------------------------------- |
| <kbd>⌘⇧V</kbd> (default, global)          | Open / close the popup                          |
| <kbd>↑</kbd> <kbd>↓</kbd>                 | Move the selection                              |
| <kbd>Enter</kbd>                          | Copy the selected item and close                |
| <kbd>Esc</kbd>                            | Close (in settings: back to the list)           |
| <kbd>⌘P</kbd>                             | Pin / unpin the selected item                   |
| <kbd>⌘⌫</kbd>                             | Delete the selected item (when search is empty) |
| <kbd>⌘,</kbd>                             | Open / close settings                           |
| <kbd>⌘+</kbd> <kbd>⌘-</kbd> <kbd>⌘0</kbd> | Zoom in / out / reset                           |

On Windows use <kbd>Ctrl</kbd> instead of <kbd>⌘</kbd>. Right-clicking an item offers Copy,
Pin and Delete; right-clicking the tray icon offers Open, Pause recording and Quit.

## Setup

Requirements: Node.js 20+ and [pnpm](https://pnpm.io) (the lockfile is pnpm's; `npm run`
works for the scripts).

```bash
pnpm install
pnpm dev
```

The app appears as a clipboard icon in the menu bar. There is no window until you click it.

## Scripts

| Script              | What it does                                                            |
| ------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`          | Run with hot reload for the renderer (restart for main-process changes) |
| `pnpm build`        | Typecheck, then build main, preload and renderer into `out/`            |
| `pnpm build:mac`    | Build and package a `.dmg` into `dist/`                                 |
| `pnpm build:win`    | Build and package an NSIS installer into `dist/`                        |
| `pnpm build:unpack` | Build an unpacked app (quick packaging check)                           |
| `pnpm start`        | Run the production build from `out/`                                    |
| `pnpm typecheck`    | TypeScript checks for main/preload and renderer                         |
| `pnpm lint`         | ESLint                                                                  |
| `pnpm e2e`          | Scripted checks against a real dev instance (see [Testing](#testing))   |
| `pnpm icons`        | Regenerate tray and app icons                                           |

## Project structure

```
src/
  main/                 Electron main process
    index.ts            App lifecycle: single-instance lock, wiring, flush on quit
    tray.ts             Tray icon, left-click toggle, right-click menu
    window.ts           Popup window: placement, blur/tray-click race, glass, zoom
    clipboardWatcher.ts Clipboard polling, change detection, privacy markers
    store.ts            History + settings persistence (JSON, atomic, debounced)
    settings.ts         Settings with OS side effects (global shortcut, login item)
    ipc.ts              IPC handlers with payload validation
  preload/              Typed, minimal API exposed to the renderer (window.api)
  renderer/             React UI (index.html holds the CSP)
    src/components/     History rows, settings view, shortcut recorder, switch
  shared/               Types, IPC channel names, accelerator helpers
resources/              Tray icons (template PNGs for macOS, .ico for Windows)
build/                  App icons and macOS entitlements for packaging
scripts/
  generate-icons.mjs    Draws all icons with no image dependencies
  e2e.mjs               Scripted checks over the DevTools protocol
```

Data is stored in a single file, `copycat.json`, in the app's user data folder:

- macOS: `~/Library/Application Support/copycat/`
- Windows: `%APPDATA%\copycat\`

## How it works

**Clipboard watching.** Electron has no clipboard-change event, so the main process polls
every 400 ms. Each poll reads only the format list and the plain text and compares them with
the previous poll; the privacy checks, hashing and recording only run when something changed.
When you pick an item, the app remembers what it wrote so its own write isn't recorded as a
new copy.

**Storage.** `store.ts` keeps history and settings in memory and writes them to disk 500 ms
after the last change, by writing a temporary file and renaming it over the real one so a
crash can't leave a half-written file. Pending changes are written on quit. The storage module
has a small interface so it can be replaced with SQLite later.

**Security.** The renderer runs sandboxed with context isolation and no Node.js access. The
preload exposes named functions only (never the raw `ipcRenderer`), main rejects IPC from
anything but the popup and validates every payload, and the page has a strict Content
Security Policy (no inline scripts, no remote content; production also drops inline styles).

## Privacy

Password managers and similar apps mark sensitive clipboard content so history tools skip it.
Copycat checks for these markers and doesn't record such items:

- **macOS:** `org.nspasteboard.ConcealedType` and `org.nspasteboard.TransientType`
  ([nspasteboard.org](http://nspasteboard.org)). Verified on macOS 15 with Electron 39:
  `clipboard.availableFormats()` does **not** list these types (it only reports normalised
  formats like `text/plain`), but `clipboard.has(type)` detects them, so that is what Copycat
  uses. `pnpm e2e` writes real marked items to the pasteboard to check this.
- **Windows:** `ExcludeClipboardContentFromMonitorProcessing` and `Clipboard Viewer Ignore`.
  Untested.

You can also pause recording at any time.

## Testing

`pnpm e2e` starts a dev instance with a temporary profile, drives it over the DevTools
protocol and checks tray/popup behaviour, the clipboard watcher, privacy markers, storage,
IPC validation, the UI, settings and the global shortcut.

- It uses the **real system clipboard**. Your clipboard text is saved and restored on macOS.
- It refuses to run while another Copycat dev instance is running, because that instance
  would record the test data into your real history. Quit `pnpm dev` first.
- It can't make real OS-level clicks, so it simulates the tray-click/blur sequence rather
  than clicking the menu bar.

## Packaging

```bash
pnpm build:mac   # dist/copycat-<version>-arm64.dmg and -x64.dmg (Apple silicon, Intel)
pnpm build:win   # dist/copycat-<version>-setup.exe (x64)
```

- **macOS distribution needs code signing and notarization.** Builds are unsigned by default
  (`notarize: false` in `electron-builder.yml`). Unsigned apps are blocked by Gatekeeper on
  other Macs; you need an Apple Developer ID certificate and notarization credentials, see
  [electron-builder code signing](https://www.electron.build/code-signing).
- **Build the Windows installer on Windows or in CI for releases.** `pnpm build:win` does
  produce an x64 installer on macOS (checked on an Apple silicon Mac, no Wine needed), but it
  is unsigned and can't be tried out there. A Windows runner (e.g. GitHub Actions
  `windows-latest`) can sign it with a code-signing certificate and run it; unsigned
  installers trigger a SmartScreen warning.
- `LSUIElement` is set in the macOS `Info.plist` so the packaged app has no Dock icon.

## Releasing

GitHub Actions does the release builds (`.github/workflows/`):

- **CI** runs lint and typecheck on every pull request and on pushes to `master`.
- **Release** runs when a version tag is pushed. It builds the macOS dmgs on a macOS runner
  and the Windows installer on a Windows runner, then creates a **draft** GitHub Release with
  them attached and the first-launch instructions from `.github/release-notes.md`.

To release:

```bash
# 1. Set the version in package.json (e.g. 1.0.1) and merge that to master.
# 2. Tag the merged commit and push the tag:
git tag v1.0.1
git push origin v1.0.1
# 3. When the workflow finishes, review the draft under Releases and publish it.
```

The tag must match `package.json` (`v` + version); the workflow fails otherwise. The
builds are unsigned (see [Packaging](#packaging)).

## Known limitations

- **Text only.** Images, files and rich text formatting are not recorded (the watcher hashes
  content so image support can be added).
- **Polling.** Two copies within one 400 ms poll interval are seen as one (the last wins).
  Copying the same text again while it is already on the clipboard is not a new copy.
- **Large copies** over 256K characters are skipped.
- **Picking an item only copies it.** It doesn't paste into the previous app; press
  <kbd>⌘V</kbd> yourself. (Auto-paste would need Accessibility permission.)
- **Global shortcut conflicts.** <kbd>⌘⇧V</kbd> is "Paste and Match Style" in many macOS
  apps, and the global shortcut takes priority while Copycat runs. Change it in settings if
  you use that. If another app already owns a shortcut, settings shows it as not active.
- **Launch at login** only works in the packaged app (in dev it would register the bare
  Electron binary). On macOS 13+, an unsigned app may need approval under System Settings →
  General → Login Items.
- **Windows is untested.** The code handles tray placement for bottom/top/side taskbars,
  acrylic (Windows 11 22H2+, opaque fallback otherwise) and the privacy formats, but none of
  it has been run on Windows yet.
- **Not verified on macOS:** the popup appearing over full-screen apps, and whether
  right-clicking an item (native context menu) keeps the popup open.
- Linux is not a target (no tray-bounds placement, no glass).
