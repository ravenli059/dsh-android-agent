/**
 * Agent tools: the DSH-native counterpart of the phone-testing panel. Every
 * tool talks to the same engine the web UI uses, so a device configured in
 * the GUI is immediately operable by any agent, and vice versa.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PhoneEngine } from './engine.ts'
import type { PhoneDeviceStatus } from './protocol.ts'
import { center, describeNode, findNodes, flatten, pickTapTarget, type UiNode } from './uitree.ts'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Shape of one row in the phone_list output (mirrors its schema). */
interface DeviceRow {
  alias: string
  name?: string
  wsUrl: string
  state: string
  hasToken: boolean
  lastError?: string
}

/** Device table render shared by list surfaces. */
function renderDevices(devices: DeviceRow[]): string {
  if (devices.length === 0) return 'no devices configured (add one in the dsh web「手机」panel first)'
  const rows = devices.map(device => [
    device.alias,
    device.name ?? '-',
    device.wsUrl,
    device.state,
    device.hasToken ? 'token:yes' : 'token:no',
    device.lastError ?? '',
  ].join(' | '))
  return ['alias | name | wsUrl | state | auth | lastError', '--- | --- | --- | --- | --- | ---', ...rows].join('\n')
}

/** Render a raw rpc result compactly. */
/** Compact semantic summary of an accessibility tree: rows of meaningful nodes. */
function renderSemanticUi(root: unknown): string {
  const flattenIfNeeded = (): UiNode[] => {
    if (root === null || root === undefined || typeof root !== 'object') return []
    if (Array.isArray(root)) return root as unknown as UiNode[]
    return flatten(root as unknown as UiNode)
  }
  const nodes = flattenIfNeeded()
    .filter(n => (n.clickable === true) || [n.text, n.contentDescription, n.resourceId].some(v => v !== undefined && String(v).trim() !== ''))
    .slice(0, 160)
  if (nodes.length === 0) return 'ui tree: (no meaningful nodes)'
  const rows = nodes.map((n, i) => {
    const c = center(n)
    return [
      '#' + i,
      (n.text ?? n.contentDescription ?? '').toString().slice(0, 40) || '<icon>',
      n.resourceId === undefined ? '' : n.resourceId.split('/').pop(),
      n.class === undefined ? '' : n.class.split('.').pop(),
      n.clickable === true ? 'tap' : '',
      n.checked === true ? 'checked' : '',
      '[' + c.x + ',' + c.y + ']',
    ].filter(Boolean).join(' | ')
  })
  return 'ui tree (' + nodes.length + ' nodes):\n' + rows.join('\n')
}

function renderResult(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'string') return value.length > 4000 ? value.slice(0, 4000) + '\n... (truncated)' : value
  const textJson = JSON.stringify(value)
  return textJson.length > 4000 ? textJson.slice(0, 4000) + '\n... (truncated)' : textJson
}

/** Directory where agent screenshots land (host machine). */
function screenshotDir(): string {
  return resolve(homedir(), '.dsh', 'phone-screenshots')
}

/** The device-list tool. */
export function phoneListTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_list',
    description: 'List configured Android phone-agent devices (alias, wsUrl, connection state, token presence). ' +
      'Triggers: phone, Android device, mobile test, which phones are available.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          devices: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                alias: { type: 'string', required: true },
                name: { type: 'string' },
                wsUrl: { type: 'string', required: true },
                state: { type: 'string', required: true },
                hasToken: { type: 'boolean', required: true },
                lastError: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value: { devices?: DeviceRow[] }) => text(renderDevices(value.devices ?? [])),
    },
    async execute() {
      // Map to the exact schema row so additionalProperties:false never trips.
      return {
        devices: engine.status().map(device => ({
          alias: device.alias,
          name: device.name,
          wsUrl: device.wsUrl,
          state: device.state,
          hasToken: device.hasToken,
          lastError: device.lastError,
        })),
      }
    },
  })
}

