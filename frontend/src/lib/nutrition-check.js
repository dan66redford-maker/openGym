// The second opinion on the nutrition targets. nutrition.js works the targets out one way; this
// checks whatever targets are in force — calculated or typed in by hand — another way, and says
// in plain words where they stop making sense.
//
// It is deliberately independent of the method it checks:
//   • resting energy from a different equation: Katch-McArdle (1996) when the body fat is known —
//     it works from lean mass, which is what burns the energy — else the revised Harris-Benedict
//     (Roza & Shizgal 1984). Two equations that disagree by more than ~10 % mean an input is off.
//   • the targets are judged against the average of the two maintenance estimates, not the one
//     they were built from.
//   • guard rails from the sports-nutrition literature: a deficit small enough to keep muscle,
//     loss of 0.5–1 % of body weight a week, protein 1.6–2.2+ g/kg while lifting, fat at or above
//     ~0.5 g/kg and 20 % of calories.
//   • and, once there are two to three weeks of food logs and weigh-ins, the real world: what the
//     logs say this body burns, against what the formulas assumed.
//
// Every check returns a message key and its arguments rather than finished text, so the screen
// translates it (t(msg, ...args)). Levels: ok · info · warn · fail.
import { ACTIVITY, GOAL_ADJUST, KCAL_PER_KG, ageOf, mifflin, observedTdee, proteinBasisKg } from './nutrition.js'

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
const pct = x => Math.round(x * 100)
const r1 = x => Math.round(x * 10) / 10

export function harrisBenedict({ sex, kg, cm, age }) {
  return sex === 'female'
    ? 447.593 + 9.247 * kg + 3.098 * cm - 4.330 * age
    : 88.362 + 13.397 * kg + 4.799 * cm - 5.677 * age
}
export function katchMcArdle(kg, bf) {
  return 370 + 21.6 * kg * (1 - bf / 100)
}

/**
 * A food's label, per 100 g, checked for numbers that cannot all be true — the usual signs of a
 * mistyped label or a bad database entry. Fibre, sugar alcohols and alcohol make real labels
 * drift from 4/4/9 by a little, so only a gap of more than 20 % (and 15 kcal) counts.
 * Returns [{ id, level, msg, args }]; empty when it adds up.
 */
export function labelIssues(per100) {
  const p = num(per100?.p), c = num(per100?.c), f = num(per100?.f), kcal = num(per100?.kcal)
  const out = []
  if (p + c + f > 100.5) out.push({ id: 'grams', level: 'fail', msg: 'Protein, carbs and fat add up to {0} g in 100 g — more than the food weighs.', args: [r1(p + c + f)] })
  if (kcal > 900) out.push({ id: 'kcal-max', level: 'fail', msg: '{0} kcal per 100 g is more than pure fat has (900).', args: [Math.round(kcal)] })
  const est = 4 * p + 4 * c + 9 * f
  if ((kcal > 0 || est > 0) && Math.abs(kcal - est) > Math.max(15, 0.2 * Math.max(kcal, est))) {
    out.push({ id: 'atwater', level: 'warn', msg: 'The label says {0} kcal per 100 g, but its macros add up to about {1} kcal. Check the numbers.', args: [Math.round(kcal), Math.round(est)] })
  }
  return out
}

/**
 * Check the targets in force. Input:
 *   profile  S.nutri ({ sex, born, cm, activity, goal, bf? })
 *   kg       current body weight
 *   targets  { kcal, p, c, f } — what is actually being followed (activeTargets)
 *   today    iso date
 *   log, bodyweight, unit — for the reality check against the logs (optional)
 * Returns { level, checks: [{ id, level, msg, args }], second: { bmr, tdee, method }, observed }.
 * level is the worst of the checks.
 */
