/**
 * Wire contract between the host half (routes.ts) and the browser half
 * (client/api.ts). Pure types only — imported by both halves.
 */

/** One stored phone device (the ~/.dsh/dsh-phone.json store shape). */
export interface PhoneDeviceEntry {
  /** Stable, user-chosen identifier used by every operation. */
  alias: string
  /** Optional display name. */
  name?: string
  /** Agent WebSocket endpoint, e.g. ws://192.168.1.100:8080/ws. */
  wsUrl: string
  /** Token appended as ?token=... when connecting. */
  token: string
  /** Free-form note. */
  description?: string
  /** Per-device RPC timeout in ms (default 60000). */
  requestTimeoutMs?: number
  createdAt: number
  updatedAt: number
}

/** Secret-free projection of an entry, safe for the browser/agent. */
export interface PhoneDeviceSummary {
  alias: string
  name?: string
  wsUrl: string
  /** Whether a token is stored (never the token itself). */
  hasToken: boolean
  description?: string
  requestTimeoutMs?: number
  createdAt: number
  updatedAt: number
}

/** Live connection state of one device. */
export type PhoneConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** A device summary plus its live connection status. */
export interface PhoneDeviceStatus extends PhoneDeviceSummary {
  state: PhoneConnectionState
  lastError?: string
  connectedAt?: number
  lastSeenAt?: number
}

/** Create/update payload (all fields optional except alias/wsUrl on create). */
export interface PhoneDevicePayload {
  alias?: string
  name?: string
  wsUrl?: string
  token?: string
  description?: string
  requestTimeoutMs?: number
}

/** One JSON-RPC reply shape the engine resolves. */
export interface RpcResultEnvelope {
  result?: unknown
  error?: { code?: number; message: string }
}

/** Route family. */
export const PHONE_API = {
  devices: '/api/dsh-phone/devices',
  connect: '/api/dsh-phone/connect',
  disconnect: '/api/dsh-phone/disconnect',
  status: '/api/dsh-phone/status',
  rpc: '/api/dsh-phone/rpc',
  screenshot: '/api/dsh-phone/screenshot',
}
