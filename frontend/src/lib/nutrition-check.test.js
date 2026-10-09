import { describe, expect, it } from 'vitest'
import { calcTargets, shiftISO } from './nutrition.js'
import { checkTargets, harrisBenedict, katchMcArdle, labelIssues } from './nutrition-check.js'

const TODAY = '2026-10-08'
const ME = { sex: 'male', born: 1996, cm: 180, activity: 'moderate', goal: 'cut' }
const run = (targets, profile = ME, kg = 85, extra = {}) => checkTargets({ profile, kg, targets, today: TODAY, ...extra })
const byId = (res, id) => res.checks.find(c => c.id === id)

describe('the second equations', () => {
  it('match their published forms', () => {
    // 88.362 + 13.397·85 + 4.799·180 − 5.677·30
    expect(harrisBenedict({ sex: 'male', kg: 85, cm: 180, age: 30 })).toBeCloseTo(1920.6, 1)
    // 370 + 21.6 · (85 · 0.85)
    expect(katchMcArdle(85, 15)).toBeCloseTo(1930.6, 1)
  })
})

describe('checkTargets', () => {
  it('passes the calculated targets for a cut with nothing worse than a note', () => {
    const res = run(calcTargets(ME, 85, TODAY))
    expect(res.checks.filter(c => c.level === 'warn' || c.level === 'fail')).toEqual([])
    expect(res.level).toBe('info')                       // only "log for 2–3 weeks to verify"
    expect(byId(res, 'agree').level).toBe('ok')
    expect(byId(res, 'rate').args).toEqual([0.6, 'kg', 0.7])   // ≈0.58 kg/week, 0.7 % of body weight
    expect(res.second.method).toBe('Harris-Benedict')
  })
  it('speaks pounds and grams per pound to a profile in pounds', () => {
    const res = run(calcTargets(ME, 85, TODAY), ME, 85, { unit: 'lb' })
    expect(byId(res, 'rate').args).toEqual([1.3, 'lb', 0.7])       // 0.58 kg ≈ 1.3 lb a week
    expect(byId(res, 'protein').args).toEqual([0.99, 'lb'])        // 185 g at 187 lb ≈ 1 g/lb
    expect(byId(run({ kcal: 2270, p: 110, c: 365, f: 65 }, ME, 85, { unit: 'lb' }), 'protein').args).toEqual([0.59, 'lb', 0.73])
  })
  it('the calculated targets pass for every goal and a range of people', () => {
    for (const goal of ['cut', 'recomp', 'maintain', 'bulk']) {
      for (const [sex, kg, cm, born] of [['male', 70, 175, 2000], ['female', 62, 165, 1990], ['male', 100, 190, 1980], ['female', 80, 170, 1975]]) {
        const p = { sex, born, cm, activity: 'moderate', goal }
        const res = run(calcTargets(p, kg, TODAY), p, kg)
        expect(res.checks.filter(c => c.level === 'fail'), `${goal} ${sex} ${kg}`).toEqual([])
      }
    }
  })
  it('catches macros that do not add up to the calories', () => {
    expect(byId(run({ kcal: 2000, p: 100, c: 100, f: 50 }), 'math').level).toBe('fail')
  })
  it('stops a crash diet', () => {
    const res = run({ kcal: 1300, p: 150, c: 100, f: 33 })
    expect(res.level).toBe('fail')
    expect(byId(res, 'floor').level).toBe('fail')
    expect(byId(res, 'deficit').level).toBe('fail')
    expect(byId(res, 'rate').level).toBe('warn')
  })
  it('flags protein too low to build muscle on a cut', () => {
    expect(byId(run({ kcal: 2270, p: 110, c: 365, f: 65 }), 'protein').level).toBe('warn')   // 1.3 g/kg
    expect(byId(run({ kcal: 2270, p: 145, c: 330, f: 65 }), 'protein').level).toBe('warn')   // 1.7 g/kg
  })
  it('flags fat low enough to matter', () => {
    expect(byId(run({ kcal: 2270, p: 190, c: 340, f: 30 }), 'fat').level).toBe('warn')
  })
  it('notices calories pointing the wrong way for the goal', () => {
    expect(byId(run({ kcal: 3300, p: 185, c: 440, f: 90 }), 'direction').level).toBe('fail')
    expect(byId(run({ kcal: 2200, p: 185, c: 225, f: 65 }, { ...ME, goal: 'bulk' }), 'direction').level).toBe('fail')
  })
  it('refuses to judge from impossible stats', () => {
    const res = run(calcTargets(ME, 85, TODAY), { ...ME, cm: 300 })
    expect(res.level).toBe('fail')
    expect(res.checks).toHaveLength(1)
    expect(res.checks[0].args[0]).toContain('height')
  })
  it('warns when the two equations disagree — here, a body-fat figure at odds with the rest', () => {
    const res = run(calcTargets({ ...ME, bf: 40 }, 85, TODAY), { ...ME, bf: 40 })
    expect(res.second.method).toBe('Katch-McArdle')
    expect(byId(res, 'agree').level).toBe('warn')
  })
  it('compares against what the logs say once there are enough of them', () => {
    // Three weeks eating 2270 and the weight did not move: maintenance is ~2270, not ~2900.
    const log = [], bw = []
    for (let i = 1; i <= 21; i++) { log.push({ d: shiftISO(TODAY, -i), kcal: 2270 }); if (i % 2) bw.push({ d: shiftISO(TODAY, -i), w: 85 }) }
    const res = run(calcTargets(ME, 85, TODAY), ME, 85, { log, bodyweight: bw, unit: 'kg' })
    const obs = byId(res, 'observed')
    expect(obs.level).toBe('warn')
    expect(obs.args[1]).toBe(2270)
    expect(res.observed.tdee).toBe(2270)
  })
})

describe('labelIssues', () => {
  it('accepts a real label', () => {
    expect(labelIssues({ kcal: 165, p: 31, c: 0, f: 3.6 })).toEqual([])          // chicken breast
    expect(labelIssues({ kcal: 539, p: 6.3, c: 57.5, f: 30.9 })).toEqual([])     // hazelnut spread
  })
  it('catches numbers that cannot all be true', () => {
    expect(labelIssues({ kcal: 50, p: 20, c: 20, f: 10 }).map(i => i.id)).toEqual(['atwater'])
    expect(labelIssues({ kcal: 400, p: 60, c: 40, f: 10 }).map(i => i.id)).toEqual(['grams'])
    expect(labelIssues({ kcal: 1200, p: 0, c: 0, f: 100 }).map(i => i.id)).toContain('kcal-max')
  })
})
