'use strict'

// Burg Color: color analysis of the page.
//
// Collects the computed colors of visible elements (background, text, border,
// SVG) and the color variables on :root/html. Injected after lib/color.js;
// the result is the value of the last expression.
// The matching elements stay in window.__burgColorAnalysis so the popup can
// highlight them (see highlight in popup.js).
;(() => {
  const { parse, toHex } = self.BurgColor
  const MAX_ELEMENTS = 8000
  const MAX_PER_GROUP = 80
  const MAX_REFS = 300
  const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'BR', 'WBR'])
  const SVG_SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'use'])
  const COLOR_IN_TEXT = /(?:rgba?|hsla?|oklch|oklab|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi

  const groups = { background: new Map(), text: new Map(), border: new Map(), svg: new Map() }
  const refs = new Map()
  const hexCache = new Map()

  function hexOf(value) {
    if (!hexCache.has(value)) {
      const c = parse(value)
      hexCache.set(value, c && c.a > 0 ? toHex(c) : null)
    }
    return hexCache.get(value)
  }

  function add(group, value, el, seen) {
    if (!value || value === 'none') return
    const hex = hexOf(value)
    if (!hex || seen.has(group + hex)) return
    seen.add(group + hex)
    groups[group].set(hex, (groups[group].get(hex) || 0) + 1)
    const key = `${group}:${hex}`
    let list = refs.get(key)
    if (!list) refs.set(key, (list = []))
    if (list.length < MAX_REFS) list.push(el)
  }

  function hasOwnText(el) {
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) return true
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && /\S/.test(node.nodeValue)) return true
    }
    return false
  }

  const all = document.querySelectorAll('html, body, body *')
  let scanned = 0
  for (const el of all) {
    if (scanned >= MAX_ELEMENTS) break
    if (SKIP.has(el.tagName)) continue
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) continue
    scanned++
    const cs = getComputedStyle(el)
    const seen = new Set()

    if (el instanceof SVGElement) {
      if (SVG_SHAPES.has(el.localName)) {
        add('svg', cs.fill, el, seen)
        if (parseFloat(cs.strokeWidth) > 0) add('svg', cs.stroke, el, seen)
      }
      continue
    }

    add('background', cs.backgroundColor, el, seen)
    if (cs.backgroundImage !== 'none') {
      for (const match of cs.backgroundImage.matchAll(COLOR_IN_TEXT)) add('background', match[0], el, seen)
    }
    if (hasOwnText(el)) add('text', cs.color, el, seen)
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') {
        add('border', cs[`border${side}Color`], el, seen)
      }
    }
  }

  // Color variables on :root / html
  const vars = new Map()
  let skippedSheets = 0
  const rootStyle = getComputedStyle(document.documentElement)
  const isRootSelector = (selector) => /(^|,)\s*(:root|html)\s*(,|$)/.test(selector)

  function walk(rules) {
    for (const rule of rules) {
      if (rule.cssRules && !(rule instanceof CSSStyleRule)) {
        walk(rule.cssRules) // @media, @supports, @layer …
        continue
      }
      if (!(rule instanceof CSSStyleRule) || !isRootSelector(rule.selectorText)) continue
      for (const name of rule.style) {
        if (!name.startsWith('--') || vars.has(name)) continue
        // Computed value: var() references are already resolved
        const value = rootStyle.getPropertyValue(name).trim()
        const hex = value.length < 120 ? hexOf(value) : null
        if (hex) vars.set(name, { name, value, hex })
      }
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules)
    } catch {
      skippedSheets++ // cross-origin stylesheet without CORS
    }
  }

  window.__burgColorAnalysis = refs

  const sorted = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PER_GROUP)
      .map(([hex, count]) => ({ hex, count }))

  return {
    scanned,
    truncated: all.length > MAX_ELEMENTS,
    groups: {
      background: sorted(groups.background),
      text: sorted(groups.text),
      border: sorted(groups.border),
      svg: sorted(groups.svg),
    },
    vars: [...vars.values()].slice(0, 200),
    skippedSheets,
  }
})()
