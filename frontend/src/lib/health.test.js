import { describe, expect, it } from 'vitest'
import { fibreSugarTargets, foodForHealth, habitChecks, mergeHealthDay, numberIn, parseHealthText, weekSummary } from './health.js'
import { shiftISO } from './nutrition.js'

const TODAY = '2026-10-09'

describe('numberIn', () => {
  it('reads numbers the way Shortcuts writes them', () => {
    expect(numberIn('8,123 steps')).toBe(8123)
    expect(numberIn('12,345,678')).toBe(12345678)
    expect(numberIn('7.25')).toBe(7.25)
    expect(numberIn('7,2 h')).toBe(7.2)
    expect(numberIn('58 bpm')).toBe(58)
    expect(numberIn('none')).toBeNull()
  })
})

describe('parseHealthText', () => {
  const p = (text, unit = 'lb') => parseHealthText(text, { today: TODAY, unit })

  it('reads a typical Shortcut paste, units and all', () => {
    const r = p('openGym\nSteps: 8,123\nExercise: 42 min\nActive Energy: 512 kcal\nSleep: 7 hr 12 min\nResting Heart Rate: 58 bpm\nWeight: 185.6 lb')
    expect(r).toEqual({ d: TODAY, values: { steps: 8123, exMin: 42, active: 512, sleep: 7.2, rhr: 58 }, weight: 185.6, dropped: [], ok: true })
  })
  it('converts weight to the profile unit and glucose to mg/dL', () => {
    expect(p('weight: 84.2 kg').weight).toBe(185.6)
    expect(p('weight: 84.2 kg', 'kg').weight).toBe(84.2)
    expect(p('weight: 84.2', 'kg').weight).toBe(84.2)        // no unit: the profile's
    expect(p('glucose: 5.4 mmol/L').values.glu).toBe(97)
    expect(p('blood glucose: 5.4').values.glu).toBe(97)       // no unit, too low for mg/dL
    expect(p('blood glucose: 104 mg/dL').values.glu).toBe(104)
  })
  it('reads durations in any shape', () => {
    expect(p('sleep: 7:30').values.sleep).toBe(7.5)
    expect(p('sleep: 450').values.sleep).toBe(7.5)            // minutes
    expect(p('sleep: 27000').values.sleep).toBe(7.5)          // seconds
    expect(p('exercise: 1 hr 5 min').values.exMin).toBe(65)
    expect(p('active: 2000 kJ').values.active).toBe(478)
  })
  it('takes the day from the text', () => {
    expect(p('date: yesterday\nsteps: 100').d).toBe('2026-10-08')
    expect(p('date: 2026-10-01\nsteps: 100').d).toBe('2026-10-01')
    expect(p('day=Oct 3, 2026; steps=100').d).toBe('2026-10-03')
  })
  it('drops impossible values and says which', () => {
    const r = p('steps: 8000\nresting heart rate: 900\nweight: 3')
    expect(r.values).toEqual({ steps: 8000 })
    expect(r.dropped).toEqual(['rhr', 'weight'])
  })
  it('does not take random clipboard text for health data', () => {
    expect(p('Hey, are we still on for lunch? 12:30').ok).toBe(false)
    expect(p('').ok).toBe(false)
  })
  it('merges into the day, keeping what this paste did not have', () => {
    expect(mergeHealthDay({ [TODAY]: { steps: 4000, sleep: 7 } }, TODAY, { steps: 9000 })).toEqual({ [TODAY]: { steps: 9000, sleep: 7 } })
  })
})

describe('foodForHealth', () => {
  it('is the JSON the send-to-Health Shortcut reads', () => {
    expect(JSON.parse(foodForHealth({ kcal: 2210.4, p: 180.04, c: 200, f: 60, fib: 31.26, sug: 40 }, TODAY)))
      .toEqual({ date: TODAY, kcal: 2210, protein: 180, carbs: 200, fat: 60, fiber: 31.3, sugar: 40 })
  })
})

