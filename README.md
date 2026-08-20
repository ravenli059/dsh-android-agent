# dsh-android-agent — Android phone testing plugin for DSH

[中文](README.zh.md) | English

A mobile-app testing plugin for DeepSeek Harness: it connects over WebSocket to an Android phone
running [dsh-android-agent](https://github.com/zhu1090093659/dsh-android-agnet) on the same LAN and
lets you **open apps, tap at coordinates, input text, swipe, send key events, take screenshots and
dump the UI tree** from the dsh-web「Phone」panel, with the same phone_* tools exposed to agents.
Built entirely on official NPM SDK packages — no dsh source changes.

## Features

| Feature | Description |
| --- | --- |
| Device management | CRUD phone devices (alias / WebSocket URL / token / notes); stored in `~/.dsh/dsh-phone.json` (0600) |
| Connections | One WebSocket per device (ws://phone-ip:8080/ws?token=...), auto-reconnect (max 3), 5s status refresh |
| Open app | openApp by package name (e.g. com.android.settings) |
| Tap / swipe | tap/swipe at pixel coordinates, configurable gesture duration |
| Input text | inputText — optional tap-to-focus first (accessibility ACTION_SET_TEXT / paste based) |
| Key events | keyevent (back=4, home=3, recents=187, enter=66, delete=67 ...) |
| Screenshot | preview + download from the panel; agent tool saves into `~/.dsh/phone-screenshots` |
| UI tree | getUI dumps accessibility nodes (text / class / bounds / actions) to locate elements |
| Agent tools | `phone_list` / `phone_rpc` / `phone_open_app` / `phone_tap` / `phone_input` / `phone_swipe` / `phone_keyevent` / `phone_screenshot` / `phone_get_ui` / `phone_ui_find` / `phone_ui_tap` / `phone_ui_input` / `phone_ui_back` — same device config as the GUI |
| UI-tree-driven actions | `phone_ui_find` (`contains` / `resourceId`) locates nodes in the accessibility tree and returns bounds + tap center; `phone_ui_tap` clicks the best matching node; `phone_ui_input` focuses a field by label and types; `phone_ui_back` sends the Android back key or the edge-swipe back gesture. The GUI panel now renders the UI tree as a clickable row list (tap / input buttons per node) — no manual coordinate typing needed. |

## Security model

- All `/api/dsh-phone/*` routes are loopback-only (with same-origin checks) — the execution
  surface that drives a real phone is never exposed to the LAN.
- Tokens are stored in plaintext in `~/.dsh/dsh-phone.json` (0700 dir / 0600 file, atomic writes) —
  same trust model as dsh-ssh.
- Agents can only use devices configured by the user in the GUI first.
- Screenshots/actions consume real phone resources and battery; confirm before operating.

## Phone prerequisites

1. Install and start the Agent app's foreground service (enable accessibility / screen capture on the phone, same LAN).
2. Note the Agent's WebSocket endpoint `ws://phone-ip:8080/ws` and its token.
3. Add the device in the dsh-web「Phone」panel: alias, WebSocket URL, token.

## Install

This plugin is a **standalone package** (not part of the `@linxin666/dsh-web-ui-all` aggregate), installed via a local link:

```sh
### npm (not yet published — available once published)
dsh plugin --profile web add dsh-android-agent

### local standalone package (development, at D:\code\dsh\dsh-android-agent)
cd D:\code\dsh\dsh-android-agent
pnpm install && pnpm build
dsh plugin --profile web add link:D:\code\dsh\dsh-android-agent
```

Windows users can install with one command (build + link, PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File D:\code\dsh\dsh-android-agent\scripts\install.ps1
```

Full install & verification checklist (build → tests → install → GUI/device checks) lives in
`docs/VERIFY.md`.

Restart `dsh web` afterwards: the「Phone」entry appears in the sidebar and the agent prompt picks
up the plugin announcement automatically.

## Data

- Device config: `~/.dsh/dsh-phone.json`
- Agent screenshots: `~/.dsh/phone-screenshots/`

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
```

## Known limitations

- `inputText` relies on accessibility injection (ACTION_SET_TEXT / clipboard paste); some input
  fields may reject it — under root/Shizuku you can fall back to adb-style input via shell.
- Screenshots travel as base64 inside JSON-RPC; panel preview defaults to JPEG (PNG supported).
- Auto-reconnect can replay unfinished operations (non-idempotent) — mind side effects in long flows.
- The plugin only operates devices the user configured in the GUI.
