// Health habits, and the bridge from Apple Health.
//
// The habits are the ones with the strongest evidence against type 2 diabetes, read off what the
// app already knows (workouts, weigh-ins, the food log) and what Apple Health hands it:
//   • 150+ minutes of moderate exercise a week, and weight loss of 5–7 % — together they cut new
//     cases by 58 % in the Diabetes Prevention Program (NEJM 2002);
//   • strength training at least twice a week (ADA Standards of Care) — muscle takes up most of
//     the sugar from a meal;
//   • fibre 14 g per 1,000 kcal and sugar under 10 % of calories (Dietary Guidelines for Americans);
//   • 7–9 hours of sleep (AASM) — short sleep makes the body handle sugar worse;
//   • ~7,000+ steps a day (Paluch, Lancet Public Health 2022);
//   • blood glucose, when a meter or CGM writes it to Apple Health, against the ADA's fasting
//     ranges (under 100 mg/dL normal, 100–125 prediabetes range, 126+ diabetes range).
//
// Apple Health: a web app cannot read HealthKit, and an iPhone home-screen app cannot be handed
// data through a link (links open in Safari, whose storage is separate). So a Shortcut reads the
// numbers, copies them as plain text ("steps: 8123", one per line), and the app pastes them
// (views/Health.jsx). parseHealthText is deliberately forgiving about what that text looks like:
// thousands separators, units after the number, durations as "7 hr 12 min" or "7:12".
//
// S.health is { 'YYYY-MM-DD': { steps, exMin, active, sleep, rhr, glu } } — glucose in mg/dL,
// sleep in hours, active energy in kcal. Weight goes to the weigh-ins like any other.

import { shiftISO } from './nutrition.js'

const KEYS = {
  steps: ['steps', 'stepcount'],
  exMin: ['exercise', 'exerciseminutes', 'exercisetime', 'exmin', 'workoutminutes'],
  active: ['active', 'activeenergy', 'activecalories', 'activekcal', 'move', 'activeenergyburned'],
  sleep: ['sleep', 'sleephours', 'asleep', 'sleeptime'],
  rhr: ['rhr', 'restingheartrate', 'restinghr', 'resting'],
  weight: ['weight', 'bodyweight', 'bodymass'],
  glu: ['glucose', 'bloodglucose', 'bloodsugar', 'glu'],
  date: ['date', 'day'],
}
const ALIAS = new Map(Object.entries(KEYS).flatMap(([k, names]) => names.map(n => [n, k])))
const RANGE = { steps: [0, 100000], exMin: [0, 1440], active: [0, 10000], sleep: [0, 24], rhr: [25, 220], glu: [20, 600] }
export const HEALTH_FIELDS = Object.keys(RANGE)

// The first number in a string, reading "8,123" as eight thousand and "7,2" as seven point two.
export function numberIn(s) {
  const m = String(s).match(/\d[\d.,]*/)
  if (!m) return null
  let t = m[0].replace(/[.,]$/, '')
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '')
  else if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.')
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

