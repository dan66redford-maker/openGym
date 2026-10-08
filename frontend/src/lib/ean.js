// Product barcodes (EAN-13, UPC-A, EAN-8) read from camera pixels, in plain JS.
//
// Why our own: iOS Safari has no BarcodeDetector, jsQR (lib/scan-web.js) reads QR codes only,
// and a barcode library is a dependency this project does not take on lightly. A 1-D barcode is
// a much simpler thing than a QR code — one line across it holds the whole message — so this is
// a scan-line decoder:
//
//   1. take a handful of horizontal lines through the frame (and vertical ones, for a box held
//      sideways), each averaged over 3 pixel rows against sensor noise;
//   2. binarise each line against a local mean, clamped to the line's own contrast so the white
//      quiet zone stays white;
//   3. run-length encode it and look for start guard · 6 digits · centre guard · 6 digits · end
//      guard (4 + 4 for EAN-8), each digit being 4 runs that span 7 modules;
//   4. accept only a code whose check digit is right AND that two separate lines agree on —
//      a misread is far worse than a second's more scanning.
//
// UPC-A is EAN-13 with a leading 0 and comes back as 13 digits; lib/off.js tries both forms.

// Run widths, in modules, of each digit's L code (space, bar, space, bar). R codes have the same
// widths with the colours swapped; G codes are the L widths reversed.
const L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map(s => [...s].map(Number))
const G = L.map(w => [...w].reverse())
// Parity of the six left-hand digits (L/G) encodes EAN-13's first digit.
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

const MAX_DIGIT_ERR = 1.6   // summed |width − pattern| in modules over a digit's 4 runs

// Best match of 4 runs among `tables` ({ name: widths[] }) → { d, set, err } or null.
function matchDigit(w, tables) {
  const unit = (w[0] + w[1] + w[2] + w[3]) / 7
  const all = []
  for (const [set, table] of tables) {
    for (let d = 0; d < 10; d++) {
      const p = table[d]
      all.push({ d, set, err: Math.abs(w[0] / unit - p[0]) + Math.abs(w[1] / unit - p[1]) + Math.abs(w[2] / unit - p[2]) + Math.abs(w[3] / unit - p[3]) })
    }
  }
  all.sort((a, b) => a.err - b.err)
  const [best, second] = all
  // Too far from every pattern, or too close a call between two.
  if (best.err > MAX_DIGIT_ERR || second.err - best.err < 0.15) return null
  return best
}

const near = (w, m, tol = 0.6) => Math.abs(w / m - 1) <= tol

export function ean13Valid(code) {
  if (!/^\d{13}$/.test(code)) return false
  let s = 0
  for (let i = 0; i < 12; i++) s += Number(code[i]) * (i % 2 ? 3 : 1)
  return (10 - (s % 10)) % 10 === Number(code[12])
}
export function ean8Valid(code) {
  if (!/^\d{8}$/.test(code)) return false
  let s = 0
  for (let i = 0; i < 7; i++) s += Number(code[i]) * (i % 2 ? 1 : 3)
  return (10 - (s % 10)) % 10 === Number(code[7])
}

// Runs (widths) of one binarised line, and which of them are dark.
function runsOf(bits) {
  const w = [], dark = []
  let i = 0
  while (i < bits.length) {
    let j = i
    while (j < bits.length && bits[j] === bits[i]) j++
    w.push(j - i); dark.push(bits[i] === 1)
    i = j
  }
  return { w, dark }
}

function guardOk(w, at, n, m) {
  for (let k = 0; k < n; k++) if (!near(w[at + k], m)) return false
  return true
}

// Try to read an EAN-13 starting at dark run i.
function tryEan13(w, i) {
  if (i + 59 > w.length) return null
  const m = (w[i] + w[i + 1] + w[i + 2]) / 3
  if (!guardOk(w, i, 3, m)) return null
  if (i > 0 && w[i - 1] < 3 * m) return null                       // quiet zone before
  let total = 0
  for (let k = 0; k < 59; k++) total += w[i + k]
  if (Math.abs(total / (95 * m) - 1) > 0.35) return null
  const unit = total / 95
  if (!guardOk(w, i + 27, 5, unit) || !guardOk(w, i + 56, 3, unit)) return null
  let digits = '', parity = ''
  for (let k = 0; k < 6; k++) {
    const hit = matchDigit(w.slice(i + 3 + 4 * k, i + 7 + 4 * k), [['L', L], ['G', G]])
    if (!hit) return null
    digits += hit.d; parity += hit.set
  }
  for (let k = 0; k < 6; k++) {
    const hit = matchDigit(w.slice(i + 32 + 4 * k, i + 36 + 4 * k), [['R', L]])
    if (!hit) return null
    digits += hit.d
  }
  const first = PARITY.indexOf(parity)
  if (first < 0) return null
  const code = first + digits
  return ean13Valid(code) ? code : null
}

function tryEan8(w, i) {
  if (i + 43 > w.length) return null
  const m = (w[i] + w[i + 1] + w[i + 2]) / 3
  if (!guardOk(w, i, 3, m)) return null
  if (i > 0 && w[i - 1] < 3 * m) return null
  let total = 0
  for (let k = 0; k < 43; k++) total += w[i + k]
  if (Math.abs(total / (67 * m) - 1) > 0.35) return null
  const unit = total / 67
  if (!guardOk(w, i + 19, 5, unit) || !guardOk(w, i + 40, 3, unit)) return null
  let digits = ''
  for (let k = 0; k < 4; k++) {
    const hit = matchDigit(w.slice(i + 3 + 4 * k, i + 7 + 4 * k), [['L', L]])
    if (!hit) return null
    digits += hit.d
  }
  for (let k = 0; k < 4; k++) {
    const hit = matchDigit(w.slice(i + 24 + 4 * k, i + 28 + 4 * k), [['R', L]])
    if (!hit) return null
    digits += hit.d
  }
  return ean8Valid(digits) ? digits : null
}

