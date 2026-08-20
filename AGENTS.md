# AGENTS.md — dsh-android-agent

DSH Web GUI 的手机测试插件：Host 进程持有到手机 Agent（ws://IP:8080/ws?token=...）的 WebSocket
连接池 + 浏览器「手机」面板 + Agent 工具（phone_list / phone_rpc / phone_open_app / phone_tap /
phone_input / phone_swipe / phone_keyevent / phone_screenshot / phone_get_ui / phone_ui_find /
phone_ui_tap / phone_ui_input / phone_ui_back）。

## 安全模型（本包最重的纪律）

- 设备配置存 `~/.dsh/dsh-phone.json`（目录 0700、文件 0600，原子写入）；Token 以**明文**存在
  该文件——与 dsh-ssh 同一信任模型，别把该路径暴露给模型或日志。
- 所有 `/api/dsh-phone/*` 路由仅限 loopback（isLoopbackRequest 同源栅栏）——对真机执行点击 /
  输入的执行面不暴露给局域网。
- 断线自动重连（最多 3 次、间隔 3s）可能**重放未完成操作**，长流程注意副作用。
- 截图 / 操作消耗手机真实资源；Agent 使用前先确认。
- 设备 Token 绝不回传到浏览器：所有 summary 只带 hasToken 布尔。

## Agent 工具面

- 面板与 Agent 共享同一份 `~/.dsh/dsh-phone.json` 设备配置。
- Agent 只能用**用户已在 GUI 配置过**的设备；设备未配置时先引导用户去「手机」面板添加，不得臆造地址。
- `phone_rpc` 是通用 JSON-RPC 桥（ping / getStatus / getUI / tap / swipe / keyevent / inputText /
  screenshot / shell / openApp / installApk / back / home / recents），其余 phone_* 是快捷封装。

## 协议备忘（手机端 Agent App）

- 消息为 JSON-RPC 2.0：`{"jsonrpc":"2.0","id":1,"method":"tap","params":{"x":1,"y":2}}`。
- auth 通过连接 URL 的 `?token=` 查询参数。
- screenshot 返回 `{data: base64, format: 'jpeg'|'png'}`。
- inputText 走无障碍注入（ACTION_SET_TEXT → ACTION_PASTE → 剪贴板），个别输入框受限。

## 安装入口（Windows）

一键脚本 `scripts/install.ps1`（自动构建 lib/ 后执行 `dsh plugin --profile web add link:<本包>`）；
完整验证清单见 `docs/VERIFY.md`。

## 提交前检查

```sh
pnpm typecheck
pnpm test
pnpm build
```
