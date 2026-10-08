// Nutrition: daily targets from the profile's stats, and the food log read back day by day.
//
// Targets come from one method, the one nutrition-check.js does NOT use, so the check is a real
// second opinion rather than the same sum done twice:
//   BMR   Mifflin-St Jeor (1990) — the estimate dietitians default to for healthy adults.
//   TDEE  BMR × an activity factor (sedentary 1.2 … very hard 1.9).
//   Goal  a percentage off TDEE: cut −20 %, recomp −10 %, maintain 0, bulk +10 %.
//   Macros protein first (it is what keeps muscle in a deficit), fat at a healthy floor, carbs
//          take whatever is left.
//
// The log stores each entry's numbers as they were when it was eaten — editing a saved food
// later does not rewrite what a past day added up to.
//
// Body weight is read from the weigh-ins (S.bodyweight, in the profile's unit); everything in
// here works in kg and cm and converts at the edge.

export const LB = 0.45359237
export const KCAL_PER_KG = 7700   // energy in a kg of body-weight change, the usual rule of thumb

export const ACTIVITY = {
  sedentary: 1.2,    // desk job, little walking, no training
  light: 1.375,      // training 1–3 days a week
  moderate: 1.55,    // training 3–5 days a week
  very: 1.725,       // training 6–7 days a week
  extra: 1.9,        // hard training plus a physical job
}
export const ACTIVITY_LEVELS = Object.keys(ACTIVITY)

export const GOAL_ADJUST = { cut: -0.20, recomp: -0.10, maintain: 0, bulk: 0.10 }
export const GOALS = Object.keys(GOAL_ADJUST)

// Protein per kg of body weight, or per kg of fat-free mass when the body fat is known. High in
// a deficit on purpose: 1.6–2.2 g/kg is the range the meta-analyses find for keeping and adding
// muscle while lifting, and the top of it while cutting (Morton 2018; Helms 2014).
const PROTEIN_PER_KG = { cut: 2.2, recomp: 2.2, maintain: 1.8, bulk: 1.8 }
const PROTEIN_PER_KG_FFM = { cut: 2.6, recomp: 2.6, maintain: 2.2, bulk: 2.2 }
const FAT_SHARE = 0.25            // of the day's calories
const FAT_MIN_PER_KG = 0.6        // below this, hormones start to suffer

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

export const toKg = (w, unit) => (unit === 'lb' ? w * LB : w)
export const fromKg = (kg, unit) => (unit === 'lb' ? kg / LB : kg)
// Steps below 1 divide by their inverse, so 0.1 steps give 6.6 rather than 6.6000000000000005.
const round = (n, step = 1) => (step < 1 ? Math.round(n * (1 / step)) / (1 / step) : Math.round(n / step) * step)
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function ageOf(born, today) {
  const y = Number(String(today || '').slice(0, 4))
  return born && y ? y - Number(born) : null
}

/**
 * Today's body weight in kg: the mean of the weigh-ins in the seven days up to `today` (one
 * morning's weight swings with water and salt by more than a week of dieting moves it), else the
 * latest weigh-in on or before it. null without any.
 */
export function currentWeightKg(bodyweight, unit, today) {
  const ok = (Array.isArray(bodyweight) ? bodyweight : []).filter(b => b?.d && num(b.w) > 0 && b.d <= today)
  if (!ok.length) return null
  const from = shiftISO(today, -6)
  const week = ok.filter(b => b.d >= from)
  const src = week.length ? week : [ok.reduce((a, b) => (b.d > a.d ? b : a))]
  return toKg(src.reduce((s, b) => s + num(b.w), 0) / src.length, unit)
}

export function shiftISO(iso, days) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Mifflin-St Jeor resting energy, kcal/day.
export function mifflin({ sex, kg, cm, age }) {
  return 10 * kg + 6.25 * cm - 5 * age + (sex === 'female' ? -161 : 5)
}

// What a profile needs before anything can be worked out: missing fields by name.
export function missingInputs(profile, kg) {
  const p = profile || {}
  const miss = []
  if (!p.sex) miss.push('sex')
  if (!p.born) miss.push('born')
  if (!(num(p.cm) > 0)) miss.push('cm')
  if (!ACTIVITY[p.activity]) miss.push('activity')
  if (!(GOAL_ADJUST[p.goal] !== undefined)) miss.push('goal')
  if (!(kg > 0)) miss.push('weight')
  return miss
}

// The weight protein is counted against. Without a body-fat figure, someone well above a healthy
// weight would get a protein target sized for muscle they do not carry, so the weight is capped
// at a BMI of 27 for that purpose only.
export function proteinBasisKg(kg, cm) {
  const cap = 27 * (cm / 100) ** 2
  return Math.min(kg, cap)
}

/**
 * Calculated targets: { bmr, tdee, kcal, p, c, f } (kcal and grams per day), or null while an
 * input is missing. `profile` is S.nutri: { sex, born, cm, activity, goal, bf? }.
 */
export function calcTargets(profile, kg, today) {
  if (missingInputs(profile, kg).length) return null
  const { sex, born, cm, activity, goal } = profile
  const age = ageOf(born, today)
  const bmr = mifflin({ sex, kg, cm: num(cm), age })
  const tdee = bmr * ACTIVITY[activity]
  const kcal = round(tdee * (1 + GOAL_ADJUST[goal]), 10)
  const bf = num(profile.bf)
  const p = round(bf > 0 && bf < 70
    ? PROTEIN_PER_KG_FFM[goal] * kg * (1 - bf / 100)
    : PROTEIN_PER_KG[goal] * proteinBasisKg(kg, num(cm)), 5)
  const f = round(Math.max(FAT_MIN_PER_KG * proteinBasisKg(kg, num(cm)), (kcal * FAT_SHARE) / 9), 5)
  const c = Math.max(0, round((kcal - 4 * p - 9 * f) / 4, 5))
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, p, c, f }
}