/** Generic JSON-RPC bridge. */
export function phoneRpcTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_rpc',
    description: 'Run any JSON-RPC method on a configured Android phone agent. Methods: ping, getStatus, getUI, tap, swipe, keyevent, inputText, screenshot, shell, openApp, installApk, back, home, recents. ' +
      'Triggers: phone rpc, raw method call on the phone agent.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      method: { type: 'string', required: true, description: 'JSON-RPC method name.' },
      params: { type: 'object', properties: {}, additionalProperties: true, description: 'JSON-RPC params object.' },
      timeoutMs: { type: 'integer', description: 'Timeout in ms (default 60000, screenshots 120000).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          result: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { ok: boolean; result?: string; error?: string }) =>
        text(value.ok ? 'result:\n' + (value.result ?? 'null') : 'error: ' + (value.error ?? '')),
    },
    async execute(args) {
      try {
        const result = await engine.rpc(args.alias, args.method, args.params, args.timeoutMs)
        return { ok: true, result: renderResult(result) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Open an app by package name. */
export function phoneOpenAppTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_open_app',
    description: 'Open an app on the configured Android phone by package name (JSON-RPC openApp). ' +
      'Triggers: open app, launch app, start mobile app testing.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      packageName: { type: 'string', required: true, description: 'Android package name, e.g. com.android.settings.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, result: { type: 'string' }, error: { type: 'string' } },
      },
      render: (_args, value) => text(value.ok ? 'opened: ' + (value.result ?? 'ok') : 'error: ' + (value.error ?? '')),
    },
    async execute(args) {
      try {
        const result = await engine.rpc(args.alias, 'openApp', { packageName: args.packageName })
        return { ok: true, result: renderResult(result) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Tap at coordinates. */
export function phoneTapTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_tap',
    description: 'Tap at screen coordinates on the connected Android phone (JSON-RPC tap). Screenshot first to read the layout, then tap. ' +
      'Triggers: tap phone, click coordinate, touch at x y.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      x: { type: 'number', required: true, description: 'X coordinate in screen pixels.' },
      y: { type: 'number', required: true, description: 'Y coordinate in screen pixels.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, result: { type: 'string' }, error: { type: 'string' } },
      },
      render: (_args, value) => text(value.ok ? 'tap ok: ' + (value.result ?? 'null') : 'error: ' + (value.error ?? '')),
    },
    async execute(args) {
      try {
        const result = await engine.rpc(args.alias, 'tap', { x: Number(args.x), y: Number(args.y) })
        return { ok: true, result: renderResult(result) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Input text, optionally after tapping a field first. */
export function phoneInputTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_input',
    description: 'Type text into the connected Android phone (JSON-RPC inputText; optionally taps x,y first to focus the field). ' +
      'Note: relies on the app accessibility path (ACTION_SET_TEXT / paste), so arbitrary text entry is limited compared to adb input text. ' +
      'Triggers: fill input, type text, enter text into field, login automation.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      text: { type: 'string', required: true, description: 'Text to enter.' },
      x: { type: 'number', description: 'Optional X to tap first (focus the field).' },
      y: { type: 'number', description: 'Optional Y to tap first (focus the field).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, result: { type: 'string' }, error: { type: 'string' } },
      },
      render: (_args, value) => text(value.ok ? 'input ok' : 'error: ' + (value.error ?? '')),
    },
    async execute(args) {
      try {
        if (args.x !== undefined && args.y !== undefined) {
          await engine.rpc(args.alias, 'tap', { x: Number(args.x), y: Number(args.y) })
        }
        const result = await engine.rpc(args.alias, 'inputText', { text: args.text })
        return { ok: true, result: renderResult(result) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Swipe gesture. */
export function phoneSwipeTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_swipe',
    description: 'Swipe on the connected Android phone (JSON-RPC swipe). ' +
      'Triggers: swipe phone, scroll page, drag, fling.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      x1: { type: 'number', required: true, description: 'Start X.' },
      y1: { type: 'number', required: true, description: 'Start Y.' },
      x2: { type: 'number', required: true, description: 'End X.' },
      y2: { type: 'number', required: true, description: 'End Y.' },
      durationMs: { type: 'integer', description: 'Gesture duration in ms (default 300).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, result: { type: 'string' }, error: { type: 'string' } },
      },
      render: (_args, value) => text(value.ok ? 'swiped' : 'error: ' + (value.error ?? '')),
    },
    async execute(args) {
      try {
        const result = await engine.rpc(args.alias, 'swipe', {
          x1: Number(args.x1), y1: Number(args.y1), x2: Number(args.x2), y2: Number(args.y2),
          durationMs: args.durationMs ?? 300,
        })
        return { ok: true, result: renderResult(result) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Key event. */
export function phoneKeyeventTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_keyevent',
    description: 'Send an Android key event (JSON-RPC keyevent), e.g. 4=back, 3=home, 187=recents, 66=enter, 67=delete. ' +
      'Triggers: keyevent, press back/home, hardware key.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      key: { type: 'integer', required: true, description: 'Android keycode.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean', required: true }, result: { type: 'string' }, error: { type: 'string' } },
      },
      render: (_args, value) => text(value.ok ? 'keyevent sent: ' + (value.result ?? 'null') : 'error: ' + (value.error ?? '')),
    },
    async execute(args) {
      try {
        const result = await engine.rpc(args.alias, 'keyevent', { key: Number(args.key) })
        return { ok: true, result: renderResult(result) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Screenshot to a host file. */
export function phoneScreenshotTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_screenshot',
    description: 'Take a screenshot of the connected Android phone and save it to the host machine (JPEG/PNG under ~/.dsh/phone-screenshots). ' +
      'Use it before tapping/inputting to read the current screen layout. ' +
      'Triggers: screenshot phone, capture screen, see phone screen.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      format: { type: 'string', enum: ['jpeg', 'png'], description: 'Output format (default jpeg).' },
      quality: { type: 'integer', description: 'JPEG quality 1-100 (default 90).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          path: { type: 'string' },
          bytes: { type: 'integer' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(value.ok
        ? 'screenshot saved: ' + (value.path ?? '') + ' (' + (value.bytes ?? 0) + ' bytes)'
        : 'error: ' + (value.error ?? '')),
    },
    async execute(args) {
      try {
        const format = args.format === 'png' ? 'png' : 'jpeg'
        const shot = await engine.screenshot(args.alias, format, args.quality ?? 90)
        const dir = screenshotDir()
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        const file = resolve(dir, args.alias + '-' + Date.now() + '.' + shot.format)
        writeFileSync(file, Buffer.from(shot.data, 'base64'))
        return { ok: true, path: file, bytes: Buffer.from(shot.data, 'base64').length }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Accessibility UI dump. */
export function phoneGetUiTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_get_ui',
    description: 'Dump the current accessibility UI tree of the connected Android phone (JSON-RPC getUI). Returns a trimmed node list with text, class, bounds and actions — use it with phone_tap/phone_input for app testing. ' +
      'Triggers: get UI tree, read phone UI, find element bounds.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      nodeLimit: { type: 'integer', description: 'Max UI nodes to return (default 500).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          ui: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(value.ok ? (value.ui ?? 'empty ui') : 'error: ' + (value.error ?? '')),
    },
    async execute(args) {
      try {
        const result = await engine.rpc(args.alias, 'getUI', { nodeLimit: args.nodeLimit ?? 500 })
        return { ok: true, ui: renderSemanticUi(result) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Load the accessibility tree once. */
async function loadTree(engine: PhoneEngine, alias: string, nodeLimit?: number): Promise<UiNode> {
  const result = await engine.rpc(alias, 'getUI', { nodeLimit: nodeLimit ?? 600 })
  if (result === undefined || result === null || typeof result !== 'object') {
    throw new Error('empty ui tree: ' + (result === null ? 'null' : String(result)))
  }
  return result as unknown as UiNode
}

/** Locate nodes by text or resourceId. */
export function phoneUiFindTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_ui_find',
    description: 'Find accessibility-tree nodes on the connected phone by text/resourceId, returning bounds + center points. ' +
      'Use it to turn a getUI dump into concrete tap/input targets. Triggers: find element, locate button by text, get node bounds.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      contains: { type: 'string', description: 'Substring of the node text or content-description (case-insensitive).' },
      resourceId: { type: 'string', description: 'Exact resource id or its last path segment, e.g. "button_ok".' },
      nodeLimit: { type: 'integer', description: 'UI tree node limit (default 400).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          count: { type: 'integer', required: true },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true },
                text: { type: 'string' },
                contentDescription: { type: 'string' },
                resourceId: { type: 'string' },
                class: { type: 'string' },
                clickable: { type: 'boolean' },
                enabled: { type: 'boolean' },
                bounds: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    left: { type: 'integer', required: true },
                    top: { type: 'integer', required: true },
                    right: { type: 'integer', required: true },
                    bottom: { type: 'integer', required: true },
                  },
                },
                center: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { x: { type: 'integer', required: true }, y: { type: 'integer', required: true } },
                },
              },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (!value.ok) return text('error: ' + (value.error ?? ''))
        if (value.count === 0) return text('no matching nodes found')
        const rows = (value.nodes ?? []).map(n => [
          '#' + n.index,
          n.text ?? n.contentDescription ?? '',
          n.resourceId ?? '',
          n.clickable ? 'tap' : '',
          n.center ? '(' + n.center.x + ',' + n.center.y + ')' : '',
        ].join(' | '))
        return text(['index | text | resourceId | clickable | center', '--- | --- | --- | --- | ---', ...rows].join('\n'))
      },
    },
    async execute(args) {
      try {
        const tree = await loadTree(engine, args.alias, args.nodeLimit)
        const nodes = findNodes(tree, {
          contains: args.contains,
          resourceId: args.resourceId,
        }).slice(0, 20)
        return { ok: true, count: nodes.length, nodes: nodes.map((n, i) => describeNode(n, i)) }
      } catch (error) {
        return { ok: false, count: 0, nodes: [], error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Tap the best node matching text/resourceId. */
export function phoneUiTapTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_ui_tap',
    description: 'Tap a UI element located by text/resourceId from the accessibility tree (no need to read coordinates manually). ' +
      'The screen changes after a tap: re-run getUI/phone_ui_find afterwards to see the new page before your next action. ' +
      'Triggers: tap by text, click the "search" button, tap resourceId node.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      contains: { type: 'string', description: 'Substring of the node text/content-description to tap.' },
      resourceId: { type: 'string', description: 'Exact resource id or last segment to tap.' },
      index: { type: 'integer', description: 'Which match to use when several match (default first).' },
      nodeLimit: { type: 'integer', description: 'UI tree node limit (default 400).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          tapped: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              resourceId: { type: 'string' },
              x: { type: 'integer', required: true },
              y: { type: 'integer', required: true },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(
        value.ok && value.tapped
          ? 'tapped "' + (value.tapped.text ?? value.tapped.resourceId ?? '') + '" at (' + value.tapped.x + ',' + value.tapped.y + ')'
          : 'error: ' + (value.error ?? ''),
      ),
    },
    async execute(args) {
      try {
        const tree = await loadTree(engine, args.alias, args.nodeLimit)
        const matches = findNodes(tree, { contains: args.contains, resourceId: args.resourceId })
        const target = pickTapTarget(matches)
        if (target === undefined) throw new Error('no matching visible node' + (args.contains !== undefined ? ' for "' + args.contains + '"' : ''))
        const i = Math.min(Math.max(args.index ?? 0, 0), matches.length - 1)
        const picked = matches[i]
        const { x, y } = center(picked)
        await engine.rpc(args.alias, 'tap', { x, y })
        return {
          ok: true,
          tapped: { text: picked.text ?? '', resourceId: picked.resourceId ?? '', x, y },
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Focus an input located by text/resourceId, then type text. */
export function phoneUiInputTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_ui_input',
    description: 'Type text into an input field located by text/resourceId from the accessibility tree: taps the field to focus first. ' +
      'Triggers: fill the search box, type into the field labeled X.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      text: { type: 'string', required: true, description: 'Text to type.' },
      contains: { type: 'string', description: 'Substring of the input label/placeholder/content-description.' },
      resourceId: { type: 'string', description: 'Exact resource id or last segment of the input field.' },
      nodeLimit: { type: 'integer', description: 'UI tree node limit (default 400).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          field: { type: 'string' },
          method: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(value.ok ? 'typed into "' + (value.field ?? '') + '" (' + (value.method ?? '') + ')' : 'error: ' + (value.error ?? '')),
    },
    async execute(args) {
      try {
        const tree = await loadTree(engine, args.alias, args.nodeLimit)
        const matches = findNodes(tree, { contains: args.contains, resourceId: args.resourceId })
        const field = matches[0]
        if (field === undefined) throw new Error('no matching input field' + (args.contains !== undefined ? ' for "' + args.contains + '"' : ''))
        const { x, y } = center(field)
        await engine.rpc(args.alias, 'tap', { x, y })
        const result = await engine.rpc(args.alias, 'inputText', { text: args.text })
        const method = typeof result === 'object' && result !== null && 'method' in result
          ? String((result as { method?: unknown }).method)
          : 'ok'
        return {
          ok: true,
          field: field.text ?? field.resourceId ?? '',
          method: method === 'clipboard' ? 'clipboard' : method,
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Back navigation: Android back key or the edge-swipe back gesture. */
export function phoneBackTool(engine: PhoneEngine) {
  return defineTool({
    name: 'phone_ui_back',
    description: 'Go back to the previous page: Android back key, or the edge-swipe back gesture (left edge to the right). ' +
      'Use when the app has no visible back button in the ui tree. Triggers: go back, return to previous screen, 返回上一页.',
    parameters: {
      alias: { type: 'string', required: true, description: 'Device alias from phone_list.' },
      strategy: {
        type: 'string',
        description: '"key" = keyevent BACK (always works, default); "gesture" = swipe from the left edge to the right (works when gesture navigation is enabled).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          via: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(
        value.ok ? 'back via ' + (value.via ?? '?') : 'error: ' + (value.error ?? ''),
      ),
    },
    async execute(args) {
      const strategy: 'key' | 'gesture' = args.strategy === 'gesture' ? 'gesture' : 'key'
      try {
        if (strategy === 'gesture') {
          const status = (await engine.rpc(args.alias, 'getStatus', {})) as { width?: number; height?: number } | undefined
          const width = status?.width ?? 1080
          const height = status?.height ?? 1920
          await engine.rpc(args.alias, 'swipe', {
            x1: Math.max(2, Math.round(width * 0.02)),
            y1: Math.round(height / 2),
            x2: Math.round(width * 0.62),
            y2: Math.round(height / 2),
            durationMs: 280,
          })
          return { ok: true, via: 'gesture' }
        }
        await engine.rpc(args.alias, 'keyevent', { key: 4 })
        return { ok: true, via: 'key' }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** All tools, one array. */
export function phoneTools(engine: PhoneEngine) {
  return [
    phoneListTool(engine),
    phoneRpcTool(engine),
    phoneOpenAppTool(engine),
    phoneTapTool(engine),
    phoneInputTool(engine),
    phoneSwipeTool(engine),
    phoneKeyeventTool(engine),
    phoneScreenshotTool(engine),
    phoneGetUiTool(engine),
    phoneUiFindTool(engine),
    phoneUiTapTool(engine),
    phoneUiInputTool(engine),
    phoneBackTool(engine),
  ]
}
