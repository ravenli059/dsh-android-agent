import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { PhoneEngine } from '../src/engine.ts'
import { DeviceStore } from '../src/store.ts'

interface AgentContext {
  port: number
  frames: Array<Record<string, unknown>>
  close: () => Promise<void>
}

/** In-process fake of the phone AgentServer. */
async function startFakeAgent(): Promise<AgentContext> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', () => resolve()))
  const port = (server.address() as AddressInfo).port
  const frames: Array<Record<string, unknown>> = []
  server.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.searchParams.get('token') !== 'tok') {
      socket.close(4001, 'bad token')
      return
    }
    socket.on('message', (data) => {
      const frame = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>
      frames.push(frame)
      const reply = { jsonrpc: '2.0', id: frame.id }
      if (frame.method === 'ping') {
        socket.send(JSON.stringify({ ...reply, result: 'pong' }))
      } else if (frame.method === 'screenshot') {
        socket.send(JSON.stringify({ ...reply, result: { data: Buffer.from('fakepng').toString('base64'), format: 'png' } }))
      } else {
        socket.send(JSON.stringify({ ...reply, result: { ok: true } }))
      }
    })
  })
  return {
    port,
    frames,
    close: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

describe('PhoneEngine', () => {
  let dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  function storeWithDevice(url: string, token: string): DeviceStore {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-phone-engine-'))
    dirs.push(dir)
    const store = new DeviceStore(join(dir, 'devices.json'))
    store.create({ alias: 'p1', wsUrl: url, token })
    return store
  }

  it('connects with token auth and dispatches rpc + screenshot', async () => {
    const agent = await startFakeAgent()
    const engine = new PhoneEngine(storeWithDevice('ws://127.0.0.1:' + agent.port + '/ws', 'tok'))
    try {
      const result = await engine.rpc('p1', 'ping')
      expect(result).toBe('pong')

      const shot = await engine.screenshot('p1', 'png')
      expect(Buffer.from(shot.data, 'base64').toString('utf8')).toBe('fakepng')
      expect(shot.format).toBe('png')
    } finally {
      engine.dispose()
      await agent.close()
    }
  })

  it('rejects unknown devices and wrong tokens', async () => {
    const agent = await startFakeAgent()
    const engine = new PhoneEngine(storeWithDevice('ws://127.0.0.1:' + agent.port + '/ws', 'nope'))
    try {
      await expect(engine.rpc('missing', 'ping')).rejects.toThrow(/not configured/)
      await expect(engine.rpc('p1', 'ping')).rejects.toThrow()
    } finally {
      engine.dispose()
      await agent.close()
    }
  })
})
