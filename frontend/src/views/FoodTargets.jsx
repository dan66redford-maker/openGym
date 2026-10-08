import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { ACTIVITY_LEVELS, GOALS, activeTargets, ageOf, calcTargets, currentWeightKg, fromKg, missingInputs } from '../lib/nutrition.js'
import { checkTargets } from '../lib/nutrition-check.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Section, Segmented, SelectRow, Switch } from '../components/ui.jsx'
import { bwSheet } from '../sheets.jsx'
import '../food.css'

// The nutrition profile and the targets it gives: stats in, calories and macros out
// (lib/nutrition.js), and under them the second opinion (lib/nutrition-check.js) — a different
// equation and the sports-nutrition guard rails, applied to whatever targets are in force,
// worked-out or typed in.

const update = (...a) => useStore.getState().update(...a)
const setNutri = patch => update(s => { s.nutri = { ...(s.nutri || {}), ...patch } })

const ACTIVITY_COPY = {
  sedentary: () => ({ label: t('Sedentary'), sub: t('Desk job, little walking, no training') }),
  light: () => ({ label: t('Lightly active'), sub: t('Training 1–3 days a week') }),
  moderate: () => ({ label: t('Moderately active'), sub: t('Training 3–5 days a week') }),
  very: () => ({ label: t('Very active'), sub: t('Training 6–7 days a week') }),
  extra: () => ({ label: t('Extremely active'), sub: t('Hard training plus a physical job') }),
}
const GOAL_COPY = {
  cut: () => ({ label: t('Lose fat, keep building muscle'), sub: t('About 20% under maintenance, high protein') }),
  recomp: () => ({ label: t('Recomp'), sub: t('About 10% under — slower fat loss, more muscle') }),
  maintain: () => ({ label: t('Maintain'), sub: t('Eat at maintenance') }),
  bulk: () => ({ label: t('Lean bulk'), sub: t('About 10% over — gain muscle, little fat') }),
}
const VERDICT = {
  ok: { icon: 'checkCircle', text: () => t('All checks pass') },
  info: { icon: 'checkCircle', text: () => t('All checks pass') },
  warn: { icon: 'warning', text: () => t('Worth a look') },
  fail: { icon: 'xmark', text: () => t('These targets need fixing') },
}
const LEVEL_ICON = { ok: 'checkCircle', info: 'info', warn: 'warning', fail: 'xmark' }

