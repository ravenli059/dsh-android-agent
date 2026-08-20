/**
 * Phone testing panel: device management, connection control, and the mobile
 * test actions (open app / tap / input text / swipe / key event / screenshot
 * / UI tree dump) driven through the /api/dsh-phone bridge. All copy rides
 * the locale dictionaries; styles come from panel.module.css.
 */

import { useEffect, useState } from 'react'
import type { PhoneApi } from '../api.ts'
import type { PhoneController } from '../controller.ts'
import type { PhoneDeviceStatus } from '../../protocol.ts'
import { center, flatten, type UiNode } from '../../uitree.ts'
import { errorMessage, tt } from '../helpers.ts'
import css from './panel.module.css'

/** One log entry. */
interface LogLine {
  time: string
  text: string
}

/** Edit-form state (undefined hides the form). */
interface FormState {
  editing: string | null
  alias: string
  name: string
  wsUrl: string
  token: string
  description: string
}

/** Panel props. */
export interface PhonePanelProps {
  controller: PhoneController
  api: PhoneApi
}

/** Keep nodes with text/description/id OR clickable icons (e.g. back-arrow ImageViews that have no label). */
function isMeaningful(node: UiNode): boolean {
  return node.clickable === true || [node.text, node.contentDescription, node.resourceId]
    .some(value => value !== undefined && String(value).trim() !== '')
}

/** Short human view of a result value for the log. */
function summarize(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'string') {
    return value.length > 260 ? value.slice(0, 260) + '... (' + value.length + ' chars)' : value
  }
  let text = ''
  try {
    text = JSON.stringify(value)
  } catch {
    text = String(value)
  }
  return text.length > 260 ? text.slice(0, 260) + '...' : text
}

