// Open Food Facts — the free, open food database (openfoodfacts.org, data under the ODbL).
// The one thing the nutrition tracker ever sends off the device: a scanned barcode, to look up
// what is in the product. No account, no key, nothing else about you goes with it. A food found
// once is saved with its barcode (S.foods), so scanning it again never asks the network.
//
// parseProduct is the pure part — the API's JSON in, one of our foods out — and is what the unit
// test exercises; lookupBarcode wraps it with the fetch.

const API = 'https://world.openfoodfacts.org/api/v2/product/'
const FIELDS = 'code,product_name,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity,quantity'

const num = v => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const r1 = n => Math.round(n * 10) / 10

// Only digits, and only the lengths a product barcode has (EAN-8, UPC-A, EAN-13, GTIN-14).
export function cleanBarcode(s) {
  const d = String(s || '').replace(/\D/g, '')
  return [8, 12, 13, 14].includes(d.length) ? d : null
}

/**
 * One API response → { name, brand, barcode, per100: { kcal, p, c, f }, serving: { g, label } | null }
 * or null when the product is unknown or has no usable nutrition facts. Energy falls back from
 * kcal to kJ (÷ 4.184) because plenty of European entries only carry the latter.
 */
export function parseProduct(json, code) {
  if (!json || json.status === 0 || json.status === 'failure' || !json.product) return null
  const pr = json.product
  const n = pr.nutriments || {}
  let kcal = num(n['energy-kcal_100g'])
  if (kcal == null) {
    const kj = num(n['energy-kj_100g']) ?? num(n.energy_100g)
    if (kj != null) kcal = kj / 4.184
  }
  const p = num(n.proteins_100g), c = num(n.carbohydrates_100g), f = num(n.fat_100g)
  if (kcal == null && p == null && c == null && f == null) return null
  const name = String(pr.product_name || pr.product_name_en || pr.generic_name || '').trim()
  const brand = String(pr.brands || '').split(',')[0].trim()
  const sg = num(pr.serving_quantity)
  return {
    name: name || (brand ? brand : 'Product ' + (pr.code || code || '')),
    brand: brand || undefined,
    barcode: cleanBarcode(pr.code || code) || String(code || ''),
    per100: { kcal: Math.round(kcal ?? 0), p: r1(p ?? 0), c: r1(c ?? 0), f: r1(f ?? 0) },
    serving: sg > 0 ? { g: r1(sg), label: String(pr.serving_size || '').trim() || undefined } : null,
  }
}

/**
 * Look a barcode up. Resolves to a parsed food, or null when Open Food Facts does not know it.
 * Rejects on a network failure, so the screen can tell "not found" from "offline".
 * A 13-digit code with a leading 0 is a UPC-A written as an EAN; when the 13-digit form is not
 * found, the 12-digit one is tried as well.
 */
export async function lookupBarcode(code, fetchFn = globalThis.fetch) {
  const c = cleanBarcode(code)
  if (!c) return null
  const tries = c.length === 13 && c[0] === '0' ? [c, c.slice(1)] : [c]
  for (const k of tries) {
    const res = await fetchFn(API + k + '.json?fields=' + FIELDS, { headers: { Accept: 'application/json' } })
    if (res.status === 404) continue
    if (!res.ok) throw new Error('Open Food Facts answered ' + res.status)
    const food = parseProduct(await res.json(), k)
    if (food) return food
  }
  return null
}
