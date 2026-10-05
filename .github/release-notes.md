## Download

| Platform                            | File                                |
| ----------------------------------- | ----------------------------------- |
| macOS, Apple silicon (M1 and later) | `copycat-<version>-arm64.dmg`       |
| macOS, Intel                        | `copycat-<version>-x64.dmg`         |
| Windows 10/11 (64-bit)              | `copycat-<version>-setup.exe`       |
| Linux (64-bit), any distribution    | `copycat-<version>-x86_64.AppImage` |
| Linux (64-bit), Debian / Ubuntu     | `copycat_<version>_amd64.deb`       |

## First launch

These builds are not code-signed yet, so the OS will warn you the first time.

**macOS:** open the dmg and drag Copycat to Applications. When you open it, macOS says it can't verify the developer. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the Copycat message. You only need to do this once. Copycat then appears in the menu bar (there is no Dock icon).

**Windows:** run the installer. If SmartScreen shows "Windows protected your PC", click **More info → Run anyway**. Copycat then appears in the system tray. Windows support is new and less tested than macOS.

**Linux:** new and untested. Make the AppImage executable (`chmod +x copycat-*.AppImage`) and run it, or install the .deb (`sudo apt install ./copycat_*_amd64.deb`).
