/**
 * The /api/dsh-phone route family: device CRUD, connect/disconnect, status,
 * one generic JSON-RPC bridge and the screenshot stream. Every route carries
 * the loopback-only trust fence — these endpoints drive a real phone, so
 * LAN-exposed dsh web deployments must not serve them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PhoneEngine } from './engine.ts'
import { isLoopbackRequest } from './loopback.ts'
import { PHONE_API, type PhoneDevicePayload } from './protocol.ts'
import type { DeviceStore } from './store.ts'

/** Cap on JSON request bodies (device entries and rpc payloads are small). */
const MAX_JSON_BODY_BYTES = 128 * 1024

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Route family dependencies. */
export interface PhoneRoutesDeps {
  /** The device store (CRUD). */
  store: DeviceStore
  /** The engine (ops). */
  engine: PhoneEngine
}

/**
 * Build every /api/dsh-phone route (exact paths).
 * @param deps - store, engine.
 * @returns routes.
 */
export function makeRoutes(deps: PhoneRoutesDeps): WebRoute[] {
  const { store, engine } = deps

  /** Loopback fence. */
  const loopbackOnly = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    return true
  }

  return [
    // ------------------------------------------------------- devices CRUD
    {
      kind: 'exact',
      path: PHONE_API.devices,
      handler: async (req, res) => {
        if (!loopbackOnly(req, res)) return
        const method = req.method ?? 'GET'
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (method === 'GET') {
          writeJson(res, 200, { devices: store.list().map(entry => store.summarize(entry)) })
          return
        }
        if (method === 'POST') {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          try {
            const entry = store.create(body as unknown as PhoneDevicePayload)
            writeJson(res, 201, { device: store.summarize(entry) })
          } catch (error) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (method !== 'PATCH' && method !== 'DELETE') {
          writeJson(res, 405, { error: 'method not allowed: ' + method })
          return
        }
        const alias = url.searchParams.get('alias')
        if (alias === null || alias === '') {
          writeJson(res, 400, { error: 'alias query parameter is required' })
          return
        }
        if (method === 'PATCH') {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          try {
            const entry = store.update(alias, body as unknown as PhoneDevicePayload)
            writeJson(res, 200, { device: store.summarize(entry) })
          } catch (error) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        try {
          engine.disconnect(alias)
          store.delete(alias)
          writeJson(res, 200, { ok: true })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ------------------------------------------------------------- status
    {
      kind: 'exact',
      path: PHONE_API.status,
      handler: async (req, res) => {
        if (!loopbackOnly(req, res)) return
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
          return
        }
        writeJson(res, 200, { devices: engine.status() })
      },
    },
    // ------------------------------------------------------------- connect
    {
      kind: 'exact',
      path: PHONE_API.connect,
      handler: async (req, res) => {
        if (!loopbackOnly(req, res)) return
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
          return
        }
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        try {
          const ok = await engine.connect(alias)
          const status = engine.status().find(s => s.alias === alias)
          if (ok) {
            writeJson(res, 200, { ok, status })
          } else {
            writeJson(res, 502, { ok, error: status?.lastError ?? 'connect failed', status })
          }
        } catch (error) {
          writeJson(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ----------------------------------------------------------- disconnect
    {
      kind: 'exact',
      path: PHONE_API.disconnect,
      handler: async (req, res) => {
        if (!loopbackOnly(req, res)) return
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
          return
        }
        const body = await readJsonBody(req)
        const alias = typeof body?.alias === 'string' ? body.alias : ''
        if (alias === '') {
          writeJson(res, 400, { error: 'alias is required' })
          return
        }
        engine.disconnect(alias)
        writeJson(res, 200, { ok: true })
      },
    },
    // ---------------------------------------------------------------- rpc
    {
      kind: 'exact',
      path: PHONE_API.rpc,
      handler: async (req, res) => {
        if (!loopbackOnly(req, res)) return
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
          return
        }
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const alias = typeof body.alias === 'string' ? body.alias : ''
        const method = typeof body.method === 'string' ? body.method : ''
        if (alias === '' || method === '') {
          writeJson(res, 400, { error: 'alias and method are required' })
          return
        }
        const params = body.params
        const timeoutMs = typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined
        try {
          const result = await engine.rpc(alias, method, params, timeoutMs)
          writeJson(res, 200, { result: result ?? null })
        } catch (error) {
          writeJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    // ---------------------------------------------------------- screenshot
    {
      kind: 'exact',
      path: PHONE_API.screenshot,
      handler: async (req, res) => {
        if (!loopbackOnly(req, res)) return
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const alias = url.searchParams.get('alias')
        if (alias === null || alias === '') {
          writeJson(res, 400, { error: 'alias query parameter is required' })
          return
        }
        const format = url.searchParams.get('format') === 'png' ? 'png' : 'jpeg'
        const quality = Number(url.searchParams.get('quality') ?? 90)
        try {
          const shot = await engine.screenshot(alias, format, Number.isFinite(quality) ? quality : 90)
          const buffer = Buffer.from(shot.data, 'base64')
          const mime = shot.format === 'png' ? 'image/png' : 'image/jpeg'
          res.writeHead(200, {
            'content-type': mime,
            'content-length': buffer.length,
            'cache-control': 'no-store',
          })
          res.end(buffer)
        } catch (error) {
          writeJson(res, 502, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}
