/**
 * dsh-android-agent — host half. Mounts the phone device store, the WebSocket
 * engine to the Android phone agent, the /api/dsh-phone route family, agent
 * tools (phone_list / phone_rpc / phone_open_app / phone_tap / phone_input /
 * phone_swipe / phone_keyevent / phone_screenshot / phone_get_ui), and a
 * system-prompt announcement. The browser half (./client) renders the phone
 * testing panel. Everything rides official NPM SDK packages — no dsh source
 * changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { PhoneEngine } from './engine.ts'
import { mountOnce } from './mount-once.ts'
import { makeRoutes } from './routes.ts'
import { DeviceStore } from './store.ts'
import { phoneTools } from './tools.ts'

/** Stable cordis plugin name. */
export const name = 'phone'

/** Services required before the phone surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Settings namespace of the phone capability. */
export const PHONE_SETTINGS_NAMESPACE = settingsNamespace('dsh-phone')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Announce the phone plugin to every agent (default true). */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

/** Schema default, re-read for hand-built test contexts. */
const DEFAULT_ANNOUNCE = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 151

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const PHONE_GUIDANCE = '本机已安装 dsh-android-agent 插件（DSH 手机测试）：侧边栏「手机」入口；独立插件包，位于 D:\code\dsh\dsh-android-agent。能力：配对局域网内已安装 Android Agent App 的手机（ws://手机IP:8080/ws?token=xxx，设备配置存 ~/.dsh/dsh-phone.json）；打开 App（openApp，按包名）、获取 UI 树（getUI）、点击（tap，坐标）、输入文本（inputText，坐标外可选先点击聚焦）、滑动（swipe）、按键（keyevent）、截图（screenshot，存 ~/.dsh/phone-screenshots）等 JSON-RPC 方法，主要用于手机 App 自动化测试。工具：phone_list 列出设备与连接状态、phone_open_app、phone_tap、phone_input、phone_swipe、phone_keyevent、phone_screenshot、phone_get_ui、phone_rpc 通用桥。限制：设备需用户在 GUI「手机」面板配置后 agent 方可使用；token 以明文存在用户主目录私有文件（权限 0600）；仅限同一局域网可达；inputText 依赖无障碍注入（ACTION_SET_TEXT/粘贴），个别输入框可能受限；截图/操作消耗手机真实资源与电量，先确认再操作。用户提到「手机 / 安卓 / 手机测试 / 操作手机 App / 打开App / 输入文字 / 截图 / 获取屏幕」时即指本插件，请据此协作。'

/**
 * Mount the phone engine, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config.
 */
export const apply = mountOnce('dsh-android-agent', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  // The live source the surfaces read: the settings section once the web
  // settings surface is served, the composition entry otherwise.
  let current: () => Config = () => config ?? {}
  const resolve = (): Config => {
    const value = current()
    return {
      announceToAgent: value.announceToAgent ?? DEFAULT_ANNOUNCE,
      enabled: value.enabled ?? true,
    }
  }

  const store = new DeviceStore()
  const engine = new PhoneEngine(store)
  ctx.effect(() => () => { engine.dispose() }, 'dsh-phone: engine')

  const routes = makeRoutes({ store, engine })
  const tools = phoneTools(engine)

  let disposeRoutes: (() => void) | undefined
  let disposeTools: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  // Register (or drop) every surface to match the current source.
  const sync = (): void => {
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    const value = resolve()
    if (!value.enabled) return
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-phone',
        order: SECTION_ORDER,
        text: PHONE_GUIDANCE,
      })
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map(route => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-phone: routes',
    )
    disposeTools = ctx.effect(
      () => {
        const disposers = tools.map(tool => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-phone: tools',
    )
  }

  installSettingsSection(ctx, PHONE_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()
}
