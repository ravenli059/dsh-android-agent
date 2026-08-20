# dsh-android-agent 安装与验证清单（Windows）

在 PC 终端（PowerShell）按顺序执行；每步给出预期结果，便于定位问题。

## 0. 前置检查（任选其一快速确认）

```powershell
# 确认包目录在且 pnpm 可用
cd D:\code\dsh\dsh-android-agent
pnpm --version
```

预期：输出 pnpm 版本号（应 ≥ 9）。

## 1. 安装依赖（如未做过）

```powershell
cd D:\code\dsh\dsh-android-agent
pnpm install
```

预期：结束无 error。

## 2. 构建插件（一次性）

```powershell
cd D:\code\dsh\dsh-android-agent
pnpm build
```

预期：tsc 类型检查通过 + tsdown 生成两个产物：
- `lib/index.js`（宿主半区）
- `lib/client.js`（浏览器半区，含内联 CSS）

若此步报错，把报错全文贴回会话。

## 3. 单元测试（可选但推荐）

```powershell
cd D:\code\dsh\dsh-android-agent
pnpm test
```

预期：store 测试 4 项 + engine 测试 2 项全绿（engine 测试会本地起一个内存 WebSocketServer 充当假手机）。

## 4. 安装进 dsh profile

```powershell
# 方式 A：一键脚本（推荐）
powershell -ExecutionPolicy Bypass -File D:\code\dsh\dsh-android-agent\scripts\install.ps1

# 方式 B：手动一条命令
dsh plugin --profile web add link:D:\code\dsh\dsh-android-agent
```

预期：dsh 输出成功信息；检查 `C:\Users\<你> \.dsh\profiles\web\node_modules\@linxin666\dsh-android-agent` 目录存在（npm link 形式）。

## 5. 重启并验证 GUI

1. 重启 `dsh web`（或按它的重载方式刷新）。
2. 侧边栏出现「手机」入口（在「SSH」附近）。
3. 打开「手机」面板：
   - 添加设备：别名 `xiaomi`，WebSocket 地址 `ws://192.168.199.105:8080/ws`，Token 填手机 Agent 显示的 token；
   - 点「连接」→ 状态变为「已连接」；
   - 「截图」→ 面板出现手机当前屏幕；
   - 「获取 UI 树」→ 出现无障碍节点列表；
   - 「打开 App」填包名（如 `com.android.settings`）；
   - 「点击/输入文本」按截图坐标操作。

## 6. Agent 侧验证（dsh-web 聊天里）

直接说「用手机插件截图」或「列出手机设备」，模型应能调用 `phone_list` / `phone_screenshot` 等工具。

## 已知环境注意

- 本插件所有 `/api/dsh-phone/*` 路由仅限本机 loopback 访问（安全设计）。
- `inputText` 依赖手机端无障碍注入（ACTION_SET_TEXT/粘贴），个别输入框可能受限。
- 手机 Agent App 需已在前台服务运行且与 PC 同局域网。
