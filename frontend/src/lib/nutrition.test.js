import { describe, expect, it } from 'vitest'
import { activeTargets, calcTargets, copyDay, currentWeightKg, dayTotals, entriesByMeal, entryFrom, foodList, macrosFor, missingInputs, observedTdee, shiftISO } from './nutrition.js'

const TODAY = '2026-10-08'
// 30 years old, 180 cm, 85 kg, lifting 3–5 days a week, cutting.
const ME = { sex: 'male', born: 1996, cm: 180, activity: 'moderate', goal: 'cut' }

describe('calcTargets', () => {
  it('works the numbers out by hand: Mifflin-St Jeor × activity, −20 %, protein first', () => {
    // BMR 10·85 + 6.25·180 − 5·30 + 5 = 1830; TDEE 1830 × 1.55 = 2836.5; −20 % → 2269 → 2270
    // protein 2.2 g/kg → 187 → 185; fat max(0.6·85, 25 % of 2270 / 9 = 63) → 65; carbs the rest
    expect(calcTargets(ME, 85, TODAY)).toEqual({ bmr: 1830, tdee: 2837, kcal: 2270, p: 185, c: 235, f: 65 })
  })
  it('macros add up to the calories within rounding', () => {
    for (const goal of ['cut', 'recomp', 'maintain', 'bulk']) for (const kg of [55, 70, 85, 110]) {
      const tg = calcTargets({ ...ME, goal }, kg, TODAY)
      expect(Math.abs(4 * tg.p + 4 * tg.c + 9 * tg.f - tg.kcal)).toBeLessThanOrEqual(35)
    }
  })
  it('the goal moves calories the right way', () => {
    const at = goal => calcTargets({ ...ME, goal }, 85, TODAY).kcal
    expect(at('cut')).toBeLessThan(at('recomp'))
    expect(at('recomp')).toBeLessThan(at('maintain'))
    expect(at('maintain')).toBeLessThan(at('bulk'))
  })
  it('sizes protein on lean mass when body fat is known, and caps it on a heavy frame when not', () => {
    expect(calcTargets({ ...ME, bf: 15 }, 85, TODAY).p).toBe(190)     // 2.6 × 72.25 kg FFM = 187.9
    expect(calcTargets(ME, 130, TODAY).p).toBe(190)                    // 2.2 × (BMI-27 weight 87.5 kg)
  })
  it('waits for every input', () => {
    expect(calcTargets({ ...ME, cm: null }, 85, TODAY)).toBeNull()
    expect(calcTargets(ME, null, TODAY)).toBeNull()
    expect(missingInputs({}, null)).toEqual(['sex', 'born', 'cm', 'activity', 'goal', 'weight'])
  })
})

describe('activeTargets', () => {
  it('prefers numbers typed in by hand', () => {
    expect(activeTargets({ ...ME, custom: { kcal: 2100, p: 180, c: 200, f: 60 } }, 85, TODAY)).toEqual({ kcal: 2100, p: 180, c: 200, f: 60, custom: true })
    expect(activeTargets(ME, 85, TODAY)).toMatchObject({ kcal: 2270, custom: false })
  })
})

describe('currentWeightKg', () => {
  it('averages the last seven days, converting pounds', () => {
    const bw = [{ d: '2026-09-20', w: 90 }, { d: '2026-10-03', w: 86 }, { d: '2026-10-06', w: 85 }, { d: '2026-10-08', w: 84 }]
    expect(currentWeightKg(bw, 'kg', TODAY)).toBe(85)
    expect(currentWeightKg([{ d: '2026-10-08', w: 200 }], 'lb', TODAY)).toBeCloseTo(90.718, 2)
  })
  it('falls back to the latest weigh-in, and ignores ones after today', () => {
    expect(currentWeightKg([{ d: '2026-09-01', w: 88 }, { d: '2026-09-10', w: 87 }, { d: '2026-10-20', w: 70 }], 'kg', TODAY)).toBe(87)
    expect(currentWeightKg([], 'kg', TODAY)).toBeNull()
  })
})