export default function FoodTargets() {
  const nav = useNavigate()
  const st = useStore(s => s.S)
  const today = todayISO()
  const p = st.nutri || {}
  const kg = currentWeightKg(st.bodyweight, st.unit, today)
  const calc = calcTargets(p, kg, today)
  const tg = activeTargets(p, kg, today)
  const missing = missingInputs(p, kg)
  const res = !missing.length || p.custom ? checkTargets({ profile: p, kg, targets: tg, today, log: st.foodLog, bodyweight: st.bodyweight, unit: st.unit }) : null
  const imperial = st.unit === 'lb'
  const ft = p.cm ? Math.floor(p.cm / 30.48 + 1e-9) : null
  const inch = p.cm ? Math.round((p.cm / 2.54 - ft * 12) * 10) / 10 : null
  const setFtIn = (f, i) => setNutri({ cm: (f || 0) * 30.48 + (i || 0) * 2.54 || null })
  const age = ageOf(p.born, today)
  const custom = !!p.custom
  const toggleCustom = on => setNutri({ custom: on ? { kcal: tg?.kcal || 2000, p: tg?.p || 150, c: tg?.c || 200, f: tg?.f || 65 } : null })
  const setCustom = (key, n) => setNutri({ custom: { ...p.custom, [key]: n || 0 } })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/food')} aria-label={t('Food')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: 28 }}>{t('Targets')}</h1>
        <div className="sub">{t('Calories and macros for your goal')}</div>
      </div>
    </div>

    <Section title={t('Your stats')}>
      <div className="card" style={{ margin: 0 }}>
        <div className="fd-stat"><span>{t('Sex')}</span>
          <Segmented value={p.sex} onChange={v => setNutri({ sex: v })} options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} /></div>
        <div className="fd-stat"><span>{t('Year of birth')}{age ? <span className="muted small"> · {t('{0} years', age)}</span> : null}</span>
          <NumberField className="field" decimal={false} nullable value={p.born} placeholder="1995" onChange={v => setNutri({ born: v })} /></div>
        {imperial
          ? <div className="fd-stat"><span>{t('Height')}</span>
              <span className="row" style={{ gap: 6 }}>
                <NumberField className="field" decimal={false} nullable value={ft} placeholder="5" style={{ width: 52 }} onChange={v => setFtIn(v, inch)} /><span className="small muted">ft</span>
                <NumberField className="field" nullable value={inch} placeholder="10" style={{ width: 60 }} onChange={v => setFtIn(ft, v)} /><span className="small muted">in</span>
              </span></div>
          : <div className="fd-stat"><span>{t('Height')}</span>
              <span className="row" style={{ gap: 6 }}><NumberField className="field" nullable value={p.cm ? Math.round(p.cm) : null} placeholder="178" onChange={v => setNutri({ cm: v })} /><span className="small muted">cm</span></span></div>}
        <div className="fd-stat"><span>{t('Weight')}<div className="small muted">{kg ? t('7-day average of your weigh-ins') : t('Log a weigh-in first')}</div></span>
          <span className="row" style={{ gap: 8 }}>{kg ? <b style={{ whiteSpace: 'nowrap' }}>{Math.round(fromKg(kg, st.unit) * 10) / 10} {st.unit}</b> : null}
            <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button></span></div>
        <div className="fd-stat"><span>{t('Body fat')}<div className="small muted">{t('Optional — makes protein and the check more precise')}</div></span>
          <span className="row" style={{ gap: 6 }}><NumberField className="field" nullable value={p.bf ?? null} placeholder="—" onChange={v => setNutri({ bf: v })} /><span className="small muted">%</span></span></div>
      </div>
    </Section>

    <Section>
      <SelectRow icon="figureRun" title={t('Activity')} value={p.activity} sheetTitle={t('How active are you?')}
        options={ACTIVITY_LEVELS.map(a => ({ value: a, label: ACTIVITY_COPY[a]().label, subtitle: ACTIVITY_COPY[a]().sub }))}
        onChange={v => setNutri({ activity: v })} />
      <SelectRow icon="target" title={t('Goal')} value={p.goal} sheetTitle={t('Your goal')}
        options={GOALS.map(g => ({ value: g, label: GOAL_COPY[g]().label, subtitle: GOAL_COPY[g]().sub }))}
        onChange={v => setNutri({ goal: v })} />
    </Section>

    <Section title={t('Daily targets')} footer={custom ? t('Your own numbers — the check below still runs on them.') : calc ? t('Maintenance about {0} kcal (Mifflin-St Jeor × activity).', calc.tdee.toLocaleString()) : undefined}>
      <div className="card" style={{ margin: 0 }}>
        {tg && !custom ? <div className="fd-targets">
          <div><b>{tg.kcal.toLocaleString()}</b><span>kcal</span></div>
          <div><b>{tg.p}</b><span>{t('protein g')}</span></div>
          <div><b>{tg.c}</b><span>{t('carbs g')}</span></div>
          <div><b>{tg.f}</b><span>{t('fat g')}</span></div>
        </div> : null}
        {!tg && !custom && <div className="muted small" style={{ lineHeight: 1.5 }}>{t('Fill in your stats, activity and goal above, and your targets appear here.')}</div>}
        {custom && <div className="fd-grid" style={{ marginTop: 0 }}>
          {[['kcal', t('Calories'), 'kcal'], ['p', t('Protein'), 'g'], ['c', t('Carbs'), 'g'], ['f', t('Fat'), 'g']].map(([k, label, unit]) =>
            <label className="fd-field" key={k}><span className="small muted">{label}</span>
              <span className="row" style={{ gap: 6 }}><NumberField className="field" decimal={false} value={p.custom[k]} onChange={v => setCustom(k, v)} /><span className="small muted">{unit}</span></span></label>)}
        </div>}
        <div className="fd-stat" style={{ marginTop: 8 }}><span>{t('Set my own numbers')}</span><Switch checked={custom} onChange={toggleCustom} /></div>
      </div>
    </Section>

    {res && <Section title={t('Second opinion')} footer={t('An independent check: a second formula ({0}) and evidence-based limits for building muscle while losing fat. A guide, not medical advice.', res.second?.method || 'Harris-Benedict')}>
      <div className="card" style={{ margin: 0 }}>
        <div className={'fd-verdict ' + res.level}><Icon name={VERDICT[res.level].icon} />{VERDICT[res.level].text()}</div>
        {res.checks.map(c => <div key={c.id} className={'fd-check ' + c.level}><Icon name={LEVEL_ICON[c.level]} /><span>{t(c.msg, ...c.args.map(a => (typeof a === 'number' && a >= 1000 ? a.toLocaleString() : a)))}</span></div>)}
      </div>
    </Section>}
  </div>
}
