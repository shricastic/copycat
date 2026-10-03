import { app, globalShortcut } from 'electron'
import type { RuntimeStatus, Settings, UpdateSettingsResult } from '@shared/types'
import type { Store } from './store'

/**
 * Applies settings that have effects outside the store (global shortcut, login item) and
 * keeps the store, the OS and the UI in agreement. The renderer only ever sees settings that
 * were actually applied.
 */
export class SettingsController {
  /** Accelerator currently registered with the OS, or '' for none. */
  private registered = ''
  private recording = false

  constructor(
    private readonly store: Store,
    private readonly onShortcut: () => void
  ) {}

  /** Apply stored settings at startup. */
  init(): void {
    const { shortcut, launchAtLogin } = this.store.getSettings()
    if (!this.register(shortcut)) {
      console.warn(`[settings] could not register global shortcut ${shortcut}`)
    }
    if (this.loginItemAvailable()) {
      // The OS is the source of truth: the user may have removed the login item in
      // System Settings, so sync our stored value from it rather than the other way round.
      const actual = app.getLoginItemSettings().openAtLogin
      if (actual !== launchAtLogin) this.store.updateSettings({ launchAtLogin: actual })
    }
  }

  runtime(): RuntimeStatus {
    return {
      shortcutRegistered: this.registered !== '',
      loginItemAvailable: this.loginItemAvailable()
    }
  }

  update(patch: Partial<Settings>): UpdateSettingsResult {
    const current = this.store.getSettings()

    // Re-applying the same shortcut retries registration (e.g. it failed at startup).
    if (
      patch.shortcut !== undefined &&
      (patch.shortcut !== current.shortcut || this.registered !== patch.shortcut)
    ) {
      // Registration must really hit the OS, so finish any recording session first.
      this.setRecording(false)
      const previous = this.registered
      if (!this.register(patch.shortcut)) {
        // Put the old one back so a failed change never leaves the user without a shortcut.
        this.register(previous)
        return this.result(
          false,
          'That shortcut is already used by another app or the system. Try a different one.'
        )
      }
    }

    if (patch.launchAtLogin !== undefined && patch.launchAtLogin !== current.launchAtLogin) {
      if (!this.loginItemAvailable()) {
        return this.result(false, 'Launch at login is only available in the installed app.')
      }
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin })
      const applied = app.getLoginItemSettings().openAtLogin
      if (applied !== patch.launchAtLogin) {
        return this.result(false, 'The system did not accept the login item change.')
      }
    }

    this.store.updateSettings(patch)
    return this.result(true)
  }

  /** While recording a new shortcut, the current one must not fire (it would close the popup). */
  setRecording(active: boolean): void {
    if (active === this.recording) return
    this.recording = active
    if (active) {
      if (this.registered) globalShortcut.unregister(this.registered)
    } else {
      const acc = this.registered
      this.registered = ''
      this.register(acc)
    }
  }

  dispose(): void {
    globalShortcut.unregisterAll()
    this.registered = ''
  }

  private register(acc: string): boolean {
    if (this.registered && !this.recording) globalShortcut.unregister(this.registered)
    this.registered = ''
    if (!acc) return true // "no shortcut" is a valid choice
    let ok = false
    try {
      ok = this.recording ? true : globalShortcut.register(acc, this.onShortcut)
    } catch (err) {
      // Throws for accelerators Electron can't parse; validation should prevent this.
      console.warn('[settings] invalid accelerator', acc, err)
    }
    if (ok) this.registered = acc
    return ok
  }

  private loginItemAvailable(): boolean {
    return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')
  }

  private result(ok: boolean, error?: string): UpdateSettingsResult {
    return { ok, settings: this.store.getSettings(), runtime: this.runtime(), error }
  }
}
