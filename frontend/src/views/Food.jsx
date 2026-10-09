import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, uid, fmtDate, DAYS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { MEALS, activeTargets, copyDay, currentWeightKg, dayTotals, entriesByMeal, entryFrom, foodList, macrosFor, shiftISO, weekIntake } from '../lib/nutrition.js'
import { labelIssues } from '../lib/nutrition-check.js'
import { fibreSugarTargets } from '../lib/health.js'
import { fmtArgs } from './Health.jsx'
import { cleanBarcode, lookupBarcode } from '../lib/off.js'
import { decodeProductSource } from '../lib/scan-web.js'
import CameraScan from '../components/CameraScan.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, SearchField, Segmented, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import '../food.css'

// The food log: one day at a time, its calories and macros against the targets
// (views/FoodTargets.jsx), and what was eaten meal by meal. Adding goes through one sheet that
// searches the saved foods, scans a barcode (Open Food Facts, lib/off.js), creates a food from a
// label, or quick-adds bare numbers. The domain logic is in lib/nutrition.js.

const update = (...a) => useStore.getState().update(...a)
const S = () => useStore.getState().S
const toast = msg => useUI.getState().toast(msg)

const MEAL_LABEL = { breakfast: () => t('Breakfast'), lunch: () => t('Lunch'), dinner: () => t('Dinner'), snack: () => t('Snacks') }
const n0 = v => Math.round(Number(v) || 0).toLocaleString()
// Amounts are stored in grams; a profile in pounds reads and types them in ounces.
const OZ = 28.349523125
const usesOz = () => S().unit === 'lb'
const amountText = g => (usesOz() ? String(Math.round((g / OZ) * 10) / 10) + ' oz' : g1(g) + ' g')
const g1 = v => String(Math.round((Number(v) || 0) * 10) / 10)

// Which meal a new entry lands in by default: the one the clock says.
function mealNow() {
  const h = new Date().getHours()
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack'
}

// `atLeast` marks a target to reach rather than stay under (fibre): going past it is not "over".
export function MacroBar({ label, value, target, unit = 'g', color, atLeast = false }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  const over = !atLeast && target > 0 && value > target * 1.05
  return <div className="fd-macro">
    <div className="row between small"><span>{label}</span><span className="muted">{g1(value)}{target > 0 ? ` / ${n0(target)}` : ''} {unit}</span></div>
    <div className="fd-bar"><span style={{ width: pct + '%', background: over ? 'var(--orange)' : color }} /></div>
  </div>
}

