import { describe, expect, it } from 'vitest'
import { imperialLocale } from './standalone.js'

describe('imperialLocale', () => {
  it('knows the countries that use pounds and feet', () => {
    expect(imperialLocale('en-US')).toBe(true)
    expect(imperialLocale('es_US')).toBe(true)
    expect(imperialLocale('en-GB')).toBe(false)
    expect(imperialLocale('de')).toBe(false)
    expect(imperialLocale('')).toBe(false)
  })
})
