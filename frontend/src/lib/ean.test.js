import { describe, expect, it } from 'vitest'
import { decodeImageData, decodeLuma, ean13Valid, ean8Valid, encodeModules } from './ean.js'

// A barcode photographed, roughly: modules scaled to a non-integer pixel width, a quiet zone,
// optional blur (box filter), sensor noise, a light gradient across the frame and reduced contrast.
// Deterministic noise so a failure reproduces.
function render(code, { px = 3.3, h = 90, blur = 0, noise = 0, gradient = 0, lo = 20, hi = 235, pad = 40, flip = false, rotate = false, seed = 7 } = {}) {
  const mods = encodeModules(code)
  const w = Math.ceil(mods.length * px) + 2 * pad
  let row = new Float32Array(w).fill(hi)
  for (let x = 0; x < w; x++) {
    const m = Math.floor((x - pad) / px)
    if (m >= 0 && m < mods.length && mods[m]) row[x] = lo
  }
  for (let pass = 0; pass < blur; pass++) {
    const out = new Float32Array(w)
    for (let x = 0; x < w; x++) out[x] = (row[Math.max(0, x - 1)] + row[x] + row[Math.min(w - 1, x + 1)]) / 3
    row = out
  }
  if (flip) row.reverse()
  let s = seed
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const H = h + 40
  const luma = new Uint8Array(w * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
    const inCode = y >= 20 && y < 20 + h
    let v = inCode ? row[x] : hi
    v += gradient * (x / w - 0.5) + noise * (rnd() - 0.5) * 2
    luma[y * w + x] = Math.max(0, Math.min(255, Math.round(v)))
  }
  if (!rotate) return { luma, width: w, height: H }
  const t = new Uint8Array(w * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) t[x * H + y] = luma[y * w + x]
  return { luma: t, width: H, height: w }
}
const read = (code, opts) => { const im = render(code, opts); return decodeLuma(im.luma, im.width, im.height) }

describe('check digits', () => {
  it('accepts real codes and refuses a changed digit', () => {
    expect(ean13Valid('4006381333931')).toBe(true)
    expect(ean13Valid('4006381333932')).toBe(false)
    expect(ean13Valid('0036000291452')).toBe(true)   // UPC-A 036000291452
    expect(ean8Valid('96385074')).toBe(true)
    expect(ean8Valid('96385075')).toBe(false)
  })
  it('encodes to the standard module counts', () => {
    expect(encodeModules('4006381333931')).toHaveLength(95)
    expect(encodeModules('96385074')).toHaveLength(67)
  })
})

describe('decodeLuma', () => {
  const codes = ['4006381333931', '5901234123457', '0036000291452', '3017620422003', '7622210449283']
  it.each(codes)('reads %s from a clean image', code => {
    expect(read(code)).toBe(code)
  })
  it('reads EAN-8', () => {
    expect(read('96385074')).toBe('96385074')
  })
  it('reads through blur, noise, a light gradient and low contrast', () => {
    expect(read('4006381333931', { blur: 2, noise: 18, gradient: 60, lo: 60, hi: 200 })).toBe('4006381333931')
    expect(read('5901234123457', { px: 2.2, blur: 1, noise: 10 })).toBe('5901234123457')
    expect(read('0036000291452', { px: 5.7, blur: 3, noise: 15, gradient: -50 })).toBe('0036000291452')
  })
  it('reads a code upside down and one held sideways', () => {
    expect(read('4006381333931', { flip: true })).toBe('4006381333931')
    expect(read('5901234123457', { rotate: true, blur: 1, noise: 8 })).toBe('5901234123457')
  })
  it('never reads a wrong code: 60 random barcodes, distorted, decode to themselves or to nothing', () => {
    let s = 11
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
    let read13 = 0
    for (let n = 0; n < 60; n++) {
      let body = ''
      for (let k = 0; k < 12; k++) body += Math.floor(rnd() * 10)
      let sum = 0
      for (let k = 0; k < 12; k++) sum += Number(body[k]) * (k % 2 ? 3 : 1)
      const code = body + ((10 - (sum % 10)) % 10)
      const got = read(code, { px: 2.5 + rnd() * 3, blur: Math.floor(rnd() * 3), noise: rnd() * 20, gradient: (rnd() - 0.5) * 80, lo: 20 + rnd() * 40, hi: 190 + rnd() * 50, seed: n + 1 })
      expect([code, null]).toContain(got)
      if (got === code) read13++
    }
    expect(read13).toBeGreaterThanOrEqual(54)   // and it does read nearly all of them
  })
  it('returns null for an image with no barcode, rather than a guess', () => {
    let s = 3
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
    const w = 400, h = 200
    const luma = new Uint8Array(w * h)
    // vertical stripes of random widths: barcode-like, but no valid code
    for (let x = 0, dark = false; x < w;) { const run = 1 + Math.floor(rnd() * 9); for (let k = 0; k < run && x < w; k++, x++) for (let y = 0; y < h; y++) luma[y * w + x] = dark ? 30 : 220; dark = !dark }
    expect(decodeLuma(luma, w, h)).toBeNull()
    expect(decodeLuma(new Uint8Array(w * h).fill(128), w, h)).toBeNull()
  })
  it('decodes from RGBA ImageData too', () => {
    const im = render('4006381333931')
    const data = new Uint8ClampedArray(im.width * im.height * 4)
    for (let i = 0; i < im.luma.length; i++) { data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = im.luma[i]; data[4 * i + 3] = 255 }
    expect(decodeImageData({ data, width: im.width, height: im.height })).toBe('4006381333931')
  })
})
