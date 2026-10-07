// @vitest-environment happy-dom

/* The standalone build (VITE_STANDALONE=1, lib/standalone.js): static files on GitHub Pages, no
   API behind them. Boot must go straight to guest mode without asking any server anything — a
   request there would only ever hit the static host — and, unlike the demo, start empty.

   Real modules: store/useStore.js and everything it imports. Mocked: fetch, which must not run. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => { vi.stubEnv('VITE_STANDALONE', '1') })
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

afterEach(() => { localStorage.clear() })

describe('standalone boot', () => {
  it('enters guest mode with an empty state and never calls the network', async () => {
    const fetch = vi.fn(async () => { throw new Error('no server in a standalone build') })
    globalThis.fetch = window.fetch = fetch
    vi.resetModules()
    const { useStore } = await import('./useStore.js')
    await useStore.getState().boot()

    const st = useStore.getState()
    expect(st.ready).toBe(true)
    expect(st.isGuest()).toBe(true)
    expect(st.user).toBeFalsy()
    expect(st.S.workouts || []).toEqual([])
    expect(st.S.bodyweight || []).toEqual([])
    expect(localStorage.getItem('gym_demo_seeded_v1')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps what an earlier visit saved in this browser', async () => {
    globalThis.fetch = window.fetch = vi.fn(async () => { throw new Error('no server') })
    vi.resetModules()
    let { useStore } = await import('./useStore.js')
    await useStore.getState().boot()
    useStore.getState().update(s => { s.bodyweight = [{ d: '2026-10-07', kg: 80 }] })
    window.dispatchEvent(new Event('pagehide'))

    vi.resetModules();
    ({ useStore } = await import('./useStore.js'))
    await useStore.getState().boot()
    expect(useStore.getState().S.bodyweight).toEqual([{ d: '2026-10-07', kg: 80 }])
  })
})
