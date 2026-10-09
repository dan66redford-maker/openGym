import { describe, expect, it, vi } from 'vitest'
import { cleanBarcode, lookupBarcode, parseProduct } from './off.js'

// Trimmed from a real Open Food Facts v2 response.
const NUTELLA = {
  code: '3017620422003', status: 1,
  product: {
    code: '3017620422003', product_name: 'Nutella', brands: 'Nutella,Ferrero', serving_size: '15 g', serving_quantity: 15,
    nutriments: { 'energy-kcal_100g': 539, 'energy-kj_100g': 2252, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
  },
}
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

describe('parseProduct', () => {
  it('turns a product into a food per 100 g with its serving', () => {
    expect(parseProduct(NUTELLA)).toEqual({
      name: 'Nutella', brand: 'Nutella', barcode: '3017620422003',
      per100: { kcal: 539, p: 6.3, c: 57.5, f: 30.9 }, serving: { g: 15, label: '15 g' },
    })
  })
  it('falls back to kJ when there is no kcal, and to the brand for a missing name', () => {
    const food = parseProduct({ status: 1, product: { brands: 'Acme', nutriments: { 'energy-kj_100g': 1674, proteins_100g: '10,5', carbohydrates_100g: 50, fat_100g: 5 } } }, '5901234123457')
    expect(food.per100).toEqual({ kcal: 400, p: 10.5, c: 50, f: 5 })
    expect(food.name).toBe('Acme')
    expect(food.barcode).toBe('5901234123457')
    expect(food.serving).toBeNull()
  })
  it('keeps fiber and sugar when the product lists them', () => {
    const food = parseProduct({ status: 1, product: { product_name: 'Oats', nutriments: { 'energy-kcal_100g': 379, proteins_100g: 13.2, carbohydrates_100g: 67.7, fat_100g: 6.5, fiber_100g: 10.1, sugars_100g: 1 } } })
    expect(food.per100).toEqual({ kcal: 379, p: 13.2, c: 67.7, f: 6.5, fib: 10.1, sug: 1 })
  })
  it('knows an unknown product and one with no nutrition facts', () => {
    expect(parseProduct({ status: 0, status_verbose: 'product not found' })).toBeNull()
    expect(parseProduct({ status: 1, product: { product_name: 'Water', nutriments: {} } })).toBeNull()
  })
})

describe('cleanBarcode', () => {
  it('keeps only real barcode lengths', () => {
    expect(cleanBarcode(' 3017620 422003 ')).toBe('3017620422003')
    expect(cleanBarcode('96385074')).toBe('96385074')
    expect(cleanBarcode('12345')).toBeNull()
  })
})

describe('lookupBarcode', () => {
  it('asks Open Food Facts for that one barcode', async () => {
    const fetch = vi.fn(async () => res(200, NUTELLA))
    expect((await lookupBarcode('3017620422003', fetch)).name).toBe('Nutella')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017620422003\.json\?fields=/)
  })
  it('tries the 12-digit UPC when the 13-digit form is unknown', async () => {
    const fetch = vi.fn(async url => (url.includes('/0036000291452.') ? res(404, { status: 0 }) : res(200, { status: 1, product: { code: '036000291452', product_name: 'Tissues', nutriments: { 'energy-kcal_100g': 0, proteins_100g: 0 } } })))
    expect((await lookupBarcode('0036000291452', fetch)).name).toBe('Tissues')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('resolves null for an unknown product and rejects when offline', async () => {
    expect(await lookupBarcode('5901234123457', async () => res(404, { status: 0 }))).toBeNull()
    await expect(lookupBarcode('5901234123457', async () => { throw new TypeError('Failed to fetch') })).rejects.toThrow()
    const never = vi.fn()
    expect(await lookupBarcode('abc', never)).toBeNull()
    expect(never).not.toHaveBeenCalled()
  })
})
