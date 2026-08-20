import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeviceStore } from '../src/store.ts'

let dirs: string[] = []

function freshStore(): DeviceStore {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-phone-test-'))
  dirs.push(dir)
  return new DeviceStore(join(dir, 'dsh-phone.json'))
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('DeviceStore', () => {
  it('starts empty', () => {
    expect(freshStore().list()).toEqual([])
  })

  it('creates entries and persists them to disk', () => {
    const store = freshStore()
    const entry = store.create({ alias: 'phone1', wsUrl: 'ws://127.0.0.1:8080/ws', token: 't0ken' })
    expect(store.find('phone1')).toBeDefined()

    // Summaries never leak the token to the browser/agent surface.
    const summary = store.summarize(entry)
    expect(summary.hasToken).toBe(true)
    expect(summary).not.toHaveProperty('token')

    // Reload from disk sees the persisted token.
    const reloaded = new DeviceStore(store.path)
    expect(reloaded.list()).toHaveLength(1)
    expect(reloaded.find('phone1')?.token).toBe('t0ken')
  })

  it('validates wsUrl and duplicate aliases', () => {
    const store = freshStore()
    expect(() => store.create({ alias: 'x', wsUrl: 'http://bad', token: '' })).toThrow(/wss?:/)
    store.create({ alias: 'x', wsUrl: 'ws://1.2.3.4:8080/ws', token: '' })
    expect(() => store.create({ alias: 'x', wsUrl: 'ws://1.2.3.4:8080/ws', token: '' })).toThrow(/already exists/)
  })

  it('updates and deletes', () => {
    const store = freshStore()
    store.create({ alias: 'a', wsUrl: 'ws://127.0.0.1:8080/ws', token: 'old' })
    store.update('a', { token: 'new', name: 'N' })
    expect(store.find('a')?.token).toBe('new')
    expect(store.find('a')?.name).toBe('N')
    store.delete('a')
    expect(store.find('a')).toBeUndefined()
    expect(() => store.delete('a')).toThrow(/not found/)
  })
})