// A week: steps, sleep and exercise from Apple Health, two lifting sessions, five days of food.
function week({ steps = 8000, sleep = 7.5, exMin = 25, lifts = 2, fib = 32, sug = 40, start = 200, now = 188 } = {}) {
  const health = {}, workouts = [], foodLog = [], bodyweight = [{ d: '2026-08-01', w: start }]
  for (let i = 0; i < 7; i++) {
    const d = shiftISO(TODAY, -i)
    health[d] = { steps: i === 0 ? 1000 : steps, sleep, exMin }
    if (i >= 1 && i <= 5) foodLog.push({ d, kcal: 2200, fib, sug })
  }
  for (let i = 0; i < lifts; i++) workouts.push({ d: shiftISO(TODAY, -1 - 2 * i), start: 0, end: 60 * 60000 })
  bodyweight.push({ d: shiftISO(TODAY, -2), w: now })
  return { health, workouts, foodLog, bodyweight, nutri: { goal: 'cut' } }
}
const level = (checks, id) => checks.find(c => c.id === id)?.level

describe('weekSummary', () => {
  it('reads the week back', () => {
    const s = weekSummary(week(), TODAY)
    expect(s.steps).toBe(8000)                 // today's half-day left out of the average
    expect(s.exMin).toBe(175)                  // 7 × 25, Apple Health's count
    expect(s.exMinWorkouts).toBe(120)
    expect(s.strengthDays).toBe(2)
    expect(s.sleep).toBe(7.5)
    expect(s.foodDays).toBe(5)
    expect(s.fib).toBe(32)
    expect(s.lostPct).toBe(6)                  // 200 → 188
  })
  it('does not judge fiber when most foods do not list it', () => {
    const S = week(); S.foodLog = S.foodLog.map((e, i) => (i ? { d: e.d, kcal: e.kcal } : e))
    expect(weekSummary(S, TODAY).fib).toBeNull()
  })
  it('uses the start weight from the profile when set', () => {
    const S = week(); S.nutri.startW = 194
    expect(weekSummary(S, TODAY).lostPct).toBeCloseTo(3.09, 2)
  })
})

describe('habitChecks', () => {
  const ctx = { kcal: 2270, goal: 'cut', age: 30, bmi: 26 }
  it('passes a good week', () => {
    const c = habitChecks(weekSummary(week(), TODAY), ctx)
    for (const id of ['activity', 'strength', 'steps', 'sleep', 'fiber', 'sugar', 'weight']) expect(level(c, id), id).toBe('ok')
    expect(level(c, 'checkup')).toBe('info')
    expect(c.find(x => x.id === 'glucose')).toBeUndefined()
  })
  it('flags the habits that slip', () => {
    const c = habitChecks(weekSummary(week({ steps: 4000, sleep: 6, exMin: 10, lifts: 1, fib: 15, sug: 90, now: 201 }), TODAY), ctx)
    for (const id of ['activity', 'strength', 'steps', 'sleep', 'fiber', 'sugar', 'weight']) expect(level(c, id), id).toBe('warn')
    expect(c.find(x => x.id === 'activity').args).toEqual([70, 80])
  })
  it('counts logged workouts as exercise only without Apple Health', () => {
    const S = week({ lifts: 3 }); for (const d in S.health) delete S.health[d].exMin
    const c = habitChecks(weekSummary(S, TODAY), ctx)
    expect(c.find(x => x.id === 'activity').args[0]).toBe(180)
  })
  it('mixes the two day by day: Health where it has a count, the logged workout where not', () => {
    const S = week({ lifts: 3 })                      // workouts 1, 3 and 5 days ago, 60 min each
    for (const d in S.health) delete S.health[d].exMin
    S.health[TODAY].exMin = 48                         // only today came from Apple Health
    S.health[shiftISO(TODAY, -1)].exMin = 70           // and yesterday, which also had a workout
    expect(weekSummary(S, TODAY).exMin).toBe(48 + 70 + 60 + 60)
  })
  it('reads blood sugar against the ADA fasting ranges', () => {
    const at = v => { const S = week(); S.health[TODAY].glu = v; return level(habitChecks(weekSummary(S, TODAY), ctx), 'glucose') }
    expect(at(92)).toBe('ok')
    expect(at(110)).toBe('warn')
    expect(at(140)).toBe('fail')
  })
  it('says how to start when there is no data yet', () => {
    const c = habitChecks(weekSummary({}, TODAY), ctx)
    expect(level(c, 'steps')).toBe('none')
    expect(level(c, 'activity')).toBe('none')
    expect(level(c, 'fiber')).toBe('none')
  })
  it('sizes fiber and sugar to the calories', () => {
    expect(fibreSugarTargets(2270)).toEqual({ fib: 32, sug: 57 })
    expect(fibreSugarTargets()).toEqual({ fib: 28, sug: 50 })
  })
})