/**
 * The targets the app works to: the profile's own numbers when it chose to type them in
 * (`custom`), else the calculated ones. Returns { kcal, p, c, f, custom } or null.
 */
export function activeTargets(profile, kg, today) {
  const cu = profile?.custom
  if (cu && num(cu.kcal) > 0) return { kcal: num(cu.kcal), p: num(cu.p), c: num(cu.c), f: num(cu.f), custom: true }
  const calc = calcTargets(profile, kg, today)
  return calc && { kcal: calc.kcal, p: calc.p, c: calc.c, f: calc.f, custom: false }
}

/* ---------------------------- foods and the log ---------------------------- */

// A food's numbers for `g` grams. Foods store per 100 g: { kcal, p, c, f }.
export function macrosFor(food, g) {
  const k = num(g) / 100
  const per = food?.per100 || {}
  return { kcal: num(per.kcal) * k, p: num(per.p) * k, c: num(per.c) * k, f: num(per.f) * k }
}

// A log entry from a saved food and an amount in grams. Rounded once, here, so the day's totals
// add up to exactly what each row shows.
export function entryFrom(food, g, { d, meal, id }) {
  const m = macrosFor(food, g)
  return {
    id, d, meal, foodId: food.id, name: food.name, brand: food.brand || undefined, g: round(num(g), 0.1),
    kcal: Math.round(m.kcal), p: round(m.p, 0.1), c: round(m.c, 0.1), f: round(m.f, 0.1),
  }
}

export function dayTotals(log, d) {
  const out = { kcal: 0, p: 0, c: 0, f: 0, n: 0 }
  for (const e of Array.isArray(log) ? log : []) {
    if (e?.d !== d) continue
    out.kcal += num(e.kcal); out.p += num(e.p); out.c += num(e.c); out.f += num(e.f); out.n++
  }
  out.p = round(out.p, 0.1); out.c = round(out.c, 0.1); out.f = round(out.f, 0.1)
  return out
}

export function entriesByMeal(log, d) {
  const by = Object.fromEntries(MEALS.map(m => [m, []]))
  for (const e of Array.isArray(log) ? log : []) if (e?.d === d) (by[e.meal] || by.snack).push(e)
  return by
}

// Saved foods, most recently eaten first, then the never-eaten ones by name. A search narrows by
// every word appearing in the name, brand or barcode.
export function foodList(foods, log, q = '') {
  const last = new Map()
  for (const e of Array.isArray(log) ? log : []) {
    if (e?.foodId && (!last.has(e.foodId) || e.d > last.get(e.foodId))) last.set(e.foodId, e.d)
  }
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean)
  return (Array.isArray(foods) ? foods : [])
    .filter(f => words.every(w => `${f.name || ''} ${f.brand || ''} ${f.barcode || ''}`.toLowerCase().includes(w)))
    .sort((a, b) => {
      const la = last.get(a.id) || '', lb = last.get(b.id) || ''
      return la !== lb ? (la < lb ? 1 : -1) : String(a.name).localeCompare(String(b.name))
    })
}

// Every entry of day `from` copied to day `to` under fresh ids ("same as yesterday").
export function copyDay(log, from, to, newId) {
  return (Array.isArray(log) ? log : []).filter(e => e?.d === from).map(e => ({ ...e, id: newId(), d: to }))
}

/**
 * Energy balance read off the logs: what the food log and the weigh-ins together say this body
 * actually burns. Over the `days` before `today` (today itself is not finished), the mean logged
 * intake, minus the weight trend (least squares, kg/day) times KCAL_PER_KG. Needs at least 10
 * logged days and weigh-ins spanning at least 10 days; null otherwise.
 * Returns { tdee, intake, kgPerWeek, loggedDays }.
 */
export function observedTdee(log, bodyweight, unit, today, days = 21) {
  const from = shiftISO(today, -days)
  const perDay = new Map()
  for (const e of Array.isArray(log) ? log : []) {
    if (!e?.d || e.d < from || e.d >= today) continue
    perDay.set(e.d, (perDay.get(e.d) || 0) + num(e.kcal))
  }
  const loggedDays = perDay.size
  if (loggedDays < 10) return null
  const pts = (Array.isArray(bodyweight) ? bodyweight : [])
    .filter(b => b?.d && b.d >= from && b.d < today && num(b.w) > 0)
    .map(b => ({ x: (Date.parse(b.d) - Date.parse(from)) / 864e5, y: toKg(num(b.w), unit) }))
  if (pts.length < 4) return null
  const xs = pts.map(p => p.x)
  if (Math.max(...xs) - Math.min(...xs) < 10) return null
  const mx = xs.reduce((a, b) => a + b, 0) / pts.length
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length
  const slope = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / pts.reduce((a, p) => a + (p.x - mx) ** 2, 0)
  const intake = [...perDay.values()].reduce((a, b) => a + b, 0) / loggedDays
  return { tdee: Math.round(intake - slope * KCAL_PER_KG), intake: Math.round(intake), kgPerWeek: slope * 7, loggedDays }
}