// "7 hr 12 min", "7h 12m", "7:12", "432 min", "7.2" → hours.
function hoursIn(s) {
  const v = String(s).toLowerCase()
  const clock = v.match(/(\d+):(\d{2})/)
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60
  const h = v.match(/(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\b/)
  const m = v.match(/(\d+(?:[.,]\d+)?)\s*(?:minutes?|mins?|m)\b/)
  if (h || m) return (h ? numberIn(h[1]) : 0) + (m ? numberIn(m[1]) / 60 : 0)
  return numberIn(v)
}

function dateIn(s, today) {
  const v = String(s).trim().toLowerCase()
  if (!v || v === 'today') return today
  if (v === 'yesterday') return shiftISO(today, -1)
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const round = (n, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp

/**
 * Text from the Shortcut → { d, values, weight, dropped, ok }.
 *   d        the day it is for ('date: yesterday', an iso date, or today)
 *   values   { steps?, exMin?, active?, sleep?, rhr?, glu? } in the units S.health keeps
 *   weight   in the profile's unit, or null
 *   dropped  keys whose value was missing or impossible, so the screen can say so
 *   ok       whether anything usable was found
 * Lines are "key: value" or "key = value"; ";" also separates. Unknown keys are ignored.
 */
export function parseHealthText(text, { today, unit = 'kg' }) {
  const values = {}, dropped = []
  let d = today, weight = null, any = false
  for (const raw of String(text || '').split(/[\n;]+/)) {
    const m = raw.match(/^\s*([A-Za-z][A-Za-z ._-]*?)\s*[:=]\s*(.*)$/)
    if (!m) continue
    const key = ALIAS.get(m[1].toLowerCase().replace(/[^a-z]/g, ''))
    if (!key) continue
    any = true
    const v = m[2].trim()
    if (key === 'date') { d = dateIn(v, today) || today; continue }
    const low = v.toLowerCase()
    let n
    if (key === 'sleep') {
      n = hoursIn(v)
      // A bare number too big for hours is minutes, or seconds (a summed duration).
      if (n > 24 && !/[a-z:]/.test(low)) n = n <= 1440 ? n / 60 : n / 3600
    }
    else if (key === 'exMin') n = /\b(hr|hours?|h)\b/.test(low) ? hoursIn(v) * 60 : numberIn(v)
    else n = numberIn(v)
    if (n == null) { dropped.push(key); continue }
    if (key === 'weight') {
      const isLb = /\b(lb|lbs|pounds?)\b/.test(low), isKg = /\b(kg|kilo)/.test(low)
      const kg = isLb ? n * 0.45359237 : isKg ? n : unit === 'lb' ? n * 0.45359237 : n
      if (kg < 25 || kg > 300) { dropped.push(key); continue }
      weight = round(unit === 'lb' ? kg / 0.45359237 : kg, 1)
      continue
    }
    if (key === 'active' && /\bkj\b/.test(low)) n = n / 4.184
    // mmol/L, said so or implied: no one is walking around at 30 mg/dL.
    if (key === 'glu' && (/mmol/.test(low) || n < 35)) n = n * 18.016
    const [lo, hi] = RANGE[key]
    if (n < lo || n > hi) { dropped.push(key); continue }
    values[key] = key === 'sleep' ? round(n, 2) : round(n)
  }
  return { d, values, weight, dropped, ok: any && (Object.keys(values).length > 0 || weight != null) }
}

export const mergeHealthDay = (health, d, values) => ({ ...(health || {}), [d]: { ...(health?.[d] || {}), ...values } })

// What the Shortcut that sends food to Apple Health receives: one JSON object, which its
// "Get Dictionary from Input" action reads.
export function foodForHealth(totals, d) {
  const r1 = n => round(Number(n) || 0, 1)
  return JSON.stringify({ date: d, kcal: Math.round(totals.kcal || 0), protein: r1(totals.p), carbs: r1(totals.c), fat: r1(totals.f), fiber: r1(totals.fib), sugar: r1(totals.sug) })
}

// Fibre target and sugar ceiling for a day's calories.
export const fibreSugarTargets = kcal => ({ fib: Math.round((14 * (kcal || 2000)) / 1000), sug: Math.round((0.10 * (kcal || 2000)) / 4) })

/**
 * The last seven days, today included, read back for the scorecard. Daily averages leave today
 * out when there are other days (a morning sync would drag the average down with half a day).
 */
export function weekSummary(S, today) {
  const from = shiftISO(today, -6)
  const inWin = d => d >= from && d <= today
  const health = S.health || {}
  const days = Object.keys(health).filter(inWin).sort()
  const series = key => days.filter(d => health[d][key] != null).map(d => ({ d, v: Number(health[d][key]) }))
  const avg = (xs, skipToday = true) => {
    const use = skipToday && xs.some(x => x.d !== today) ? xs.filter(x => x.d !== today) : xs
    return use.length ? use.reduce((a, x) => a + x.v, 0) / use.length : null
  }
  const workouts = (S.workouts || []).filter(w => w?.d && inWin(w.d))
  const minutesOf = w => Math.min(240, Math.max(0, ((w.end || 0) - (w.start || 0)) / 60000))
  const exFromWorkouts = workouts.reduce((a, w) => a + minutesOf(w), 0)
  // Exercise minutes day by day: Apple Health's count where it has one (the Watch counts gym time
  // too), else the workouts logged here that day — never both for one day, which would count a
  // session twice, and never Health alone when it only covers some of the week.
  let exMin = null
  for (let i = 0; i < 7; i++) {
    const d = shiftISO(today, -i)
    const h = health[d]?.exMin
    const fromW = workouts.filter(w => w.d === d).reduce((a, w) => a + minutesOf(w), 0)
    if (h != null) exMin = (exMin || 0) + Number(h)
    else if (fromW) exMin = (exMin || 0) + fromW
  }
  // Food: complete days only, and fibre/sugar only from entries that carry them.
  const food = {}
  for (const e of S.foodLog || []) {
    if (!e?.d || !inWin(e.d) || e.d === today) continue
    const f = food[e.d] || (food[e.d] = { kcal: 0, fib: 0, sug: 0, n: 0, withFib: 0, withSug: 0 })
    f.kcal += Number(e.kcal) || 0; f.n++
    if (e.fib != null) { f.fib += Number(e.fib); f.withFib++ }
    if (e.sug != null) { f.sug += Number(e.sug); f.withSug++ }
  }
  const foodDays = Object.values(food)
  const n = foodDays.reduce((a, f) => a + f.n, 0)
  const fibCovered = n > 0 && foodDays.reduce((a, f) => a + f.withFib, 0) / n >= 0.6
  const sugCovered = n > 0 && foodDays.reduce((a, f) => a + f.withSug, 0) / n >= 0.6
  // Weight: the weigh-ins of the last week against where the cut started.
  const bw = (S.bodyweight || []).filter(b => b?.d && Number(b.w) > 0 && b.d <= today).sort((a, b) => (a.d < b.d ? -1 : 1))
  const recent = bw.filter(b => b.d >= from)
  const current = recent.length ? recent.reduce((a, b) => a + Number(b.w), 0) / recent.length : bw.length ? Number(bw[bw.length - 1].w) : null
  const startW = Number(S.nutri?.startW) > 0 ? Number(S.nutri.startW) : bw.length ? Number(bw[0].w) : null
  return {
    from, today,
    steps: avg(series('steps')),
    exMin: exMin == null ? null : Math.round(exMin),
    exMinWorkouts: Math.round(exFromWorkouts),
    strengthDays: new Set(workouts.map(w => w.d)).size,
    sleep: avg(series('sleep'), false),
    rhr: avg(series('rhr'), false),
    glu: series('glu'),
    foodDays: foodDays.length,
    fib: fibCovered ? foodDays.reduce((a, f) => a + f.fib, 0) / foodDays.length : null,
    sug: sugCovered ? foodDays.reduce((a, f) => a + f.sug, 0) / foodDays.length : null,
    weight: current, startW,
    lostPct: current != null && startW ? ((startW - current) / startW) * 100 : null,
    lastSync: Object.keys(health).sort().pop() || null,
  }
}

/**
 * The scorecard: one entry per habit, { id, level, title, msg, args }. level is ok · warn · fail
 * when there is data to judge, info for advice without a verdict, none when there is nothing yet
 * (the screen says how to get it). Text is message keys and arguments, translated by the screen.
 */
export function habitChecks(sum, { kcal, goal, age, bmi, unit = '' } = {}) {
  const out = []
  const add = (id, level, title, msg, ...args) => out.push({ id, level, title, msg, args })
  const tg = fibreSugarTargets(kcal)

  // Exercise minutes: Apple Health's count (the Watch counts gym time too) or, without it, the
  // length of the workouts logged here — never both, which would count a session twice.
  const ex = sum.exMin
  if (ex == null) add('activity', 'none', 'Exercise', 'Sync Apple Health or log workouts to track your 150 minutes a week.')
  else if (ex >= 150) add('activity', 'ok', 'Exercise', '{0} minutes this week — at or past the 150 that cut diabetes risk in the big prevention trial.', Math.round(ex))
  else add('activity', 'warn', 'Exercise', '{0} of 150 minutes this week — {1} to go. Brisk walking counts.', Math.round(ex), 150 - Math.round(ex))

  if (sum.strengthDays >= 2) add('strength', 'ok', 'Strength training', '{0} lifting days this week — muscle is where most of the sugar from a meal goes.', sum.strengthDays)
  else add('strength', 'warn', 'Strength training', '{0} lifting days this week — aim for at least 2. Muscle is where most of the sugar from a meal goes.', sum.strengthDays)

  if (sum.steps == null) add('steps', 'none', 'Steps', 'Sync Apple Health to see your daily steps.')
  else if (sum.steps >= 7000) add('steps', 'ok', 'Steps', '{0} steps a day on average — good.', Math.round(sum.steps).toLocaleString())
  else if (sum.steps >= 5000) add('steps', 'warn', 'Steps', '{0} steps a day on average — 7,000+ is linked to clearly better health. A walk after meals also lowers blood sugar.', Math.round(sum.steps).toLocaleString())
  else add('steps', 'warn', 'Steps', 'Only {0} steps a day on average. A 10–15 minute walk after meals lowers blood sugar and adds up fast.', Math.round(sum.steps).toLocaleString())

  if (sum.sleep == null) add('sleep', 'none', 'Sleep', 'Sync Apple Health to see your sleep.')
  else if (sum.sleep < 7) add('sleep', 'warn', 'Sleep', '{0} hours a night on average. Under 7 makes your body handle blood sugar worse — aim for 7–9.', round(sum.sleep, 1))
  else if (sum.sleep > 9.5) add('sleep', 'info', 'Sleep', '{0} hours a night on average — on the long side; if you still feel tired, mention it to your doctor.', round(sum.sleep, 1))
  else add('sleep', 'ok', 'Sleep', '{0} hours a night on average — in the 7–9 hour range.', round(sum.sleep, 1))

  if (sum.fib == null) add('fiber', 'none', 'Fiber', sum.foodDays ? 'Not enough of your foods list fiber yet — scanned foods usually do.' : 'Log your food to track fiber.')
  else if (sum.fib >= tg.fib * 0.9) add('fiber', 'ok', 'Fiber', '{0} g a day on average — at your {1} g target.', Math.round(sum.fib), tg.fib)
  else add('fiber', 'warn', 'Fiber', '{0} g a day on average — aim for {1} g. Beans, lentils, oats, vegetables, berries and whole grains slow how fast sugar hits your blood.', Math.round(sum.fib), tg.fib)

  if (sum.sug == null) add('sugar', 'none', 'Sugar', sum.foodDays ? 'Not enough of your foods list sugar yet — scanned foods usually do.' : 'Log your food to track sugar.')
  else if (sum.sug <= tg.sug) add('sugar', 'ok', 'Sugar', '{0} g a day on average — under the {1} g guide (10% of calories).', Math.round(sum.sug), tg.sug)
  else add('sugar', 'warn', 'Sugar', '{0} g a day on average — over the {1} g guide (10% of calories). Sugary drinks are the first thing to cut; fruit is fine.', Math.round(sum.sug), tg.sug)

  if (sum.lostPct == null) add('weight', 'none', 'Weight', 'Log your weight to track progress toward losing 5–7%.')
  else if (sum.lostPct >= 5) add('weight', 'ok', 'Weight', 'Down {0}% from {1} {2} — the 5–7% that, with exercise, more than halved diabetes risk.', round(sum.lostPct, 1), round(sum.startW, 1), unit)
  else if (sum.lostPct > 0) add('weight', goal === 'cut' || goal === 'recomp' ? 'info' : 'ok', 'Weight', 'Down {0}% from {1} {2}. Losing 5–7% is the goal that more than halved diabetes risk.', round(sum.lostPct, 1), round(sum.startW, 1), unit)
  else if (goal === 'cut' || goal === 'recomp') add('weight', 'warn', 'Weight', 'Not down from {0} {1} yet. Give it 2–3 weeks of logging — the targets screen will tell you if your calories need to move.', round(sum.startW, 1), unit)
  else add('weight', 'info', 'Weight', 'Your goal is not to lose weight right now.')

  if (sum.glu?.length) {
    const avgG = sum.glu.reduce((a, x) => a + x.v, 0) / sum.glu.length
    if (avgG >= 126) add('glucose', 'fail', 'Blood sugar', 'Your readings average {0} mg/dL. If those are fasting readings, that is in the diabetes range — please see your doctor soon.', Math.round(avgG))
    else if (avgG >= 100) add('glucose', 'warn', 'Blood sugar', 'Your readings average {0} mg/dL. Fasting readings of 100–125 are the prediabetes range — worth raising with your doctor.', Math.round(avgG))
    else add('glucose', 'ok', 'Blood sugar', 'Your readings average {0} mg/dL — in the normal fasting range.', Math.round(avgG))
  }

  // The real checkpoint, which no app replaces.
  if ((age && age >= 35) || (bmi && bmi >= 25)) add('checkup', 'info', 'Checkup', 'Ask your doctor for an A1C or fasting glucose test if you have not had one in the last 3 years — it is the only way to know where you stand.')
  else add('checkup', 'info', 'Checkup', 'An A1C or fasting glucose test from your doctor is the only way to know where you stand — worth asking at your next checkup.')
  return out
}
