import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { activeTargets, ageOf, currentWeightKg, dayTotals, shiftISO } from '../lib/nutrition.js'
import { foodForHealth, habitChecks, mergeHealthDay, parseHealthText, weekSummary } from '../lib/health.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Section, TextArea } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import '../food.css'

// Health: the week's habits against what prevents type 2 diabetes (lib/health.js), and the bridge
// to Apple Health. A home-screen web app cannot read HealthKit and cannot be handed data through a
// link, so two Shortcuts do the work (views/HealthSetup.jsx): "openGym Sync" copies the numbers,
// the app pastes them; "openGym to Health" receives the day's food as text and logs it.

const update = (...a) => useStore.getState().update(...a)
const toast = msg => useUI.getState().toast(msg)
export const SYNC_SHORTCUT = 'openGym Sync'
export const SEND_SHORTCUT = 'openGym to Health'
const runShortcut = (name, text) => {
  let url = 'shortcuts://run-shortcut?name=' + encodeURIComponent(name)
  if (text != null) url += '&input=text&text=' + encodeURIComponent(text)
  window.location.href = url
}

// Numbers in a sentence read better as 2,380 than 2380.
export const fmtArgs = args => args.map(a => (typeof a === 'number' && Math.abs(a) >= 1000 ? a.toLocaleString() : a))

const LEVEL_ICON = { ok: 'checkCircle', info: 'info', warn: 'warning', fail: 'xmark', none: 'dot' }
const FIELD_LABEL = {
  steps: () => t('Steps'), exMin: () => t('Exercise minutes'), active: () => t('Active energy (kcal)'),
  sleep: () => t('Sleep (hours)'), rhr: () => t('Resting heart rate'), glu: () => t('Blood glucose (mg/dL)'),
}

export function healthContext(S) {
  const today = todayISO()
  const kg = currentWeightKg(S.bodyweight, S.unit, today)
  const tg = activeTargets(S.nutri, kg, today)
  const cm = Number(S.nutri?.cm)
  return { kcal: tg?.kcal, goal: S.nutri?.goal, age: ageOf(S.nutri?.born, today), bmi: kg && cm ? kg / (cm / 100) ** 2 : null, unit: S.unit }
}

export default function Health() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const [waiting, setWaiting] = useState(false)
  const sum = weekSummary(S, today)
  const checks = habitChecks(sum, healthContext(S))
  const judged = checks.filter(c => c.level === 'ok' || c.level === 'warn' || c.level === 'fail')
  const onTrack = judged.filter(c => c.level === 'ok').length
  const sent = S.healthSent?.[today]

  const paste = async () => {
    let text = null
    try { text = await navigator.clipboard.readText() } catch { /* refused or unsupported: type it in */ }
    setWaiting(false)
    importSheet(text)
  }
  const sendFood = () => {
    const tot = dayTotals(S.foodLog, today)
    if (!tot.n) { toast(t('Nothing logged today yet')); return }
    const go = () => { update(s => { s.healthSent = { ...(s.healthSent || {}), [today]: true } }); runShortcut(SEND_SHORTCUT, foodForHealth(tot, today)) }
    if (sent) confirmSheet({ title: t('Send again?'), message: t('You already sent today. Apple Health adds every send, so this day would count twice.'), confirmText: t('Send anyway'), onConfirm: go })
    else go()
  }

  const days = []
  for (let i = 0; i < 7; i++) days.push(shiftISO(today, -i))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: 28 }}>{t('Health')}</h1>
        <div className="sub">{t('Habits that keep type 2 diabetes away')}</div>
      </div>
    </div>

    <Section title={t('This week')} footer={t('Based on the Diabetes Prevention Program and ADA guidance. A guide, not medical advice.')}>
      <div className="card" style={{ margin: 0 }}>
        {judged.length > 0 && <div className={'fd-verdict ' + (onTrack === judged.length ? 'ok' : 'warn')}>
          <Icon name={onTrack === judged.length ? 'checkCircle' : 'target'} />{t('{0} of {1} habits on track', onTrack, judged.length)}</div>}
        {checks.map(c => <div key={c.id} className={'fd-check ' + c.level}>
          <Icon name={LEVEL_ICON[c.level]} />
          <span><b>{t(c.title)}</b> · {t(c.msg, ...fmtArgs(c.args))}</span>
        </div>)}
      </div>
    </Section>

    <Section title={t('Apple Health')} footer={sum.lastSync ? t('Last data from {0}.', fmtDate(sum.lastSync, true)) : t('Not synced yet — set up the two Shortcuts first.')}>
      <div className="card" style={{ margin: 0 }}>
        {waiting && <div className="fd-check info" style={{ borderTop: 0, marginBottom: 8 }}><Icon name="info" />
          <span>{t('Back from Shortcuts? Tap Paste, then Paste again on the bubble iOS shows.')}</span></div>}
        <div className="row" style={{ gap: 8 }}>
          <Button variant={waiting ? 'plain' : 'primary'} icon="heart" style={{ flex: 1 }} onClick={() => { setWaiting(true); runShortcut(SYNC_SHORTCUT) }}>{t('Get data')}</Button>
          <Button variant={waiting ? 'primary' : 'plain'} icon="clipboard" style={{ flex: 1 }} onClick={paste}>{t('Paste')}</Button>
        </div>
        <div style={{ height: 8 }} />
        <Button icon="upload" onClick={sendFood}>{sent ? t('Food sent to Health today ✓') : t('Send today’s food to Health')}</Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" icon="info" onClick={() => nav('/health/setup')}>{t('How to set up the Shortcuts')}</Button>
      </div>
    </Section>

    <Section title={t('Last 7 days')}>
      <div className="card fd-days" style={{ margin: 0 }}>
        <div className="fd-dayrow head"><span /><span>{t('Steps')}</span><span>{t('Exercise')}</span><span>{t('Sleep')}</span><span>{t('RHR')}</span></div>
        {days.map(d => {
          const h = S.health?.[d] || {}
          const v = (x, f) => (x == null ? '—' : f(x))
          return <div className="fd-dayrow" key={d}>
            <span>{d === today ? t('Today') : fmtDate(d)}</span>
            <span>{v(h.steps, x => Math.round(x).toLocaleString())}</span>
            <span>{v(h.exMin, x => Math.round(x) + 'm')}</span>
            <span>{v(h.sleep, x => (Math.round(x * 10) / 10) + 'h')}</span>
            <span>{v(h.rhr, x => Math.round(x))}</span>
          </div>
        })}
      </div>
    </Section>

    <Section title={t('Your baseline')} footer={t('Weight loss is measured from here. Leave it empty to use your first weigh-in.')}>
      <div className="card" style={{ margin: 0 }}>
        <div className="fd-stat"><span>{t('Starting weight')}</span>
          <span className="row" style={{ gap: 6 }}><NumberField className="field" nullable value={S.nutri?.startW ?? null} placeholder={sum.startW ? String(Math.round(sum.startW * 10) / 10) : '—'}
            onChange={v => update(s => { s.nutri = { ...(s.nutri || {}), startW: v } })} /><span className="small muted">{S.unit}</span></span></div>
      </div>
    </Section>
  </div>
}

