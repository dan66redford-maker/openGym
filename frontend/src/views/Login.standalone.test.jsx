// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The standalone build's way in: no passkeys, no password, no server to create a profile on —
   one button that starts the app on this device. */
const mocks = vi.hoisted(() => {
  const state = { setGuest: null }
  state.snapshot = () => ({ config: null, S: {}, setUser: vi.fn(), adoptProfile: vi.fn(), setGuest: state.setGuest })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => true, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), BIO: 'your fingerprint', bio: () => 'your fingerprint',
  api: vi.fn(), passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../lib/standalone.js', () => ({ STANDALONE: true }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(), confirmSheet: vi.fn() }))

const mounted = []
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove() } })

describe('Login, standalone build', () => {
  it('offers only Start, which enters guest mode', () => {
    mocks.setGuest = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push({ root, host })
    act(() => root.render(<Login />))

    const buttons = [...host.querySelectorAll('button')]
    expect(buttons.map(b => b.textContent)).toEqual(['Start'])
    expect(host.textContent).not.toMatch(/passkey|demo/i)
    act(() => buttons[0].click())
    expect(mocks.setGuest).toHaveBeenCalledWith(true)
  })
})
