# dsh-android-agent — DSH 手机测试插件（Android Agent App 控制器）

[English](README.md) | 中文

为 DeepSeek Harness（DSH）定制的手机 App 测试插件：通过 WebSocket 连接同一局域网内、已安装
[dsh-android-agent](https://github.com/zhu1090093659/dsh-android-agnet) 的安卓手机，在 dsh-web
侧边栏「手机」面板里完成**打开 App、坐标点击、输入文本、滑动、按键、截图、UI 树读取**，并给 Agent
提供同等的 phone_* 工具，主要用于手机 App 的自动化测试。全部通过官方 NPM SDK 实现，不修改 DSH 源码。

## 能力

| 能力 | 说明 |
| --- | --- |
| 设备管理 | 增删改查手机设备（别名 / WebSocket 地址 / Token / 备注）；配置存 `~/.dsh/dsh-phone.json`（0600） |
| 连接管理 | 每设备一条 WebSocket 长连接（ws://手机IP:8080/ws?token=...），断线自动重连（最多 3 次），面板每 5s 刷新状态 |
| 打开 App | openApp 按包名启动应用（如 com.android.settings） |
| 点击 / 滑动 | tap / swipe，屏幕像素坐标，滑动可设时长 |
| 输入文本 | inputText 先点坐标聚焦再输入（无障碍 ACTION_SET_TEXT / 粘贴实现） |
| 按键 | keyevent（back=4 / home=3 / recents=187 / enter=66 / delete=67 ...） |
| 截图 | 面板内预览 + 保存下载；Agent 工具另存到 `~/.dsh/phone-screenshots` |
| UI 树 | getUI 转储无障碍节点（文本 / class / bounds / 可执行动作），配合 tap 定位元素 |
| UI 树驱动操作 | `phone_ui_find`（按文本 / resourceId 查找）返回节点 bounds 与点击中心；`phone_ui_tap` 直接点击最匹配节点；`phone_ui_input` 按标签聚焦输入框并键入；`phone_ui_back` 发送返回键或边缘滑动返回手势。面板把 UI 树渲染成可点击的行列表（每行带 tap / input 按钮），无需手输坐标 |
| Agent 工具 | `phone_list` / `phone_rpc` / `phone_open_app` / `phone_tap` / `phone_input` / `phone_swipe` / `phone_keyevent` / `phone_screenshot` / `phone_get_ui` / `phone_ui_find` / `phone_ui_tap` / `phone_ui_input` / `phone_ui_back`，与 GUI 共享同一份设备配置 |

## 安全模型

- 所有 `/api/dsh-phone/*` 路由仅限 loopback 访问（含同源校验）——驱动真实手机的执行接口不会暴露给局域网。
- Token 以明文保存在 `~/.dsh/dsh-phone.json`（目录 0700、文件 0600，原子写入），与 dsh-ssh 同一信任模型。
- Agent 使用工具前，设备需先在 GUI「手机」面板中配置。
- 截图 / 操作消耗手机真实资源与电量；先确认再操作。

## 前置条件（手机端）

1. 安装并启动 Agent App 的**前台服务**（手机应用需开启无障碍 / 屏幕录制权限、同局域网）。
2. 记住 Agent 显示的本机 WebSocket 地址：`ws://手机IP:8080/ws` 与 Token。
3. 在 dsh-web「手机」面板添加设备：别名、WebSocket 地址、Token。

## 安装

本插件是**独立包**（不并入全家桶聚合包 `@linxin666/dsh-web-ui-all`），通过本地 link 单独安装：

```sh
### 从 npm 安装（尚未发布，待发布后可用）
dsh plugin --profile web add dsh-android-agent

### 本地独立包安装（开发调试，包位于 D:\code\dsh\dsh-android-agent）
cd D:\code\dsh\dsh-android-agent
pnpm install && pnpm build
dsh plugin --profile web add link:D:\code\dsh\dsh-android-agent
```

Windows 用户可一键安装（自动构建 + link 安装，PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File D:\code\dsh\dsh-android-agent\scripts\install.ps1
```

完整的安装与验证清单（构建 → 单测 → 安装 → GUI/真机验证）见 `docs/VERIFY.md`。

安装后**重启 `dsh web`**：侧边栏出现「手机」入口；Agent 提示词中自动出现插件说明。

## 数据

- 设备配置：`~/.dsh/dsh-phone.json`（版本化 JSON，原子写入）
- Agent 截图（工具保存）：`~/.dsh/phone-screenshots/`

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build   # tsc 类型 + tsdown 双半区产物（lib/ + lib/client.js）
```

## 已知限制

- 手机端 `inputText` 依赖无障碍注入（ACTION_SET_TEXT / 剪贴板粘贴），个别输入框可能无法输入；root/Shizuku 下可用 shell 走 adb 式输入。
- 截图通过 JSON-RPC base64 传输，面板预览为 JPEG 默认（可切 PNG）。
- 断线自动重连可能重放未完成的操作（非幂等），长流程注意。
- 本插件只操作「用户已在 GUI 配置」的设备，不会臆造地址。