export default function Food() {
  const nav = useNavigate()
  const st = useStore(s => s.S)
  const [day, setDay] = useState(todayISO())
  const today = todayISO()
  const kg = currentWeightKg(st.bodyweight, st.unit, today)
  const tg = activeTargets(st.nutri, kg, today)
  const tot = dayTotals(st.foodLog, day)
  const by = entriesByMeal(st.foodLog, day)
  const yesterday = shiftISO(day, -1)
  const canCopy = !tot.n && dayTotals(st.foodLog, yesterday).n > 0
  const left = tg ? tg.kcal - tot.kcal : null

  const copyYesterday = () => {
    update(s => { s.foodLog = [...(s.foodLog || []), ...copyDay(s.foodLog, yesterday, day, uid)] })
    toast(t('Copied {0} items', dayTotals(S().foodLog, day).n))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: 28 }}>{t('Food')}</h1>
      </div>
    </div>
    <div className="row fd-daynav">
      <button className="iconbtn" onClick={() => setDay(d => shiftISO(d, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      <button className="fd-daylbl" onClick={() => setDay(today)}>{day === today ? t('Today') : day === shiftISO(today, -1) ? t('Yesterday') : fmtDate(day, true)}</button>
      <button className="iconbtn" onClick={() => setDay(d => shiftISO(d, 1))} disabled={day >= today} style={day >= today ? { visibility: 'hidden' } : undefined} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>

    {tg ? <div className="card">
      <div className="row between" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
        <div>
          <div className="lbl2">{left >= 0 ? t('Calories left') : t('Over by')}</div>
          <div className="big" style={left < 0 ? { color: 'var(--orange)' } : undefined}>{n0(Math.abs(left))}</div>
          <div className="small muted">{t('{0} of {1} kcal eaten', n0(tot.kcal), n0(tg.kcal))}</div>
        </div>
        <Button size="sm" icon="target" onClick={() => nav('/food/targets')}>{t('Targets')}</Button>
      </div>
      <MacroBar label={t('Calories')} value={tot.kcal} target={tg.kcal} unit="kcal" color="var(--acc)" />
      <MacroBar label={t('Protein')} value={tot.p} target={tg.p} color="var(--blue)" />
      <MacroBar label={t('Carbs')} value={tot.c} target={tg.c} color="var(--yellow)" />
      <MacroBar label={t('Fat')} value={tot.f} target={tg.f} color="var(--pink)" />
      <MacroBar label={t('Fiber')} value={tot.fib} target={fibreSugarTargets(tg.kcal).fib} color="var(--green)" atLeast />
      <MacroBar label={t('Sugar (limit)')} value={tot.sug} target={fibreSugarTargets(tg.kcal).sug} color="var(--purple)" />
    </div> : <div className="card">
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <span className="lrow-i"><Icon name="target" /></span>
        <div className="ttl" style={{ fontWeight: 600 }}>{t('Set your targets')}</div>
      </div>
      <div className="muted small" style={{ marginBottom: 12 }}>{t('Enter your stats and goal — your calories and macros are worked out and double-checked for you.')}</div>
      <Button variant="primary" icon="target" onClick={() => nav('/food/targets')}>{t('Set up targets')}</Button>
    </div>}

    {tg && day === today && <WeekCard log={st.foodLog} tg={tg} today={today} goal={st.nutri?.goal} />}

    {canCopy && <Button icon="history" onClick={copyYesterday}>{t('Same as yesterday')}</Button>}

    {MEALS.map(meal => {
      const list = by[meal]
      const kcal = list.reduce((a, e) => a + (Number(e.kcal) || 0), 0)
      return <div className="card fd-meal" key={meal}>
        <div className="row between">
          <div><div className="ttl" style={{ fontWeight: 600 }}>{MEAL_LABEL[meal]()}</div>
            {list.length > 0 && <div className="small muted">{n0(kcal)} kcal</div>}</div>
          <button className="iconbtn" onClick={() => addFoodSheet({ day, meal })} aria-label={t('Add food')}><Icon name="plus" /></button>
        </div>
        {list.map(e => <button key={e.id} className="fd-entry" onClick={() => entrySheet(e)}>
          <span className="fd-entry-m">
            <span className="fd-entry-n">{e.name}</span>
            <span className="small muted">{[e.brand, e.g ? amountText(e.g) : null, 'P ' + g1(e.p) + ' · C ' + g1(e.c) + ' · F ' + g1(e.f)].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="fd-entry-k">{n0(e.kcal)}</span>
        </button>)}
      </div>
    })}
  </div>
}

/* ============================ the week ============================ */

const TIP_ICON = { ok: 'checkCircle', warn: 'warning', info: 'info' }

// Seven days of calories against the target (one series, so no legend: the title names it), the
// averages, and what they mean in plain words (lib/nutrition.js weekIntake). A tap on a day shows
// its numbers — a phone has no hover.
function WeekCard({ log, tg, today, goal }) {
  const w = weekIntake(log, tg, today, goal)
  const [sel, setSel] = useState(null)
  if (!w.days.some(x => x.n)) return null
  const top = Math.max(tg.kcal * 1.3, ...w.days.map(x => x.kcal))
  const H = 96
  const picked = sel != null ? w.days[sel] : null
  const dow = d => t(DAYS[new Date(d + 'T12:00:00').getDay()])
  return <div className="card">
    <div className="row between" style={{ marginBottom: 10 }}>
      <div className="ttl" style={{ fontWeight: 600 }}>{t('Calories this week')}</div>
      <div className="small muted">{t('target {0}', n0(tg.kcal))}</div>
    </div>
    <div className="fd-week" style={{ height: H }}>
      <div className="fd-week-target" style={{ bottom: (tg.kcal / top) * H }} aria-hidden="true" />
      {w.days.map((x, i) => <button key={x.d} className={'fd-week-col' + (sel === i ? ' on' : '')} onClick={() => setSel(sel === i ? null : i)}
        aria-label={`${fmtDate(x.d, true)}: ${n0(x.kcal)} kcal, ${g1(x.p)} g ${t('protein')}`}>
        <span className={'fd-week-bar' + (x.kcal > tg.kcal * 1.1 ? ' over' : '') + (x.d === today ? ' today' : '')} style={{ height: x.n ? Math.max(3, (x.kcal / top) * H) : 0 }} />
      </button>)}
    </div>
    <div className="fd-week-lbl">{w.days.map(x => <span key={x.d}>{x.d === today ? t('Today') : dow(x.d)}</span>)}</div>
    <div className="small muted" style={{ margin: '10px 0 4px', minHeight: 20 }}>
      {picked
        ? (picked.n ? t('{0}: {1} kcal · {2} g protein', fmtDate(picked.d, true), n0(picked.kcal), g1(picked.p)) : t('{0}: nothing logged', fmtDate(picked.d, true)))
        : w.avgKcal != null ? t('Average {0} kcal · {1} g protein · {2} days logged', n0(w.avgKcal), n0(w.avgP), w.loggedDays) : null}
    </div>
    {w.tips.map(x => <div key={x.id} className={'fd-check ' + x.level}><Icon name={TIP_ICON[x.level]} /><span>{t(x.msg, ...fmtArgs(x.args))}</span></div>)}
  </div>
}

/* ============================ the add sheet ============================ */

export const addFoodSheet = ({ day, meal } = {}) =>
  useUI.getState().openSheet(close => <AddFood day={day || todayISO()} meal={meal || mealNow()} close={close} />)

// One sheet, several steps: the list (search, recent foods), the scanner, a food's form, the
// amount, and quick add. Kept as steps of one sheet so Cancel always lands back on the list.
function AddFood({ day, meal: meal0, close }) {
  const st = useStore(s => s.S)
  const [step, setStep] = useState({ name: 'list' })
  const [q, setQ] = useState('')
  const [meal, setMeal] = useState(meal0)
  const foods = useMemo(() => foodList(st.foods, st.foodLog, q), [st.foods, st.foodLog, q])

  const onCode = useCallback(async code => {
    const bc = cleanBarcode(code)
    if (!bc) { toast(t('That is not a product barcode')); return }
    const known = (S().foods || []).find(f => f.barcode === bc || (bc.length === 13 && bc[0] === '0' && f.barcode === bc.slice(1)))
    if (known) { setStep({ name: 'amount', food: known }); return }
    setStep({ name: 'looking', barcode: bc })
    try {
      const found = await lookupBarcode(bc)
      setStep(found
        ? { name: 'form', draft: found, note: t('Found on Open Food Facts — check it against the label, then save.') }
        : { name: 'form', draft: { barcode: bc }, note: t('Not in Open Food Facts yet. Enter it from the label once — it is saved for next time.') })
    } catch {
      setStep({ name: 'form', draft: { barcode: bc }, note: t('Could not reach Open Food Facts. Enter it from the label, or try again when online.') })
    }
  }, [])

  const back = () => setStep({ name: 'list' })
  const mealPicker = <Segmented value={meal} onChange={setMeal} options={MEALS.map(m => ({ value: m, label: MEAL_LABEL[m]() }))} className="fd-meals" />

  if (step.name === 'scan') return <ScanStep onCode={onCode} onCancel={back} />
  if (step.name === 'looking') return <>
    <h3>{t('Looking up {0}…', step.barcode)}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Asking Open Food Facts what is in this product.')}</div>
    <Button variant="tinted" onClick={back}>{t('Cancel')}</Button>
  </>
  if (step.name === 'form') return <FoodForm draft={step.draft} note={step.note} onCancel={back}
    onSaved={food => setStep({ name: 'amount', food })} />
  if (step.name === 'amount') return <AmountStep food={step.food} mealPicker={mealPicker} onCancel={back}
    onEdit={() => setStep({ name: 'form', draft: step.food })}
    onAdd={g => {
      update(s => { s.foodLog = [...(s.foodLog || []), entryFrom(step.food, g, { d: day, meal, id: uid() })] })
      toast(t('Added {0}', step.food.name)); close()
    }} />
  if (step.name === 'quick') return <QuickAdd mealPicker={mealPicker} onCancel={back}
    onAdd={e => { update(s => { s.foodLog = [...(s.foodLog || []), { ...e, id: uid(), d: day, meal }] }); toast(t('Added')); close() }} />

  return <>
    <h3>{t('Add food')}</h3>
    <div className="fd-actions">
      <Button variant="primary" icon="camera" onClick={() => setStep({ name: 'scan' })}>{t('Scan')}</Button>
      <Button icon="plus" onClick={() => setStep({ name: 'form', draft: {} })}>{t('New food')}</Button>
      <Button icon="bolt" onClick={() => setStep({ name: 'quick' })}>{t('Quick add')}</Button>
    </div>
    <div style={{ height: 12 }} />
    <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Search your foods')} />
    <div className="fd-list">
      {foods.map(f => <button key={f.id} className="fd-entry" onClick={() => setStep({ name: 'amount', food: f })}>
        <span className="fd-entry-m">
          <span className="fd-entry-n">{f.name}</span>
          <span className="small muted">{[f.brand, t('{0} kcal / 100 g', n0(f.per100?.kcal)), f.serving ? t('serving {0} g', g1(f.serving.g)) : null].filter(Boolean).join(' · ')}</span>
        </span>
        <Icon name="chevronRight" className="chev" />
      </button>)}
      {!foods.length && <div className="muted small" style={{ padding: '16px 4px', lineHeight: 1.5 }}>
        {q ? t('No saved food matches.') : t('Foods you scan or create are saved here, most recent first.')}
      </div>}
    </div>
  </>
}

function ScanStep({ onCode, onCancel }) {
  const [typed, setTyped] = useState('')
  return <>
    <CameraScan decode={decodeProductSource} onFound={onCode} onCancel={onCancel}
      hint={t('Point the camera at the barcode — fill the frame, hold steady')} />
    <div style={{ height: 14 }} />
    <div className="small muted" style={{ marginBottom: 6 }}>{t('Or type the number under the barcode')}</div>
    <div className="row" style={{ gap: 8 }}>
      <TextField inputMode="numeric" value={typed} onChange={e => setTyped(e.target.value)} placeholder="0123456789012" />
      <Button size="sm" onClick={() => onCode(typed)} disabled={!cleanBarcode(typed)}>{t('Look up')}</Button>
    </div>
  </>
}

// A food from its label: the numbers per 100 g or per serving (US labels list per serving), the
// serving size, and the label check (lib/nutrition-check.js labelIssues) running as you type.
function FoodForm({ draft, note, onCancel, onSaved }) {
  const per0 = draft.per100 || {}
  const [name, setName] = useState(draft.name || '')
  const [brand, setBrand] = useState(draft.brand || '')
  const [servingG, setServingG] = useState(draft.serving?.g ?? null)
  const [basis, setBasis] = useState('100')
  const [v, setV] = useState({ kcal: per0.kcal ?? null, p: per0.p ?? null, c: per0.c ?? null, f: per0.f ?? null, fib: per0.fib ?? null, sug: per0.sug ?? null })
  const k = basis === 'serving' && servingG > 0 ? 100 / servingG : 1
  const per100 = { kcal: (v.kcal || 0) * k, p: (v.p || 0) * k, c: (v.c || 0) * k, f: (v.f || 0) * k }
  // Fibre and sugar are optional: left empty they stay unknown, not zero (lib/health.js).
  const fib = v.fib == null ? null : v.fib * k, sug = v.sug == null ? null : v.sug * k
  const issues = labelIssues(per100)
  const switchBasis = b => {
    if (b === basis || !(servingG > 0)) { setBasis(b); return }
    const m = b === 'serving' ? servingG / 100 : 100 / servingG
    const r = x => (x == null ? null : Math.round(x * m * 10) / 10)
    setV({ kcal: r(v.kcal), p: r(v.p), c: r(v.c), f: r(v.f), fib: r(v.fib), sug: r(v.sug) }); setBasis(b)
  }
  const save = () => {
    if (!name.trim()) { toast(t('Give the food a name')); return }
    if (basis === 'serving' && !(servingG > 0)) { toast(t('Enter the serving size in grams')); return }
    const r1 = x => Math.round(x * 10) / 10
    const food = {
      id: draft.id || uid(), name: name.trim(), brand: brand.trim() || undefined, barcode: draft.barcode || undefined,
      per100: { kcal: Math.round(per100.kcal), p: r1(per100.p), c: r1(per100.c), f: r1(per100.f) },
      serving: servingG > 0 ? { g: servingG, label: draft.serving?.label } : null,
    }
    if (fib != null) food.per100.fib = r1(fib)
    if (sug != null) food.per100.sug = r1(sug)
    update(s => { s.foods = [...(s.foods || []).filter(f => f.id !== food.id), food] })
    onSaved(food)
  }
  const field = (key, label, unit) => <label className="fd-field">
    <span className="small muted">{label}</span>
    <span className="row" style={{ gap: 6 }}><NumberField className="field" value={v[key]} nullable onChange={n => setV(o => ({ ...o, [key]: n }))} /><span className="small muted">{unit}</span></span>
  </label>
  return <>
    <h3>{draft.id ? t('Edit food') : t('New food')}</h3>
    {note && <div className="muted small" style={{ marginBottom: 10, lineHeight: 1.45 }}>{note}</div>}
    {draft.barcode && <div className="small dim" style={{ marginBottom: 8 }}>{t('Barcode {0}', draft.barcode)}</div>}
    <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Name')} />
    <div style={{ height: 8 }} />
    <TextField value={brand} onChange={e => setBrand(e.target.value)} placeholder={t('Brand (optional)')} />
    <div style={{ height: 12 }} />
    <label className="fd-field"><span className="small muted">{t('Serving size')}</span>
      <span className="row" style={{ gap: 6 }}><NumberField className="field" value={servingG} nullable onChange={setServingG} /><span className="small muted">g</span></span></label>
    <div style={{ height: 10 }} />
    <Segmented value={basis} onChange={switchBasis} options={[{ value: '100', label: t('Per 100 g') }, { value: 'serving', label: t('Per serving') }]} />
    <div className="fd-grid">
      {field('kcal', t('Calories'), 'kcal')}
      {field('p', t('Protein'), 'g')}
      {field('c', t('Carbs'), 'g')}
      {field('f', t('Fat'), 'g')}
      {field('fib', t('Fiber (optional)'), 'g')}
      {field('sug', t('Sugar (optional)'), 'g')}
    </div>
    {issues.map(i => <div key={i.id} className={'fd-check ' + i.level}><Icon name="warning" /><span>{t(i.msg, ...i.args)}</span></div>)}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save food')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="tinted" onClick={onCancel}>{t('Cancel')}</Button>
  </>
}

function AmountStep({ food, mealPicker, onCancel, onAdd, onEdit }) {
  const sg = food.serving?.g > 0 ? food.serving.g : null
  const oz = usesOz()
  const [mode, setMode] = useState(sg ? 'serving' : oz ? 'oz' : 'g')
  const [amount, setAmount] = useState(sg ? 1 : oz ? 4 : 100)
  const g = mode === 'serving' ? (amount || 0) * sg : mode === 'oz' ? (amount || 0) * OZ : (amount || 0)
  // Switching keeps the same amount of food: 1 serving of 28 g becomes 1 oz, not 1 g.
  const switchMode = x => {
    setMode(x)
    setAmount(x === 'serving' ? Math.round((g / sg) * 100) / 100 || 1 : x === 'oz' ? Math.round((g / OZ) * 10) / 10 : Math.round(g))
  }
  const modes = [...(sg ? [{ value: 'serving', label: t('Servings') }] : []), ...(oz ? [{ value: 'oz', label: 'oz' }, { value: 'g', label: 'g' }] : [{ value: 'g', label: t('Grams') }, { value: 'oz', label: 'oz' }])]
  const m = macrosFor(food, g)
  return <>
    <h3 style={{ marginBottom: 2 }}>{food.name}</h3>
    <div className="small muted" style={{ marginBottom: 12 }}>{[food.brand, t('{0} kcal / 100 g', n0(food.per100?.kcal))].filter(Boolean).join(' · ')}</div>
    <Segmented value={mode} onChange={switchMode} options={modes} /><div style={{ height: 10 }} />
    <label className="fd-field"><span className="small muted">{mode === 'serving' ? t('Servings (1 = {0})', food.serving?.label || amountText(sg)) : mode === 'oz' ? t('Ounces') : t('Grams')}</span>
      <NumberField className="field" value={amount} onChange={setAmount} autoFocus /></label>
    <div className="fd-preview">
      <div><b>{n0(m.kcal)}</b><span>kcal</span></div>
      <div><b>{g1(m.p)}</b><span>{t('protein')}</span></div>
      <div><b>{g1(m.c)}</b><span>{t('carbs')}</span></div>
      <div><b>{g1(m.f)}</b><span>{t('fat')}</span></div>
    </div>
    {mealPicker}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={() => (g > 0 ? onAdd(g) : toast(t('Enter an amount')))}>{t('Add')}</Button>
    <div style={{ height: 8 }} />
    <div className="row" style={{ gap: 8 }}>
      <Button variant="tinted" onClick={onCancel}>{t('Back')}</Button>
      <Button variant="tinted" icon="pencil" onClick={onEdit}>{t('Edit food')}</Button>
    </div>
  </>
}

// Bare numbers: a restaurant meal, something with no label. Calories fill themselves in from the
// macros when left empty.
function QuickAdd({ mealPicker, onCancel, onAdd }) {
  const [name, setName] = useState('')
  const [v, setV] = useState({ kcal: null, p: null, c: null, f: null })
  const fromMacros = 4 * (v.p || 0) + 4 * (v.c || 0) + 9 * (v.f || 0)
  const kcal = v.kcal ?? Math.round(fromMacros)
  const field = (key, label, unit) => <label className="fd-field">
    <span className="small muted">{label}</span>
    <span className="row" style={{ gap: 6 }}><NumberField className="field" value={v[key]} nullable placeholder={key === 'kcal' && fromMacros ? String(Math.round(fromMacros)) : ''} onChange={n => setV(o => ({ ...o, [key]: n }))} /><span className="small muted">{unit}</span></span>
  </label>
  return <>
    <h3>{t('Quick add')}</h3>
    <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('What was it? (optional)')} />
    <div className="fd-grid">
      {field('kcal', t('Calories'), 'kcal')}
      {field('p', t('Protein'), 'g')}
      {field('c', t('Carbs'), 'g')}
      {field('f', t('Fat'), 'g')}
    </div>
    {mealPicker}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={() => (kcal > 0
      ? onAdd({ name: name.trim() || t('Quick add'), kcal, p: v.p || 0, c: v.c || 0, f: v.f || 0 })
      : toast(t('Enter calories or macros')))}>{t('Add')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="tinted" onClick={onCancel}>{t('Back')}</Button>
  </>
}

/* ============================ one logged entry ============================ */

const entrySheet = e => useUI.getState().openSheet(close => <EntrySheet entry={e} close={close} />)

function EntrySheet({ entry, close }) {
  const food = (S().foods || []).find(f => f.id === entry.foodId)
  const oz = usesOz()
  const [amt, setAmt] = useState(entry.g ? (oz ? Math.round((entry.g / OZ) * 10) / 10 : entry.g) : null)
  const g = amt == null ? null : oz ? amt * OZ : amt
  const del = () => confirmSheet({
    title: t('Remove {0}?', entry.name), confirmText: t('Remove'), danger: true,
    onConfirm: () => { update(s => { s.foodLog = (s.foodLog || []).filter(x => x.id !== entry.id) }); close() },
  })
  const save = () => {
    update(s => { s.foodLog = (s.foodLog || []).map(x => (x.id === entry.id ? entryFrom(food, g, { d: x.d, meal: x.meal, id: x.id }) : x)) })
    close()
  }
  return <>
    <h3 style={{ marginBottom: 2 }}>{entry.name}</h3>
    <div className="small muted" style={{ marginBottom: 12 }}>{n0(entry.kcal)} kcal · P {g1(entry.p)} · C {g1(entry.c)} · F {g1(entry.f)}</div>
    {food && entry.g ? <>
      <label className="fd-field"><span className="small muted">{oz ? t('Ounces') : t('Grams')}</span><NumberField className="field" value={amt} onChange={setAmt} /></label>
      <div style={{ height: 12 }} />
      <Button variant="primary" onClick={save} disabled={!(g > 0)}>{t('Save')}</Button>
      <div style={{ height: 8 }} />
    </> : null}
    <Button variant="danger" icon="trash" onClick={del}>{t('Remove')}</Button>
  </>
}