/** The phone testing panel. */
export function PhonePanel({ controller: _controller, api }: PhonePanelProps): JSX.Element {
  const [devices, setDevices] = useState<PhoneDeviceStatus[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<FormState | undefined>(undefined)
  const [logLines, setLogLines] = useState<LogLine[]>([])

  // Action inputs
  const [pkg, setPkg] = useState('')
  const [tapX, setTapX] = useState('')
  const [tapY, setTapY] = useState('')
  const [text, setText] = useState('')
  const [inputX, setInputX] = useState('')
  const [inputY, setInputY] = useState('')
  const [swipe, setSwipe] = useState({ x1: '', y1: '', x2: '', y2: '', duration: '300' })
  const [keycode, setKeycode] = useState('4')

  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [shotFormat, setShotFormat] = useState<'jpeg' | 'png'>('jpeg')
  const [uiText, setUiText] = useState('')
  const [uiNodes, setUiNodes] = useState<UiNode[]>([])
  const [screenSize, setScreenSize] = useState<{ w: number; h: number } | null>(null)

  const pushLog = (text: string): void => {
    const line = { time: new Date().toLocaleTimeString(), text }
    setLogLines(prev => [...prev.slice(-199), line])
  }

  const refresh = async (): Promise<void> => {
    try {
      const next = await api.status()
      setDevices(next)
      setError('')
      // Functional update: never reset the user's selection to the first
      // device just because the 5s poll captured an older selection value.
      setSelected(prev => {
        if (prev !== '' && next.some(device => device.alias === prev)) return prev
        return next.length > 0 ? next[0].alias : ''
      })
    } catch (error) {
      setError(errorMessage(error))
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => { clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedStatus = devices.find(device => device.alias === selected)

  // ------------------------------------------------------------- device CRUD
  const openNewForm = (): void => {
    setForm({ editing: null, alias: '', name: '', wsUrl: 'ws://', token: '', description: '' })
  }

  const openEditForm = (device: PhoneDeviceStatus): void => {
    setForm({
      editing: device.alias,
      alias: device.alias,
      name: device.name ?? '',
      wsUrl: device.wsUrl,
      token: '',
      description: device.description ?? '',
    })
  }

  const saveDevice = async (): Promise<void> => {
    if (form === undefined) return
    try {
      const payload = {
        alias: form.alias.trim(),
        name: form.name.trim(),
        wsUrl: form.wsUrl.trim(),
        token: form.token.trim(),
        description: form.description.trim(),
      }
      if (form.editing === null) {
        await api.createDevice(payload)
      } else {
        await api.updateDevice(form.editing, payload)
      }
      setForm(undefined)
      await refresh()
    } catch (error) {
      setError(errorMessage(error))
    }
  }

  const deleteDevice = async (alias: string): Promise<void> => {
    const display = devices.find(device => device.alias === alias)
    const label = (display?.name ?? alias)
    if (!window.confirm('Delete device "' + label + '"?')) return
    try {
      await api.deleteDevice(alias)
      if (selected === alias) {
        setSelected('')
        setScreenshot(null)
        setUiText('')
        setUiNodes([])
      }
      await refresh()
    } catch (error) {
      setError(errorMessage(error))
    }
  }

  // ----------------------------------------------------------- connection
  const connectDevice = async (alias: string): Promise<void> => {
    setBusy(true)
    try {
      const statusAfter = await api.connect(alias)
      setDevices(prev => prev.map(device => device.alias === alias
        ? { ...device, state: statusAfter.state, lastError: statusAfter.lastError, connectedAt: statusAfter.connectedAt }
        : device))
      pushLog('connect ' + alias + ' -> ' + statusAfter.state)
    } catch (error) {
      pushLog('connect ' + alias + ' error: ' + errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const disconnectDevice = async (alias: string): Promise<void> => {
    try {
      await api.disconnect(alias)
      setDevices(prev => prev.map(device => device.alias === alias ? { ...device, state: 'disconnected', lastError: undefined } : device))
      pushLog('disconnect ' + alias)
    } catch (error) {
      pushLog('disconnect ' + alias + ' error: ' + errorMessage(error))
    }
  }

  // ------------------------------------------------------------- actions
  const run = async (method: string, params: Record<string, unknown>, label: string, onOk?: (result: unknown) => void): Promise<void> => {
    if (selected === '') {
      pushLog('no device selected')
      return
    }
    setBusy(true)
    pushLog('> ' + label)
    try {
      const result = await api.rpc(selected, method, params)
      pushLog('< ' + label + ' ok: ' + summarize(result))
      onOk?.(result)
    } catch (error) {
      pushLog('< ' + label + ' error: ' + errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const openApp = (): void => {
    const packageName = pkg.trim()
    if (packageName === '') { pushLog('package name is empty'); return }
    void run('openApp', { packageName }, 'openApp ' + packageName)
  }

  const tap = (): void => {
    const x = Number(tapX)
    const y = Number(tapY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) { pushLog('tap needs numeric x,y'); return }
    void run('tap', { x, y }, 'tap ' + x + ',' + y)
  }

  const input = async (): Promise<void> => {
    const value = text
    if (value === '') { pushLog('text is empty'); return }
    const x = inputX.trim() === '' ? undefined : Number(inputX)
    const y = inputY.trim() === '' ? undefined : Number(inputY)
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) {
      setBusy(true)
      pushLog('> tap (focus) ' + x + ',' + y)
      try {
        await api.rpc(selected, 'tap', { x, y })
        pushLog('< tap ok')
      } catch (error) {
        pushLog('< tap error: ' + errorMessage(error))
        setBusy(false)
        return
      }
    }
    await run('inputText', { text: value }, 'inputText (' + value.length + ' chars)')
  }

  const swipeFn = (): void => {
    const values = [swipe.x1, swipe.y1, swipe.x2, swipe.y2].map(Number)
    if (values.some(value => !Number.isFinite(value))) { pushLog('swipe needs numeric coordinates'); return }
    void run('swipe', {
      x1: values[0], y1: values[1], x2: values[2], y2: values[3],
      durationMs: Number(swipe.duration) > 0 ? Number(swipe.duration) : 300,
    }, 'swipe')
  }

  const keyeventFn = (): void => {
    const key = Number(keycode)
    if (!Number.isFinite(key)) { pushLog('keycode must be numeric'); return }
    void run('keyevent', { key }, 'keyevent ' + key)
  }

  const swipeBack = (): void => {
    if (screenSize === null) {
      pushLog('请先点击「获取 UI 树」以确定屏幕尺寸')
      getUi()
      return
    }
    const width = screenSize.w
    const height = screenSize.h
    void run('swipe', {
      x1: Math.max(2, Math.round(width * 0.02)),
      y1: Math.round(height / 2),
      x2: Math.round(width * 0.62),
      y2: Math.round(height / 2),
      durationMs: 280,
    }, '滑动返回（手势）')
  }

  const takeScreenshot = (): void => {
    const format = shotFormat
    void run('screenshot', { format, quality: format === 'png' ? 100 : 85 }, 'screenshot ' + format, (result) => {
      const shot = result as { data?: string; format?: string } | undefined
      if (shot !== undefined && typeof shot.data === 'string') {
        const mime = (shot.format ?? format) === 'png' ? 'image/png' : 'image/jpeg'
        setScreenshot('data:' + mime + ';base64,' + shot.data)
      } else {
        pushLog('screenshot: empty payload')
      }
    })
  }

  const getUi = (): void => {
    void run('getUI', { nodeLimit: 800 }, 'getUI', (result) => {
      let out = ''
      try {
        out = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      } catch {
        out = String(result)
      }
      setUiText(out.length > 30000 ? out.slice(0, 30000) + '\n... (truncated)' : out)
      try {
        const nodes = typeof result === 'string' || result === undefined || result === null
          ? []
          : Array.isArray(result) ? result as unknown as UiNode[] : flatten(result as unknown as UiNode)
        setUiNodes(nodes)
        if (nodes.length > 0) {
          let maxRight = 0
          let maxBottom = 0
          for (const node of nodes) {
            if (node.bounds.right > maxRight) maxRight = node.bounds.right
            if (node.bounds.bottom > maxBottom) maxBottom = node.bounds.bottom
          }
          if (maxRight > 0 && maxBottom > 0) setScreenSize({ w: maxRight, h: maxBottom })
        }
      } catch {
        setUiNodes([])
      }
    })
  }

  const uiTapNode = async (point: { x: number; y: number }, label: string): Promise<void> => {
    if (selected === '') return
    setBusy(true)
    pushLog('> uiTap "' + label + '" @ ' + point.x + ',' + point.y)
    try {
      await api.rpc(selected, 'tap', { x: point.x, y: point.y })
      pushLog('< uiTap ok — 重新获取 UI 树…')
      // 界面变化后自动刷新树，方便连续操作
      window.setTimeout(() => { getUi() }, 600)
    } catch (error) {
      pushLog('< uiTap error: ' + errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const uiInputNode = async (point: { x: number; y: number }, label: string): Promise<void> => {
    if (selected === '') return
    const value = window.prompt(tt('panel.promptInput') + ' "' + label + '"', '')
    if (value === null) return
    setBusy(true)
    pushLog('> uiInput "' + label + '"')
    try {
      await api.rpc(selected, 'tap', { x: point.x, y: point.y })
      const result = await api.rpc(selected, 'inputText', { text: value })
      pushLog('< uiInput ok: ' + summarize(result) + ' — 重新获取 UI 树…')
      window.setTimeout(() => { getUi() }, 600)
    } catch (error) {
      pushLog('< uiInput error: ' + errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const saveScreenshot = (): void => {
    if (screenshot === null) return
    const anchor = document.createElement('a')
    anchor.href = screenshot
    anchor.download = (selected || 'phone') + '-' + Date.now() + '.' + shotFormat
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  // --------------------------------------------------------------- render
  return (
    <div className={css.panel}>
      <div className={css.panelHeader}>
        <h2 className={css.panelTitle}>{tt('panel.title')}</h2>
        <button className={css.button} onClick={() => { void refresh() }} disabled={busy}>{tt('panel.refresh')}</button>
      </div>

      {error !== '' && <div className={css.errorBanner}>{error}</div>}

      <div className={css.section}>
        <div className={css.row}>
          <h3 className={css.sectionTitle}>{tt('panel.selectDevice')}</h3>
          <button className={css.buttonPrimary} onClick={openNewForm}>{tt('panel.addDevice')}</button>
        </div>

        {devices.length === 0 && !form && <span className={css.empty}>{tt('panel.noDevices')}</span>}

        {devices.length > 0 && (
          <div className={css.deviceList}>
            {devices.map(device => {
              const stateClass = device.state === 'connected' ? css.connected
                : device.state === 'connecting' ? css.connecting
                : device.state === 'error' ? css.errorState
                : ''
              return (
                <div
                  key={device.alias}
                  className={css.deviceRow + (selected === device.alias ? ' ' + css.selected : '')}
                  onClick={() => setSelected(device.alias)}
                >
                  <span className={css.statusDot + ' ' + stateClass} title={device.state} />
                  <div className={css.deviceMeta}>
                    <div className={css.deviceName}>{device.name ?? device.alias} <span style={{ opacity: 0.55 }}>({device.state})</span></div>
                    <div className={css.deviceUrl}>{device.wsUrl}{device.lastError !== undefined ? ' — ' + device.lastError : ''}</div>
                  </div>
                  {selected === device.alias && (
                    <div className={css.row}>
                      {device.state === 'connected'
                        ? <button className={css.button} onClick={(event) => { event.stopPropagation(); void disconnectDevice(device.alias) }} disabled={busy}>{tt('panel.disconnect')}</button>
                        : <button className={css.button} onClick={(event) => { event.stopPropagation(); void connectDevice(device.alias) }} disabled={busy}>{tt('panel.connect')}</button>}
                      <button className={css.button} onClick={(event) => { event.stopPropagation(); openEditForm(device) }}>{tt('panel.editDevice')}</button>
                      <button className={css.buttonDanger} onClick={(event) => { event.stopPropagation(); void deleteDevice(device.alias) }} disabled={busy}>{tt('panel.delete')}</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {form !== undefined && (
          <div className={css.grid2} style={{ marginTop: 8 }}>
            <input className={css.input} placeholder={tt('panel.alias')} value={form.alias}
              onChange={event => setForm({ ...form, alias: event.target.value })}
              disabled={form.editing !== null} />
            <input className={css.input} placeholder={tt('panel.name')} value={form.name}
              onChange={event => setForm({ ...form, name: event.target.value })} />
            <input className={css.input} placeholder={tt('panel.wsUrl')} value={form.wsUrl}
              onChange={event => setForm({ ...form, wsUrl: event.target.value })} />
            <input className={css.input} placeholder={form.editing !== null ? tt('panel.maskToken') : tt('panel.token')} value={form.token}
              onChange={event => setForm({ ...form, token: event.target.value })}
              type={form.editing === null ? 'password' : 'text'} />
            <input className={css.input} placeholder={tt('panel.description')} value={form.description}
              onChange={event => setForm({ ...form, description: event.target.value })} />
            <div className={css.row}>
              <button className={css.buttonPrimary} onClick={() => { void saveDevice() }} disabled={busy}>{tt('panel.save')}</button>
              <button className={css.button} onClick={() => setForm(undefined)}>{tt('panel.cancel')}</button>
            </div>
          </div>
        )}
      </div>

      {selectedStatus !== undefined && (
        <>
          <div className={css.section}>
            <div className={css.row}>
              <h3 className={css.sectionTitle}>{tt('panel.actions')} — {selectedStatus.name ?? selectedStatus.alias}</h3>
            </div>

            <div className={css.row}>
              <input className={css.input + ' ' + css.inputFull} placeholder={tt('panel.packageName')} value={pkg}
                onChange={event => setPkg(event.target.value)} />
              <button className={css.button} onClick={openApp} disabled={busy}>{tt('panel.openApp')}</button>
            </div>

            <div className={css.row}>
              <label className={css.sectionTitle}>{tt('panel.tap')}</label>
              <input className={css.input} style={{ width: 70 }} placeholder={tt('panel.x')} value={tapX} onChange={event => setTapX(event.target.value)} />
              <input className={css.input} style={{ width: 70 }} placeholder={tt('panel.y')} value={tapY} onChange={event => setTapY(event.target.value)} />
              <button className={css.button} onClick={tap} disabled={busy}>{tt('panel.tap')}</button>
            </div>

            <div className={css.row}>
              <label className={css.sectionTitle}>{tt('panel.input')}</label>
              <input className={css.input + ' ' + css.inputFull} placeholder={tt('panel.text')} value={text}
                onChange={event => setText(event.target.value)} />
              <input className={css.input} style={{ width: 70 }} placeholder={tt('panel.x')} value={inputX} onChange={event => setInputX(event.target.value)} />
              <input className={css.input} style={{ width: 70 }} placeholder={tt('panel.y')} value={inputY} onChange={event => setInputY(event.target.value)} />
              <button className={css.button} onClick={() => { void input() }} disabled={busy}>{tt('panel.input')}</button>
            </div>

            <div className={css.grid4}>
              <input className={css.input} placeholder="x1" value={swipe.x1} onChange={event => setSwipe({ ...swipe, x1: event.target.value })} />
              <input className={css.input} placeholder="y1" value={swipe.y1} onChange={event => setSwipe({ ...swipe, y1: event.target.value })} />
              <input className={css.input} placeholder={tt('panel.s2x')} value={swipe.x2} onChange={event => setSwipe({ ...swipe, x2: event.target.value })} />
              <input className={css.input} placeholder={tt('panel.s2y')} value={swipe.y2} onChange={event => setSwipe({ ...swipe, y2: event.target.value })} />
            </div>
            <div className={css.row}>
              <button className={css.button} onClick={swipeFn} disabled={busy}>{tt('panel.swipe')}</button>
              <input className={css.input} style={{ width: 90 }} placeholder={tt('panel.duration')} value={swipe.duration}
                onChange={event => setSwipe({ ...swipe, duration: event.target.value })} />
            </div>

            <div className={css.row}>
              <label className={css.sectionTitle}>{tt('panel.keyevent')}</label>
              <input className={css.input} style={{ width: 90 }} placeholder={tt('panel.key')} value={keycode}
                onChange={event => setKeycode(event.target.value)} />
              <button className={css.button} onClick={keyeventFn} disabled={busy}>{tt('panel.keyevent')}</button>
              <button className={css.button} onClick={swipeBack} disabled={busy} title={tt('panel.swipeBackTitle')}>{tt('panel.swipeBack')}</button>
              <span style={{ marginLeft: 8 }}>
                <select className={css.select} value={shotFormat} onChange={event => setShotFormat(event.target.value as 'jpeg' | 'png')}>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                </select>
                <button className={css.button} onClick={takeScreenshot} disabled={busy}>{tt('panel.screenshot')}</button>
                <button className={css.button} onClick={getUi} disabled={busy}>{tt('panel.getUi')}</button>
              </span>
            </div>

            {screenshot !== null && (
              <div className={css.row}>
                <img className={css.preview} src={screenshot} alt={tt('panel.imagePreview')} />
                <button className={css.button} onClick={saveScreenshot}>{tt('panel.saveScreenshot')}</button>
              </div>
            )}

            {uiText !== '' && (
              <div>
                <h3 className={css.sectionTitle}>{tt('panel.uiTree')}</h3>
                {uiNodes.length > 0 && (
                  <div className={css.uiList}>
                    {uiNodes.filter(isMeaningful).map((node, index) => {
                      const point = center(node)
                      const label = (node.text ?? node.contentDescription ?? node.resourceId ?? node.class ?? '').toString().slice(0, 60)
                      const meta = [
                        node.class === undefined ? '' : String(node.class).split('.').pop(),
                        node.resourceId === undefined ? '' : String(node.resourceId).split('/').pop(),
                        node.clickable === true ? 'clickable' : '',
                        point.x + ',' + point.y,
                      ].filter(Boolean).join(' ')
                      return (
                        <div key={index} className={css.uiRow}>
                          <span className={css.uiIndex}>{index}</span>
                          <span className={css.uiLabel} title={(node.text ?? '') + ' | ' + (node.resourceId ?? '')}>{label || '<empty>'}</span>
                          <span className={css.uiMeta}>{meta}</span>
                          <button className={css.button} onClick={() => { void uiTapNode(point, label) }} disabled={busy}>{tt('panel.tap')}</button>
                          <button className={css.button} onClick={() => { void uiInputNode(point, label) }} disabled={busy}>{tt('panel.input')}</button>
                        </div>
                      )
                    })}
                  </div>
                )}
                <pre className={css.pre}>{uiText}</pre>
              </div>
            )}
          </div>

          <div className={css.section}>
            <h3 className={css.sectionTitle}>{tt('panel.log')}</h3>
            <pre className={css.logBox}>{logLines.length === 0 ? '' : logLines.map(line => '[' + line.time + '] ' + line.text).join('\n')}</pre>
          </div>
        </>
      )}
    </div>
  )
}