describe('the food log', () => {
  const oats = { id: 'oats', name: 'Oats', per100: { kcal: 379, p: 13.2, c: 67.7, f: 6.5 } }
  const whey = { id: 'whey', name: 'Whey', brand: 'Acme', barcode: '4006381333931', per100: { kcal: 400, p: 80, c: 8, f: 6 } }

  it('scales a food to the amount eaten and keeps the numbers on the entry', () => {
    expect(macrosFor(oats, 50)).toEqual({ kcal: 189.5, p: 6.6, c: 33.85, f: 3.25 })
    expect(entryFrom(oats, 50, { d: TODAY, meal: 'breakfast', id: 'e1' }))
      .toEqual({ id: 'e1', d: TODAY, meal: 'breakfast', foodId: 'oats', name: 'Oats', brand: undefined, g: 50, kcal: 190, p: 6.6, c: 33.9, f: 3.3 })
  })
  it('adds a day up and groups it by meal', () => {
    const log = [
      entryFrom(oats, 80, { d: TODAY, meal: 'breakfast', id: 'a' }),
      entryFrom(whey, 30, { d: TODAY, meal: 'snack', id: 'b' }),
      { id: 'c', d: TODAY, meal: 'dinner', name: 'Quick add', kcal: 600, p: 40, c: 50, f: 20 },
      entryFrom(oats, 80, { d: '2026-10-07', meal: 'breakfast', id: 'd' }),
    ]
    expect(dayTotals(log, TODAY)).toEqual({ kcal: 1023, p: 74.6, c: 106.6, f: 27, n: 3 })
    const by = entriesByMeal(log, TODAY)
    expect(by.breakfast.map(e => e.id)).toEqual(['a'])
    expect(by.lunch).toEqual([])
    expect(by.dinner.map(e => e.id)).toEqual(['c'])
  })
  it('lists foods most recently eaten first and searches name, brand and barcode', () => {
    const rice = { id: 'rice', name: 'Rice', per100: {} }
    const log = [{ foodId: 'oats', d: '2026-10-01' }, { foodId: 'whey', d: '2026-10-07' }]
    expect(foodList([rice, oats, whey], log).map(f => f.id)).toEqual(['whey', 'oats', 'rice'])
    expect(foodList([rice, oats, whey], log, 'acme').map(f => f.id)).toEqual(['whey'])
    expect(foodList([rice, oats, whey], log, '400638').map(f => f.id)).toEqual(['whey'])
  })
  it('copies a day under new ids', () => {
    let n = 0
    const copied = copyDay([{ id: 'a', d: '2026-10-07', meal: 'lunch', kcal: 500 }, { id: 'b', d: '2026-10-06' }], '2026-10-07', TODAY, () => 'new' + ++n)
    expect(copied).toEqual([{ id: 'new1', d: TODAY, meal: 'lunch', kcal: 500 }])
  })
})

describe('observedTdee', () => {
  // 21 days eating 2400 kcal while losing 0.5 kg a week: 0.5 × 7700 / 7 = 550 kcal a day of
  // deficit, so this body burns about 2950.
  const log = [], bw = []
  for (let i = 1; i <= 21; i++) {
    const d = shiftISO(TODAY, -i)
    log.push({ d, kcal: 1400 }, { d, kcal: 1000 })
    if (i % 3 === 0) bw.push({ d, w: 85 + (0.5 / 7) * i })
  }
  it('reads maintenance from intake and the weight trend', () => {
    const o = observedTdee(log, bw, 'kg', TODAY)
    expect(o.intake).toBe(2400)
    expect(o.kgPerWeek).toBeCloseTo(-0.5, 5)
    expect(o.tdee).toBe(2950)
    expect(o.loggedDays).toBe(21)
  })
  it('says nothing from too little data', () => {
    expect(observedTdee(log.slice(0, 10), bw, 'kg', TODAY)).toBeNull()        // 5 days logged
    expect(observedTdee(log, bw.slice(0, 2), 'kg', TODAY)).toBeNull()         // 2 weigh-ins
  })
})
