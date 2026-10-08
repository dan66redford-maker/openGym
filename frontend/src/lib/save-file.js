// Handing a file to the person on the web build — a backup, a plan to send a friend.
//
// A download link (<a download>) is what a desktop browser wants, but an iPhone home-screen app
// does nothing useful with one: it either ignores the tap or opens the file in a viewer with no
// way back into the app. On a phone the system share sheet is the way ("Save to Files", AirDrop,
// Messages), so a touch device with the Web Share API gets that, and everything else the link.
// The native build has its own path (lib/mobile.js shareExport) and never comes here.
//
// Chrome only shares an allow-list of file types and JSON is not on it, so a JSON file that the
// browser refuses is offered again as text/plain — same name, same bytes; the importer reads the
// content, not the type.

const isTouch = win => !!win?.matchMedia?.('(pointer: coarse)').matches

/**
 * Save `blob` as `name`. Resolves to 'shared', 'cancelled' (share sheet dismissed) or
 * 'downloaded'. `env` is for tests: { nav, win, doc }.
 */
export async function saveFile(blob, name, env = {}) {
  const nav = env.nav ?? globalThis.navigator
  const win = env.win ?? globalThis.window
  const doc = env.doc ?? globalThis.document
  if (isTouch(win) && nav?.share && nav?.canShare && typeof File === 'function') {
    for (const type of [blob.type || 'application/octet-stream', 'text/plain']) {
      const file = new File([blob], name, { type })
      if (!nav.canShare({ files: [file] })) continue
      try { await nav.share({ files: [file], title: name }); return 'shared' }
      catch (e) {
        if (e?.name === 'AbortError') return 'cancelled'
        break   // NotAllowedError (the tap's activation ran out) and the like: download instead
      }
    }
  }
  const a = doc.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60000)
  return 'downloaded'
}

/* ------------------------- the backup reminder ------------------------- */
// On the standalone build the phone holds the only copy, so Home asks for a backup once a week
// (views/Home.jsx). When the last one was made is a fact about this device, so it lives in this
// device's localStorage rather than in the synced state.

const LAST = 'gym_last_backup', SNOOZE = 'gym_backup_snooze'
const read = k => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode: no reminder state */ } }

export const lastBackup = () => read(LAST)
export const markBackedUp = today => write(LAST, today)
export const snoozeBackup = until => write(SNOOZE, until)

export const daysBetween = (from, to) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 864e5)

/** Whether to ask: there is something to lose, the last backup is `every` days old or never
 *  happened, and the reminder was not put off past today. */
export function backupDue({ last, snoozedUntil, today, hasData, every = 7 }) {
  if (!hasData) return false
  if (snoozedUntil && snoozedUntil > today) return false
  return !last || daysBetween(last, today) >= every
}
export const backupReminder = ({ today, hasData }) => {
  const last = lastBackup()
  return { due: backupDue({ last, snoozedUntil: read(SNOOZE), today, hasData }), last }
}
