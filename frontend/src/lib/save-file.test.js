// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupDue, backupReminder, daysBetween, markBackedUp, saveFile, snoozeBackup } from './save-file.js'

const touch = coarse => ({ matchMedia: q => ({ matches: coarse && q === '(pointer: coarse)' }) })
const docSpy = () => { const a = { click: vi.fn() }; return { a, doc: { createElement: () => a } } }
const json = () => new Blob(['{"a":1}'], { type: 'application/json' })

afterEach(() => { localStorage.clear() })

describe('saveFile', () => {
  it('hands the file to the share sheet on a phone', async () => {
    const nav = { canShare: vi.fn(() => true), share: vi.fn(async () => {}) }
    const { a, doc } = docSpy()
    expect(await saveFile(json(), 'backup.json', { nav, win: touch(true), doc })).toBe('shared')
    expect(nav.share.mock.calls[0][0].files[0].name).toBe('backup.json')
    expect(a.click).not.toHaveBeenCalled()
  })
  it('offers JSON as text when the browser will not share JSON', async () => {
    const nav = { canShare: vi.fn(({ files }) => files[0].type === 'text/plain'), share: vi.fn(async () => {}) }
    expect(await saveFile(json(), 'b.json', { nav, win: touch(true), doc: docSpy().doc })).toBe('shared')
    expect(nav.share.mock.calls[0][0].files[0].type).toBe('text/plain')
  })
  it('reports a dismissed share sheet, and downloads when sharing fails otherwise', async () => {
    const abort = { canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) } }
    expect(await saveFile(json(), 'b.json', { nav: abort, win: touch(true), doc: docSpy().doc })).toBe('cancelled')
    const denied = { canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) } }
    const { a, doc } = docSpy()
    expect(await saveFile(json(), 'b.json', { nav: denied, win: touch(true), doc })).toBe('downloaded')
    expect(a.click).toHaveBeenCalled()
  })
  it('downloads on a computer even where the share sheet exists', async () => {
    const nav = { canShare: () => true, share: vi.fn() }
    const { a, doc } = docSpy()
    expect(await saveFile(json(), 'b.json', { nav, win: touch(false), doc })).toBe('downloaded')
    expect(a.download).toBe('b.json')
    expect(nav.share).not.toHaveBeenCalled()
  })
})

describe('the backup reminder', () => {
  const today = '2026-10-08'
  it('asks when there is data and no backup in a week', () => {
    expect(backupDue({ last: null, today, hasData: true })).toBe(true)
    expect(backupDue({ last: '2026-10-01', today, hasData: true })).toBe(true)
    expect(backupDue({ last: '2026-10-02', today, hasData: true })).toBe(false)
    expect(backupDue({ last: null, today, hasData: false })).toBe(false)
  })
  it('stays quiet while snoozed', () => {
    expect(backupDue({ last: null, snoozedUntil: '2026-10-09', today, hasData: true })).toBe(false)
    expect(backupDue({ last: null, snoozedUntil: today, hasData: true })).toBe(true)
  })
  it('remembers on this device', () => {
    expect(backupReminder({ today, hasData: true })).toEqual({ due: true, last: null })
    markBackedUp(today)
    expect(backupReminder({ today, hasData: true })).toEqual({ due: false, last: today })
    localStorage.clear(); snoozeBackup('2026-10-09')
    expect(backupReminder({ today, hasData: true }).due).toBe(false)
    expect(daysBetween('2026-09-30', today)).toBe(8)
  })
})
