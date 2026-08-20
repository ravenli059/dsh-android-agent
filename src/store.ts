/**
 * Device store: versions the ~/.dsh/dsh-phone.json file atomically.
 * Token strings live here in plaintext under the user's home (0600 file /
 * 0700 directory) — same trust model as dsh-ssh.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { PhoneDeviceEntry, PhoneDevicePayload, PhoneDeviceSummary } from './protocol.ts'

/** Standard store location. */
function deviceStorePath(): string {
  return resolve(homedir(), '.dsh', 'dsh-phone.json')
}

interface DeviceFile {
  version: 1
  devices: PhoneDeviceEntry[]
}

/** Pure file I/O — no cordis dependency, unit-testable. */
export class DeviceStore {
  /** The JSON file path. */
  readonly path: string

  /** @param path - store file path (defaults to the standard location). */
  constructor(path?: string) {
    this.path = resolve(path ?? deviceStorePath())
  }

  /** Load all entries (empty store when the file is absent). */
  list(): PhoneDeviceEntry[] {
    return this.load().devices
  }

  /** Find one entry by alias. */
  find(alias: string): PhoneDeviceEntry | undefined {
    return this.list().find(entry => entry.alias === alias)
  }

  /** Secret-free projection. */
  summarize(entry: PhoneDeviceEntry): PhoneDeviceSummary {
    return {
      alias: entry.alias,
      name: entry.name,
      wsUrl: entry.wsUrl,
      hasToken: entry.token.length > 0,
      description: entry.description,
      requestTimeoutMs: entry.requestTimeoutMs,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }

  /** Create a device (alias + ws:// URL required, token recommended). */
  create(payload: PhoneDevicePayload): PhoneDeviceEntry {
    const alias = (payload.alias ?? '').trim()
    const wsUrl = (payload.wsUrl ?? '').trim()
    const token = (payload.token ?? '').trim()
    if (alias === '') throw new Error('alias is required')
    if (!/^wss?:\/\/\S+/.test(wsUrl)) throw new Error('wsUrl must be ws:// or wss://...')
    if (this.find(alias) !== undefined) throw new Error('device already exists: ' + alias)
    const now = Date.now()
    const entry: PhoneDeviceEntry = {
      alias,
      name: payload.name?.trim() || undefined,
      wsUrl,
      token,
      description: payload.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    }
    if (typeof payload.requestTimeoutMs === 'number' && payload.requestTimeoutMs > 0) {
      entry.requestTimeoutMs = Math.floor(payload.requestTimeoutMs)
    }
    const file = this.load()
    file.devices.push(entry)
    this.save(file)
    return entry
  }

  /** Update an existing device. */
  update(alias: string, patch: PhoneDevicePayload): PhoneDeviceEntry {
    const file = this.load()
    const entry = file.devices.find(device => device.alias === alias)
    if (entry === undefined) throw new Error('device not found: ' + alias)
    if (patch.name !== undefined) entry.name = patch.name.trim() || undefined
    if (patch.wsUrl !== undefined) {
      const wsUrl = patch.wsUrl.trim()
      if (!/^wss?:\/\/\S+/.test(wsUrl)) throw new Error('wsUrl must be ws:// or wss://...')
      entry.wsUrl = wsUrl
    }
    if (patch.token !== undefined) entry.token = patch.token.trim()
    if (patch.description !== undefined) entry.description = patch.description.trim() || undefined
    if (patch.requestTimeoutMs !== undefined) entry.requestTimeoutMs = patch.requestTimeoutMs
    entry.updatedAt = Date.now()
    this.save(file)
    return entry
  }

  /** Delete a device. */
  delete(alias: string): void {
    const file = this.load()
    const next = file.devices.filter(device => device.alias !== alias)
    if (next.length === file.devices.length) throw new Error('device not found: ' + alias)
    file.devices = next
    this.save(file)
  }

  private load(): DeviceFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as DeviceFile
      if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.devices)) {
        return { version: 1, devices: parsed.devices }
      }
    } catch {
      // absent or corrupt — start empty
    }
    return { version: 1, devices: [] }
  }

  private save(file: DeviceFile): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const tmp = this.path + '.tmp'
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, this.path)
  }
}
