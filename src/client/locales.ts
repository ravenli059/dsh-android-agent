/**
 * dsh-phone locale dictionaries (zh/en). Copy lives here; components read it
 * through helpers.tt() with the current document language.
 */
import type { TranslateValues } from './helpers.ts'

/** Chinese dictionary (source of truth for the key list). */
export const zh = {
  'entry.label': '手机',
  'entry.tooltip': '手机测试（dsh-android-agent）',
  'panel.title': '手机测试',
  'panel.noDevices': '还没有配置手机设备 — 先添加一台（手机需已安装并启动 Agent App，且与 PC 同局域网）',
  'panel.addDevice': '添加设备',
  'panel.editDevice': '编辑设备',
  'panel.alias': '别名',
  'panel.name': '名称',
  'panel.wsUrl': 'WebSocket 地址（ws://手机IP:8080/ws）',
  'panel.token': 'Token（连接密钥，明文存本机）',
  'panel.description': '备注',
  'panel.save': '保存',
  'panel.cancel': '取消',
  'panel.delete': '删除',
  'panel.connect': '连接',
  'panel.disconnect': '断开',
  'panel.connected': '已连接',
  'panel.connecting': '连接中',
  'panel.disconnected': '未连接',
  'panel.errorState': '错误',
  'panel.refresh': '刷新',
  'panel.actions': '操作',
  'panel.selectDevice': '选择设备',
  'panel.openApp': '打开 App',
  'panel.packageName': '包名（如 com.android.settings）',
  'panel.tap': '点击',
  'panel.input': '输入文本',
  'panel.text': '文本',
  'panel.x': 'X',
  'panel.y': 'Y',
  'panel.swipe': '滑动',
  'panel.s2x': '终点 X',
  'panel.s2y': '终点 Y',
  'panel.duration': '时长 ms',
  'panel.keyevent': '按键',
  'panel.key': 'KeyCode',
  'panel.screenshot': '截图',
  'panel.getUi': '获取 UI 树',
  'panel.uiTree': 'UI 树',
  'panel.promptInput': '向该节点输入文本',
  'panel.swipeBack': '滑动返回',
  'panel.swipeBackTitle': '从屏幕左边缘向右滑动模拟返回手势（需系统开启手势导航）',
  'panel.log': '日志',
  'panel.lastSeen': '最近响应',
  'panel.connectedAt': '连接时间',
  'panel.maskToken': '已保存（不显示）',
  'panel.busy': '执行中…',
  'panel.imagePreview': '屏幕截图预览',
  'panel.saveScreenshot': '保存截图',
} as const

/** English dictionary. */
export const en: Record<PhoneKey, string> = {
  'entry.label': 'Phone',
  'entry.tooltip': 'Android phone testing (dsh-android-agent)',
  'panel.title': 'Phone Testing',
  'panel.noDevices': 'No phone devices configured yet — add one (the phone must run the Agent app and share the LAN with this PC)',
  'panel.addDevice': 'Add device',
  'panel.editDevice': 'Edit device',
  'panel.alias': 'Alias',
  'panel.name': 'Name',
  'panel.wsUrl': 'WebSocket URL (ws://phone-ip:8080/ws)',
  'panel.token': 'Token (connection secret, stored in plaintext)',
  'panel.description': 'Notes',
  'panel.save': 'Save',
  'panel.cancel': 'Cancel',
  'panel.delete': 'Delete',
  'panel.connect': 'Connect',
  'panel.disconnect': 'Disconnect',
  'panel.connected': 'Connected',
  'panel.connecting': 'Connecting',
  'panel.disconnected': 'Disconnected',
  'panel.errorState': 'Error',
  'panel.refresh': 'Refresh',
  'panel.actions': 'Actions',
  'panel.selectDevice': 'Select device',
  'panel.openApp': 'Open app',
  'panel.packageName': 'Package (e.g. com.android.settings)',
  'panel.tap': 'Tap',
  'panel.input': 'Input text',
  'panel.text': 'Text',
  'panel.x': 'X',
  'panel.y': 'Y',
  'panel.swipe': 'Swipe',
  'panel.s2x': 'End X',
  'panel.s2y': 'End Y',
  'panel.duration': 'Duration ms',
  'panel.keyevent': 'Key event',
  'panel.key': 'KeyCode',
  'panel.screenshot': 'Screenshot',
  'panel.getUi': 'Get UI tree',
  'panel.uiTree': 'UI tree',
  'panel.promptInput': 'Input text into',
  'panel.swipeBack': 'Swipe back',
  'panel.swipeBackTitle': 'Swipe from the left edge to the right (requires gesture navigation)',

  'panel.log': 'Log',
  'panel.lastSeen': 'Last seen',
  'panel.connectedAt': 'Connected at',
  'panel.maskToken': 'Saved (hidden)',
  'panel.busy': 'Working…',
  'panel.imagePreview': 'Screen preview',
  'panel.saveScreenshot': 'Save screenshot',
}

/** Type of every key: union of zh keys. */
export type PhoneKey = keyof typeof zh

/** Minimal {name} interpolator (same contract as the task-board one). */
export function t(dict: Record<string, string>, key: PhoneKey, values?: TranslateValues): string {
  let text = dict[key] ?? key
  if (values !== undefined) {
    for (const [name, value] of Object.entries(values)) {
      text = text.split('{' + name + '}').join(String(value))
    }
  }
  return text
}