/* ============================ the paste preview ============================ */

const importSheet = text => useUI.getState().openSheet(close => <ImportSheet initial={text} close={close} />)

// What was read, shown before anything is saved: the first time, compare it with the Health app.
function ImportSheet({ initial, close }) {
  const S = useStore(s => s.S)
  const [text, setText] = useState(initial || '')
  const r = parseHealthText(text, { today: todayISO(), unit: S.unit })
  const save = () => {
    update(s => {
      s.health = mergeHealthDay(s.health, r.d, r.values)
      if (r.weight != null) {
        const ex = s.bodyweight.find(b => b.d === r.d)
        if (ex) { ex.w = r.weight; ex.t = Date.now() } else s.bodyweight.push({ d: r.d, w: r.weight, t: Date.now() })
        s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
      }
    })
    toast(t('Saved Apple Health data for {0}', fmtDate(r.d, true))); close()
  }
  return <>
    <h3>{t('Apple Health data')}</h3>
    {!r.ok && <>
      <div className="muted small" style={{ marginBottom: 10, lineHeight: 1.45 }}>
        {initial ? t('The clipboard does not hold health data from the Shortcut. Run “{0}” first, or paste the text below.', SYNC_SHORTCUT) : t('Paste the text the Shortcut copied:')}
      </div>
      <TextArea value={text} onChange={e => setText(e.target.value)} placeholder={'Steps: 8123\nExercise: 42\nSleep: 7.5'} />
    </>}
    {r.ok && <>
      <div className="small muted" style={{ marginBottom: 8 }}>{t('For {0} — check it against the Health app the first time.', fmtDate(r.d, true))}</div>
      {Object.entries(r.values).map(([k, v]) => <div className="fd-stat" key={k}><span>{FIELD_LABEL[k]()}</span><b>{k === 'sleep' ? Math.round(v * 10) / 10 : v.toLocaleString()}</b></div>)}
      {r.weight != null && <div className="fd-stat"><span>{t('Weight')}</span><b>{r.weight} {S.unit}</b></div>}
      {r.dropped.length > 0 && <div className="fd-check warn"><Icon name="warning" /><span>{t('Skipped values that did not look right: {0}', r.dropped.join(', '))}</span></div>}
      <div style={{ height: 12 }} />
      <Button variant="primary" onClick={save}>{t('Save')}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="tinted" onClick={close}>{t('Cancel')}</Button>
  </>
}
