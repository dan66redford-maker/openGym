// Standalone build (VITE_STANDALONE=1) — the app for one person, served as static files with no
// backend: GitHub Pages on a fork, any static host, a home-screen PWA on an iPhone.
//
// Like the demo build (demo.js) it has no API, so no passkeys, no sync and no admin: it stays in
// guest mode and everything lives in this browser's storage. Unlike the demo it starts empty, with
// no example history and none of the demo's "self-host it" copy — it is meant to be used, not
// tried. Back it up with Settings → Export; clearing the browser's site data clears the app.
export const STANDALONE = import.meta.env.VITE_STANDALONE === '1'

// The countries that weigh people in pounds and measure them in feet and inches. A standalone
// build on a phone set to one of them starts in pounds (store/useStore.js boot), which also
// switches heights to feet and inches, food amounts to ounces and speeds to mph.
const IMPERIAL = new Set(['US', 'LR', 'MM'])
export function imperialLocale(lang = globalThis.navigator?.language) {
  return IMPERIAL.has(String(lang || '').split(/[-_]/)[1]?.toUpperCase())
}
