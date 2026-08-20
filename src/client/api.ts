/**
 * Browser-side API client for the /api/dsh-phone route family — the only data
 * access path the panel components use (plain fetch, same origin).
 */

import { PHONE_API, type PhoneDevicePayload, type PhoneDeviceStatus, type PhoneDeviceSummary } from '../protocol.ts'

/** Error carrying the route's JSON error message. */
export class PhoneApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhoneApiError'
  }
}

/** Parse a JSON response or throw a PhoneApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new PhoneApiError('HTTP ' + response.status + ': invalid JSON response')
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : 'HTTP ' + response.status
    throw new PhoneApiError(message)
  }
  return body as T
}

/** Query-string helper. */
function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text === '' ? '' : '?' + text
}

/** The browser half's only data entry point. */
export class PhoneApi {
  // ------------------------------------------------------------- devices
  async listDevices(): Promise<PhoneDeviceSummary[]> {
    const response = await fetch(PHONE_API.devices)
    const body = await readJson<{ devices: PhoneDeviceSummary[] }>(response)
    return body.devices
  }

  async createDevice(payload: PhoneDevicePayload): Promise<PhoneDeviceSummary> {
    const response = await fetch(PHONE_API.devices, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await readJson<{ device: PhoneDeviceSummary }>(response)
    return body.device
  }

  async updateDevice(alias: string, patch: PhoneDevicePayload): Promise<PhoneDeviceSummary> {
    const response = await fetch(PHONE_API.devices + query({ alias }), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = await readJson<{ device: PhoneDeviceSummary }>(response)
    return body.device
  }

  async deleteDevice(alias: string): Promise<void> {
    const response = await fetch(PHONE_API.devices + query({ alias }), { method: 'DELETE' })
    await readJson<{ ok: boolean }>(response)
  }

  // ------------------------------------------------------------ connection
  async connect(alias: string): Promise<PhoneDeviceStatus> {
    const response = await fetch(PHONE_API.connect, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias }),
    })
    const body = await readJson<{ ok: boolean; status?: PhoneDeviceStatus; error?: string }>(response)
    if (!body.ok || body.status === undefined) throw new PhoneApiError(body.error ?? 'connect failed')
    return body.status
  }

  async disconnect(alias: string): Promise<void> {
    const response = await fetch(PHONE_API.disconnect, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias }),
    })
    await readJson<{ ok: boolean }>(response)
  }

  async status(): Promise<PhoneDeviceStatus[]> {
    const response = await fetch(PHONE_API.status)
    const body = await readJson<{ devices: PhoneDeviceStatus[] }>(response)
    return body.devices
  }

  // ------------------------------------------------------------------ rpc
  async rpc(alias: string, method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    const response = await fetch(PHONE_API.rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias, method, params, timeoutMs }),
    })
    const body = await readJson<{ result?: unknown; error?: string }>(response)
    if (body.error !== undefined) throw new PhoneApiError(body.error)
    return body.result
  }

  // ------------------------------------------------------------ screenshot
  screenshotUrl(alias: string, format?: 'jpeg' | 'png'): string {
    return PHONE_API.screenshot + query({ alias, format })
  }
}