// Every code readable on one binarised line, in either direction.
function decodeBits(bits) {
  const out = []
  for (const b of [bits, bits.slice().reverse()]) {
    const { w, dark } = runsOf(b)
    for (let i = 0; i < w.length; i++) {
      if (!dark[i]) continue
      const c = tryEan13(w, i) || tryEan8(w, i)
      if (c) { out.push(c); break }
    }
  }
  return out
}

// One line of luma values → candidate bit arrays (1 = dark) from two thresholds: a local mean
// clamped into the local contrast band (so uneven light across the box does not turn the white
// margin on its bright side dark), and the line's plain midpoint. A stretch with no local
// contrast is white: it is a margin, never a bar. null when the whole line is flat.
function binarise(line) {
  const n = line.length
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) s[i] = (line[Math.max(0, i - 1)] + 2 * line[i] + line[Math.min(n - 1, i + 1)]) / 4
  let lo = 255, hi = 0
  for (let i = 0; i < n; i++) { if (s[i] < lo) lo = s[i]; if (s[i] > hi) hi = s[i] }
  if (hi - lo < 40) return null
  const mid = (lo + hi) / 2
  const win = Math.max(12, Math.round(n / 12))
  const pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + s[i]
  const a = new Uint8Array(n), b = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const l = Math.max(0, i - win), r = Math.min(n, i + win + 1)
    let llo = 255, lhi = 0
    for (let k = l; k < r; k++) { if (s[k] < llo) llo = s[k]; if (s[k] > lhi) lhi = s[k] }
    if (lhi - llo >= 30) {
      const mean = (pre[r] - pre[l]) / (r - l), band = (lhi - llo) * 0.25
      a[i] = s[i] < Math.min(lhi - band, Math.max(llo + band, mean)) ? 1 : 0
    }
    b[i] = s[i] < mid ? 1 : 0
  }
  return [a, b]
}

// Unsharp mask: a soft, out-of-focus line made crisp again, so narrow bars and spaces keep their
// width through the threshold. Tried after the line as it is.
function sharpen(line) {
  const n = line.length, out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let d = -2; d <= 2; d++) sum += line[Math.min(n - 1, Math.max(0, i + d))]
    out[i] = Math.max(0, Math.min(255, line[i] + 1.5 * (line[i] - sum / 5)))
  }
  return out
}

/**
 * Luma pixels (one byte per pixel, row-major) → the barcode's digits, or null. A code is only
 * returned once two different scan lines have read it.
 */
export function decodeLuma(luma, width, height) {
  if (!luma || !width || !height) return null
  const seen = new Map()
  const vote = c => { const n = (seen.get(c) || 0) + 1; seen.set(c, n); return n >= 2 }
  const lines = 15
  // Horizontal lines, then vertical ones for a code held sideways.
  for (const horizontal of [true, false]) {
    const len = horizontal ? width : height, across = horizontal ? height : width
    for (let k = 0; k < lines; k++) {
      // Spread from the middle outwards: the code is usually centred, and that is read first.
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2)
      const at = Math.round(across / 2 + (off * across) / (lines + 3))
      if (at < 1 || at >= across - 1) continue
      const line = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        let sum = 0
        for (let d = -1; d <= 1; d++) sum += horizontal ? luma[(at + d) * width + i] : luma[i * width + at + d]
        line[i] = sum / 3
      }
      for (const src of [line, sharpen(line)]) {
        const bins = binarise(src)
        if (!bins) continue
        for (const bits of bins) for (const c of decodeBits(bits)) if (vote(c)) return c
      }
    }
  }
  return null
}

// RGBA ImageData-shaped { data, width, height } → digits or null.
export function decodeImageData(img) {
  if (!img?.data || !img.width || !img.height) return null
  const n = img.width * img.height
  const luma = new Uint8Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) luma[i] = (img.data[j] * 77 + img.data[j + 1] * 150 + img.data[j + 2] * 29) >> 8
  return decodeLuma(luma, img.width, img.height)
}

/* ------------------------ encoding, for the tests ------------------------ */

// The module pattern (1 = bar) of an EAN-13 or EAN-8, quiet zones not included.
export function encodeModules(code) {
  const bits = []
  const push = (widths, startDark) => { let dark = startDark; for (const w of widths) { for (let k = 0; k < w; k++) bits.push(dark ? 1 : 0); dark = !dark } }
  push([1, 1, 1], true)
  if (code.length === 13) {
    const par = PARITY[Number(code[0])]
    for (let k = 0; k < 6; k++) push((par[k] === 'L' ? L : G)[Number(code[1 + k])], false)
    push([1, 1, 1, 1, 1], false)
    for (let k = 0; k < 6; k++) push(L[Number(code[7 + k])], true)
  } else {
    for (let k = 0; k < 4; k++) push(L[Number(code[k])], false)
    push([1, 1, 1, 1, 1], false)
    for (let k = 0; k < 4; k++) push(L[Number(code[4 + k])], true)
  }
  push([1, 1, 1], true)
  return bits
}