export function checkTargets({ profile, kg, targets, today, log, bodyweight, unit }) {
  const checks = []
  const add = (id, level, msg, ...args) => checks.push({ id, level, msg, args })
  const p = profile || {}
  const cm = num(p.cm), age = ageOf(p.born, today), bf = num(p.bf)

  // 1 · the inputs themselves — everything below is only as good as these
  const bad = []
  if (!(age >= 15 && age <= 90)) bad.push('age')
  if (!(cm >= 120 && cm <= 230)) bad.push('height')
  if (!(kg >= 35 && kg <= 250)) bad.push('weight')
  if (p.bf != null && p.bf !== '' && !(bf >= 3 && bf <= 60)) bad.push('body fat')
  if (bad.length) {
    add('inputs', 'fail', 'Some of your stats look wrong ({0}) — fix them before trusting any target.', bad.join(', '))
    return finish(checks, null, null)
  }
  if (!ACTIVITY[p.activity] || GOAL_ADJUST[p.goal] === undefined || !p.sex) {
    add('inputs', 'fail', 'Your stats are incomplete.')
    return finish(checks, null, null)
  }
  add('inputs', 'ok', 'Your stats are in a realistic range.')

  // 2 · a second estimate of maintenance, from a different equation
  const who = { sex: p.sex, kg, cm, age }
  const bmrA = mifflin(who)
  const useKatch = bf >= 3 && bf <= 60
  const bmrB = useKatch ? katchMcArdle(kg, bf) : harrisBenedict(who)
  const method = useKatch ? 'Katch-McArdle' : 'Harris-Benedict'
  const tdeeB = bmrB * ACTIVITY[p.activity]
  const tdee = ((bmrA + bmrB) / 2) * ACTIVITY[p.activity]
  const gap = Math.abs(bmrA - bmrB) / ((bmrA + bmrB) / 2)
  if (gap > 0.10) add('agree', 'warn', 'Two formulas disagree on your resting burn by {0}% ({1} vs {2} kcal). Double-check your body fat and stats.', pct(gap), Math.round(bmrA), Math.round(bmrB))
  else add('agree', 'ok', 'Two independent formulas agree on your maintenance: about {0} kcal a day.', Math.round(tdee / 10) * 10)

  const t = targets
  if (!t || !(num(t.kcal) > 0)) {
    add('targets', 'fail', 'There are no targets to check yet.')
    return finish(checks, { bmr: Math.round(bmrB), tdee: Math.round(tdeeB), method }, null)
  }
  const kcal = num(t.kcal), pr = num(t.p), ca = num(t.c), fa = num(t.f)

  // 3 · do the macros add up to the calories?
  const fromMacros = 4 * pr + 4 * ca + 9 * fa
  const off = Math.abs(fromMacros - kcal) / kcal
  if (off > 0.05) add('math', 'fail', 'Your macros add up to {0} kcal, not the {1} kcal target.', Math.round(fromMacros), Math.round(kcal))
  else add('math', 'ok', 'Protein, carbs and fat add up to the calorie target.')

  // 4 · pointing the right way for the goal
  const delta = (kcal - tdee) / tdee
  const goal = p.goal
  if ((goal === 'cut' || goal === 'recomp') && delta >= 0) add('direction', 'fail', 'You chose to lose fat, but {0} kcal is at or above your maintenance (~{1}).', Math.round(kcal), Math.round(tdee))
  else if (goal === 'bulk' && delta <= 0) add('direction', 'fail', 'You chose to gain, but {0} kcal is at or below your maintenance (~{1}).', Math.round(kcal), Math.round(tdee))
  else if (goal === 'maintain' && Math.abs(delta) > 0.07) add('direction', 'warn', 'You chose to maintain, but {0} kcal is {1}% away from your maintenance (~{2}).', Math.round(kcal), pct(Math.abs(delta)), Math.round(tdee))
  else add('direction', 'ok', 'The calories point the right way for your goal.')

  // 5 · size of the deficit or surplus, and 6 · the rate it implies
  const kgWeek = ((kcal - tdee) * 7) / KCAL_PER_KG
  const pctWeek = (Math.abs(kgWeek) / kg) * 100
  if (goal === 'cut' || goal === 'recomp') {
    const def = -delta
    if (def > 0.35) add('deficit', 'fail', 'A {0}% deficit is too steep: expect to lose muscle and strength along with fat.', pct(def))
    else if (def > 0.25 || (goal === 'recomp' && def > 0.15)) add('deficit', 'warn', 'A {0}% deficit is on the aggressive side for keeping muscle.', pct(def))
    else add('deficit', 'ok', 'A {0}% deficit is moderate enough to keep building muscle.', pct(Math.max(0, def)))
    if (pctWeek > 1.0) add('rate', 'warn', 'That is about {0} kg a week ({1}% of your weight) — above the 0.5–1% that protects muscle.', r1(Math.abs(kgWeek)), r1(pctWeek))
    else if (goal === 'cut' && pctWeek < 0.25) add('rate', 'info', 'That is about {0} kg a week — slow. Fine for a recomp, slow for a cut.', r1(Math.abs(kgWeek)))
    else add('rate', 'ok', 'Expected loss: about {0} kg a week ({1}% of your weight).', r1(Math.abs(kgWeek)), r1(pctWeek))
  } else if (goal === 'bulk') {
    if (delta > 0.15) add('deficit', 'warn', 'A {0}% surplus adds more fat than muscle — 5–15% is plenty.', pct(delta))
    else add('deficit', 'ok', 'A {0}% surplus is a lean bulk.', pct(delta))
  }

  // 7 · the absolute floor
  const floor = p.sex === 'female' ? 1200 : 1500
  if (kcal < floor) add('floor', 'fail', '{0} kcal is below the {1} kcal minimum generally advised without medical supervision.', Math.round(kcal), floor)
  else if (kcal < Math.min(bmrA, bmrB)) add('floor', 'warn', '{0} kcal is below your resting burn (~{1}). Hard to sustain and hard on training.', Math.round(kcal), Math.round(Math.min(bmrA, bmrB)))
  else add('floor', 'ok', 'Calories stay above your resting burn.')

  // 8 · protein — the macro that decides whether the weight lost is fat or muscle
  const basis = useKatch ? kg : proteinBasisKg(kg, cm)
  const gkg = pr / basis
  const losing = goal === 'cut' || goal === 'recomp'
  if (gkg < 1.6) add('protein', 'warn', 'Protein is {0} g/kg — below the 1.6 g/kg minimum for building muscle.', r1(gkg))
  else if (losing && gkg < 1.8) add('protein', 'warn', 'Protein is {0} g/kg — on the low side while in a deficit; 2.0–2.4 g/kg protects muscle better.', r1(gkg))
  else if (gkg > 3.3) add('protein', 'warn', 'Protein is {0} g/kg — more than any study finds useful; those calories would serve training better as carbs.', r1(gkg))
  else if (losing) add('protein', 'ok', 'Protein is {0} g/kg — right for keeping and building muscle in a deficit.', r1(gkg))
  else add('protein', 'ok', 'Protein is {0} g/kg — right for building muscle.', r1(gkg))

  // 9 · fat
  const fkg = fa / kg, fshare = (9 * fa) / kcal
  if (fkg < 0.5 || fshare < 0.2) add('fat', 'warn', 'Fat is {0} g/kg ({1}% of calories) — low enough to affect hormones. Aim for at least 0.6 g/kg and 20%.', r1(fkg), pct(fshare))
  else add('fat', 'ok', 'Fat is {0}% of calories — a healthy amount.', pct(fshare))

  // 10 · carbs — not essential, but they fuel hard sets
  const ckg = ca / kg
  if (ckg < 1.5) add('carbs', 'info', 'Carbs are {0} g/kg — on the low side for hard training; expect heavier sessions to feel it.', r1(ckg))
  else add('carbs', 'ok', 'Carbs are {0} g/kg — enough to fuel your training.', r1(ckg))

  // 11 · the reality check: what the logs say, once there are enough of them
  const obs = log && bodyweight ? observedTdee(log, bodyweight, unit, today) : null
  if (obs) {
    const diff = (obs.tdee - tdee) / tdee
    if (Math.abs(diff) > 0.15) add('observed', 'warn', 'Your last {0} logged days say you actually burn about {1} kcal a day, not ~{2}. Consider moving your target by {3} kcal.', obs.loggedDays, Math.round(obs.tdee / 10) * 10, Math.round(tdee / 10) * 10, Math.round((obs.tdee - tdee) / 10) * 10)
    else add('observed', 'ok', 'Your logs confirm it: you burn about {0} kcal a day, close to the estimate.', Math.round(obs.tdee / 10) * 10)
    if (losing && obs.kgPerWeek < 0 && (-obs.kgPerWeek / kg) * 100 > 1.0) add('observed-rate', 'warn', 'You are losing {0} kg a week — faster than 1% of your weight. Eat a little more to keep muscle.', r1(-obs.kgPerWeek))
  } else {
    add('observed', 'info', 'After 2–3 weeks of logging food and weigh-ins, this check also compares the numbers against your real results.')
  }

  return finish(checks, { bmr: Math.round(bmrB), tdee: Math.round(tdeeB), method }, obs)
}

const RANK = { ok: 0, info: 1, warn: 2, fail: 3 }
function finish(checks, second, observed) {
  const level = checks.reduce((w, c) => (RANK[c.level] > RANK[w] ? c.level : w), 'ok')
  return { level, checks, second, observed }
}
