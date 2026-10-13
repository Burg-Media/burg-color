'use strict'

// Burg Color: color conversions. Shared by the service worker, popup, tools
// page and content scripts (hence self.… ??= : may be injected more than once).
//
// Internally a color is { r, g, b, a }: r/g/b integers 0–255, a 0–1.

self.BurgColor ??= (() => {
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
  const round = (v, digits = 0) => {
    const f = 10 ** digits
    return Math.round(v * f) / f
  }
  const hex2 = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
  const wrapHue = (h) => ((h % 360) + 360) % 360

  function rgb(r, g, b, a = 1) {
    return {
      r: Math.round(clamp(r, 0, 255)),
      g: Math.round(clamp(g, 0, 255)),
      b: Math.round(clamp(b, 0, 255)),
      a: round(clamp(a, 0, 1), 3),
    }
  }

  // -------------------------------------------------------------------------
  // HSL / HSV (h 0–360, others 0–100)
  // -------------------------------------------------------------------------

  function hueOf(r, g, b, max, d) {
    if (!d) return 0
    let h
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    return wrapHue(h * 60)
  }

  function toHsl({ r, g, b, a }) {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    const l = (max + min) / 2
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0
    return { h: hueOf(r, g, b, max, d), s: s * 100, l: l * 100, a }
  }

  function fromHsl({ h, s, l, a = 1 }) {
    h = wrapHue(h)
    s = clamp(s, 0, 100) / 100
    l = clamp(l, 0, 100) / 100
    const k = (n) => (n + h / 30) % 12
    const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    return rgb(f(0) * 255, f(8) * 255, f(4) * 255, a)
  }

  function toHsv({ r, g, b, a }) {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b)
    const d = max - Math.min(r, g, b)
    return { h: hueOf(r, g, b, max, d), s: max ? (d / max) * 100 : 0, v: max * 100, a }
  }

  function fromHsv({ h, s, v, a = 1 }) {
    h = wrapHue(h)
    s = clamp(s, 0, 100) / 100
    v = clamp(v, 0, 100) / 100
    const f = (n) => {
      const k = (n + h / 60) % 6
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    }
    return rgb(f(5) * 255, f(3) * 255, f(1) * 255, a)
  }

  // -------------------------------------------------------------------------
  // OKLab / OKLCH (l 0–1). Matrices from Björn Ottosson,
  // https://bottosson.github.io/posts/oklab/
  // -------------------------------------------------------------------------

  const toLinear = (c) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const fromLinear = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055)

  function toOklch({ r, g, b, a }) {
    r = toLinear(r)
    g = toLinear(g)
    b = toLinear(b)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    const c = Math.hypot(A, B)
    return { l: L, c, h: c < 1e-4 ? 0 : wrapHue((Math.atan2(B, A) * 180) / Math.PI), a }
  }

  function fromOklab(L, A, B, alpha = 1) {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
    return rgb(
      fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
      alpha
    )
  }

  function fromOklch({ l, c, h, a = 1 }) {
    const rad = (h * Math.PI) / 180
    return fromOklab(l, c * Math.cos(rad), c * Math.sin(rad), a)
  }

  // -------------------------------------------------------------------------
  // Parsing
  // -------------------------------------------------------------------------

  /** Number with optional %; `percent` is the value that 100% stands for. */
  function num(token, percent = 1) {
    if (token === undefined) return NaN
    if (token === 'none') return 0
    const v = parseFloat(token)
    return token.endsWith('%') ? (v / 100) * percent : v
  }

  function angle(token) {
    const v = parseFloat(token)
    if (token.endsWith('turn')) return v * 360
    if (token.endsWith('grad')) return v * 0.9
    if (token.endsWith('rad')) return (v * 180) / Math.PI
    return token === 'none' ? 0 : v
  }

  function parseFunction(fn, body) {
    const t = body.replace(/[,/]/g, ' ').trim().split(/\s+/)
    const alpha = (token) => (token === undefined ? 1 : num(token, 1))
    let c = null
    switch (fn) {
      case 'rgb':
      case 'rgba':
        c = rgb(num(t[0], 255), num(t[1], 255), num(t[2], 255), alpha(t[3]))
        break
      case 'hsl':
      case 'hsla':
        c = fromHsl({ h: angle(t[0]), s: parseFloat(t[1]), l: parseFloat(t[2]), a: alpha(t[3]) })
        break
      case 'oklch':
        c = fromOklch({ l: num(t[0], 1), c: num(t[1], 0.4), h: angle(t[2]), a: alpha(t[3]) })
        break
      case 'oklab':
        c = fromOklab(num(t[0], 1), num(t[1], 0.4), num(t[2], 0.4), alpha(t[3]))
        break
      case 'color':
        if (t[0] === 'srgb') c = rgb(num(t[1], 1) * 255, num(t[2], 1) * 255, num(t[3], 1) * 255, alpha(t[4]))
        break
    }
    return c && [c.r, c.g, c.b, c.a].every(Number.isFinite) ? c : null
  }

  let namedCtx = null
  /** Color names (red, rebeccapurple …) via the browser's canvas normalization. */
  function parseNamed(s) {
    if (!/^[a-z]+$/.test(s)) return null
    if (s === 'transparent') return rgb(0, 0, 0, 0)
    if (typeof OffscreenCanvas === 'undefined') return null
    namedCtx ??= new OffscreenCanvas(1, 1).getContext('2d')
    namedCtx.fillStyle = '#000'
    namedCtx.fillStyle = s
    const first = namedCtx.fillStyle
    namedCtx.fillStyle = '#fff'
    namedCtx.fillStyle = s
    // Invalid names leave the previous value in place
    return namedCtx.fillStyle === first ? parse(first) : null
  }

  /** Reads hex, rgb(), hsl(), oklch(), oklab(), color(srgb …) or a color name. */
  function parse(input) {
    if (input == null) return null
    const s = String(input).trim().toLowerCase()
    let m = s.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
    if (m) {
      let h = m[1]
      if (h.length <= 4) h = [...h].map((ch) => ch + ch).join('')
      const byte = (i) => parseInt(h.slice(i, i + 2), 16)
      return rgb(byte(0), byte(2), byte(4), h.length === 8 ? byte(6) / 255 : 1)
    }
    m = s.match(/^([a-z]+)\(([^()]*)\)$/)
    if (m) return parseFunction(m[1], m[2])
    return parseNamed(s)
  }

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  const FORMATS = [
    { id: 'hex', label: 'HEX' },
    { id: 'hexbare', label: self.t ? t('fmtHexBare') : 'HEX without #' },
    { id: 'rgb', label: 'RGB' },
    { id: 'hsl', label: 'HSL' },
    { id: 'oklch', label: 'OKLCH' },
  ]

  /** Canonical storage form: #rrggbb, or #rrggbbaa with transparency. */
  function toHex(c, upper = false) {
    const h = '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + (c.a < 1 ? hex2(c.a * 255) : '')
    return upper ? h.toUpperCase() : h
  }

  function format(c, fmt = 'hex', { upper = false } = {}) {
    const a = round(c.a, 2)
    switch (fmt) {
      case 'hexbare':
        return toHex(c, upper).slice(1)
      case 'rgb':
        return c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${a})` : `rgb(${c.r}, ${c.g}, ${c.b})`
      case 'hsl': {
        const { h, s, l } = toHsl(c)
        const body = `${round(h)}, ${round(s)}%, ${round(l)}%`
        return c.a < 1 ? `hsla(${body}, ${a})` : `hsl(${body})`
      }
      case 'oklch': {
        const { l, c: chroma, h } = toOklch(c)
        return `oklch(${round(l * 100, 1)}% ${round(chroma, 3)} ${round(h, 1)}${c.a < 1 ? ` / ${a}` : ''})`
      }
      default:
        return toHex(c, upper)
    }
  }

  // -------------------------------------------------------------------------
  // Math
  // -------------------------------------------------------------------------

  const luminance = (c) => 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)

  /** Composites `top` over an (opaque) `bottom`. */
  function blend(top, bottom) {
    const a = top.a
    return rgb(top.r * a + bottom.r * (1 - a), top.g * a + bottom.g * (1 - a), top.b * a + bottom.b * (1 - a), 1)
  }

  /** WCAG contrast ratio (1–21). Transparent colors are composited first. */
  function contrast(fg, bg) {
    const white = rgb(255, 255, 255)
    const back = bg.a < 1 ? blend(bg, white) : bg
    const front = fg.a < 1 ? blend(fg, back) : fg
    const l1 = luminance(front)
    const l2 = luminance(back)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }

  const mix = (c1, c2, t) =>
    rgb(c1.r + (c2.r - c1.r) * t, c1.g + (c2.g - c1.g) * t, c1.b + (c2.b - c1.b) * t, c1.a + (c2.a - c1.a) * t)

  const rotateHue = (c, deg) => {
    const hsl = toHsl(c)
    return fromHsl({ ...hsl, h: hsl.h + deg })
  }

  /** Black or white, whichever reads best on this color. */
  const readableText = (c) => (contrast(rgb(0, 0, 0), c) >= contrast(rgb(255, 255, 255), c) ? '#000000' : '#ffffff')

  return {
    FORMATS,
    rgb,
    parse,
    format,
    toHex,
    toHsl,
    fromHsl,
    toHsv,
    fromHsv,
    toOklch,
    fromOklch,
    luminance,
    contrast,
    blend,
    mix,
    rotateHue,
    readableText,
  }
})()
