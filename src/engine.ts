/**
 * Phone agent engine: keeps one WebSocket connection per configured device
 * (the Android phone's AgentServer on ws://ip:8080/ws?token=...), dispatches
 * JSON-RPC 2.0 calls with per-call timeout, auto-reconnects on drop (max 3
 * attempts, 3s apart) and decodes screenshots. All state rides the store.
 */

import { WebSocket } from 'ws'
import type { PhoneDeviceEntry, PhoneConnectionState, PhoneDeviceStatus } from './protocol.ts'
import type { DeviceStore } from './store.ts'

/**
 * Close codes that a reconnect will never fix: token/policy violations (1008),
 * protocol errors (1002) and deliberate normal shutdowns (1000).
 */
function isPermanentClose(code: number): boolean {
  return code === 1008 || code === 1002 || code === 1000
}

const DEFAULT_TIMEOUT_MS = 60_000
const SCREENSHOT_TIMEOUT_MS = 120_000
const CONNECT_WAIT_MS = 8_000
const RECONNECT_DELAY_MS = 3_000
const MAX_RECONNECTS = 3

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** One device's live connection. */
class DeviceConnection {
  state: PhoneConnectionState = 'disconnected'
  lastError?: string
  connectedAt?: number
  lastSeenAt?: number

  private socket?: WebSocket
  private nextId = 1
  private pending = new Map<number, PendingCall>()
  private reconnectAttempts = 0
  private stopped = true
  private reconnectTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly device: () => PhoneDeviceEntry) {}

  /** Open (or reuse) the socket; resolves once the WebSocket is open. */
  async connect(): Promise<void> {
    if (this.state === 'connected' && this.socket?.readyState === WebSocket.OPEN) return
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    // A connect is already in flight: wait for it to settle rather than
    // opening a second socket.
    if (this.state === 'connecting' && this.socket !== undefined) {
      await this.waitForOpen(this.socket)
      return
    }
    this.stopped = false
    this.state = 'connecting'
    this.lastError = undefined
    const entry = this.device()
    const separator = entry.wsUrl.includes('?') ? '&' : '?'
    const url = entry.wsUrl + separator + 'token=' + encodeURIComponent(entry.token)
    const socket = new WebSocket(url)
    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new Error('connect timeout after ' + CONNECT_WAIT_MS + ' ms'))
      }, CONNECT_WAIT_MS)
      socket.once('open', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    }).catch((error) => {
      this.state = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
      this.scheduleReconnect()
      throw error
    })

    // Persistent lifecycle handlers for the now-open socket.
    socket.on('message', (data) => this.onMessage(data))
    socket.on('close', (code, reason) => this.onClose(code, reason))
    socket.on('error', (error) => {
      this.lastError = error instanceof Error ? error.message : String(error)
    })
    this.state = 'connected'
    this.connectedAt = Date.now()
    this.reconnectAttempts = 0
  }

  /** Disconnect intentionally; no automatic reconnect afterwards. */
  disconnect(): void {
    this.stopped = true
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.state = 'disconnected'
    this.lastError = undefined
    this.rejectAll(new Error('connection closed by user'))
    const socket = this.socket
    this.socket = undefined
    if (socket !== undefined) {
      try {
        socket.close()
      } catch {
        // already closed
      }
    }
  }

  /** Send one JSON-RPC request; auto-connects when idle. */
  async rpc(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.state !== 'connected') {
      try {
        await this.connect()
      } catch {
        // fall through to the not-connected error below
      }
    }
    if (this.state !== 'connected') {
      throw new Error('device not connected: ' + (this.lastError ?? 'unknown error'))
    }
    const id = this.nextId++
    const timeout = timeoutMs ?? this.device().requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('rpc timeout after ' + timeout + ' ms: ' + method))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }))
    })
  }

  /** Wait until an already-in-flight socket reaches OPEN or dies. */
  private waitForOpen(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new Error('connect timeout after ' + CONNECT_WAIT_MS + ' ms'))
      }, CONNECT_WAIT_MS)
      socket.once('open', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('close', () => {
        clearTimeout(timer)
        reject(new Error('connection closed while connecting'))
      })
    }).catch((error) => {
      this.state = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
      this.scheduleReconnect()
      throw error
    })
  }

  private onMessage(data: unknown): void {
    try {
      const text = typeof data === 'string' ? data : Buffer.from(data as Buffer).toString('utf8')
      const frame = JSON.parse(text) as { id?: unknown; result?: unknown; error?: { message?: string } }
      this.lastSeenAt = Date.now()
      if (frame.id === undefined || frame.id === null) return
      const numericId = Number(frame.id)
      const pending = this.pending.get(numericId)
      if (pending === undefined) return
      this.pending.delete(numericId)
      clearTimeout(pending.timer)
      if (frame.error !== undefined) {
        pending.reject(new Error(frame.error.message ?? 'json-rpc error'))
      } else {
        pending.resolve(frame.result)
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  private onClose(code = 1006, reason?: Buffer): void {
    if (this.state === 'connecting') return
    if (this.state === 'connected' || this.state === 'error') {
      const detail = reason !== undefined && reason.length > 0 ? reason.toString('utf8') : undefined
      const detailText = detail !== undefined && detail !== '' ? ' ' + detail : ''
      const permanent = isPermanentClose(code)
      const message = permanent
        ? 'connection closed (' + code + detailText + ' — 不可自动恢复，请检查 Token/网络后手动重连)'
        : 'connection closed (' + code + detailText + ')'
      this.state = 'disconnected'
      this.lastError = message
      this.rejectAll(new Error(message))
      if (!permanent) {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectAttempts >= MAX_RECONNECTS) return
    if (this.reconnectTimer !== undefined) return
    this.reconnectAttempts += 1
    this.state = 'disconnected'
    this.lastError = 'reconnecting (' + this.reconnectAttempts + '/' + MAX_RECONNECTS + ')'
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {})
    }, RECONNECT_DELAY_MS)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

/** Engine facade used by routes and agent tools. */
export class PhoneEngine {
  private connections = new Map<string, DeviceConnection>()

  constructor(private readonly store: DeviceStore) {}

  /** One status row per configured device. */
  status(): PhoneDeviceStatus[] {
    return this.store.list().map((device) => {
      const connection = this.connections.get(device.alias)
      return {
        ...this.store.summarize(device),
        state: connection?.state ?? 'disconnected',
        lastError: connection?.lastError,
        connectedAt: connection?.connectedAt,
        lastSeenAt: connection?.lastSeenAt,
      }
    })
  }

  /** Connect a device; returns false when the initial connect fails. */
  async connect(alias: string): Promise<boolean> {
    try {
      await this.ensure(alias).connect()
      return true
    } catch {
      return false
    }
  }

  /** Disconnect a device (no reconnection until the next rpc/connect). */
  disconnect(alias: string): void {
    this.connections.get(alias)?.disconnect()
  }

  /** Run one JSON-RPC method on a device. */
  async rpc(alias: string, method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    return this.ensure(alias).rpc(method, params, timeoutMs)
  }

  /** Capture a screenshot (base64 data in the result), with generous timeout. */
  async screenshot(alias: string, format = 'jpeg', quality = 90): Promise<{ data: string; format: string }> {
    const result = await this.rpc(alias, 'screenshot', { format, quality }, SCREENSHOT_TIMEOUT_MS) as {
      data?: string
      format?: string
    } | undefined
    if (result === undefined || typeof result.data !== 'string' || result.data === '') {
      throw new Error('screenshot failed: empty result')
    }
    return { data: result.data, format: result.format ?? format }
  }

  dispose(): void {
    for (const connection of this.connections.values()) connection.disconnect()
    this.connections.clear()
  }

  private ensure(alias: string): DeviceConnection {
    const device = this.store.find(alias)
    if (device === undefined) throw new Error('device not configured: ' + alias)
    let connection = this.connections.get(alias)
    if (connection === undefined) {
      connection = new DeviceConnection(() => {
        const current = this.store.find(alias)
        if (current === undefined) throw new Error('device not configured: ' + alias)
        return current
      })
      this.connections.set(alias, connection)
    }
    return connection
  }
}
