'use strict'

const C = BurgColor
const $ = (id) => document.getElementById(id)
localizePage()
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const WHITE = C.rgb(255, 255, 255)
const BLACK = C.rgb(0, 0, 0)

let settings = { ...BurgStore.DEFAULT_SETTINGS }
const fmt = (color, id = settings.format) => C.format(color, id, { upper: settings.upper })
const opaque = (color) => C.toHex({ ...color, a: 1 })

let toastTimer = 0
function toast(text) {
  $('toast').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), 1600)
}

async function copy(text, label = text) {
  toast((await BurgStore.copyText(text)) ? t('copied', label) : t('copyFailed'))
}

/** Button that only runs the action on a second click within 3 s. */
function confirmButton(button, action) {
  const label = button.textContent
  let timer = 0
  const reset = () => {
    clearTimeout(timer)
    button.classList.remove('confirm')
    button.textContent = label
  }
  button.addEventListener('click', () => {
    if (button.classList.contains('confirm')) {
      reset()
      action()
    } else {
      button.classList.add('confirm')
      button.textContent = t('confirm')
      timer = setTimeout(reset, 3000)
    }
  })
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  Object.assign(node, props)
  node.append(...children)
  return node
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS = ['kiezer', 'gradient', 'paletten']

function showTab(name) {
  if (!TABS.includes(name)) name = 'kiezer'
  for (const tab of TABS) $(`tab-${tab}`).hidden = tab !== name
  for (const button of document.querySelectorAll('.tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === name))
  }
  history.replaceState(null, '', `#${name}`)
}

for (const button of document.querySelectorAll('.tabs button')) {
  button.addEventListener('click', () => showTab(button.dataset.tab))
}

// ---------------------------------------------------------------------------
// Color picker
// ---------------------------------------------------------------------------

const picker = { hsv: { h: 350, s: 90, v: 75, a: 1 }, color: C.fromHsv({ h: 350, s: 90, v: 75 }) }
const formatInputs = {}
let saveTimer = 0

function setColor(color, source) {
  const hsv = C.toHsv(color)
  // Keep hue (and saturation) for gray and black, otherwise the picker jumps
  if (hsv.s === 0 || hsv.v === 0) hsv.h = picker.hsv.h
  if (hsv.v === 0) hsv.s = picker.hsv.s
  picker.hsv = hsv
  picker.color = color
  renderPicker(source)
}

function setHsv(patch, source) {
  picker.hsv = { ...picker.hsv, ...patch }
  picker.color = C.fromHsv(picker.hsv)
  renderPicker(source)
}

function renderPicker(source) {
  const { h, s, v, a } = picker.hsv
  const color = picker.color
  $('sv').style.backgroundColor = `hsl(${h} 100% 50%)`
  const handle = $('sv-handle')
  handle.style.left = `${s}%`
  handle.style.top = `${100 - v}%`
  handle.style.background = opaque(color)
  if (source !== 'hue') $('hue').value = Math.round(h)
  if (source !== 'alpha') $('alpha').value = Math.round(a * 100)
  $('alpha').style.setProperty('--c', opaque(color))
  $('preview').style.background = C.toHex(color)
  for (const [id, input] of Object.entries(formatInputs)) {
    if (id === source) continue
    input.value = fmt(color, id)
    input.classList.remove('invalid')
  }
  renderContrast()
  renderVariants()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => chrome.storage.local.set({ toolsColor: C.toHex(color) }), 400)
}

// Format rows (HEX, RGB, HSL, OKLCH): typing updates the color
for (const { id, label } of C.FORMATS) {
  if (id === 'hexbare') continue
  const input = el('input', { type: 'text', className: 'text-input', id: `f-${id}`, spellcheck: false })
  input.addEventListener('input', () => {
    const color = C.parse(input.value)
    input.classList.toggle('invalid', !color)
    if (color) setColor(color, id)
  })
  input.addEventListener('blur', () => {
    input.value = fmt(picker.color, id)
    input.classList.remove('invalid')
  })
  const copyButton = el('button', { className: 'btn', textContent: t('copyButton') })
  copyButton.addEventListener('click', () => {
    copy(fmt(picker.color, id))
    BurgStore.saveColor(C.toHex(picker.color))
  })
  formatInputs[id] = input
  $('format-rows').append(
    el('div', { className: 'format-row' }, [el('label', { htmlFor: input.id, textContent: label }), input, copyButton])
  )
}

// Saturation/brightness area
const sv = $('sv')
function moveSv(event) {
  const rect = sv.getBoundingClientRect()
  setHsv(
    {
      s: clamp((event.clientX - rect.left) / rect.width, 0, 1) * 100,
      v: (1 - clamp((event.clientY - rect.top) / rect.height, 0, 1)) * 100,
    },
    'sv'
  )
}
sv.addEventListener('pointerdown', (event) => {
  sv.setPointerCapture(event.pointerId)
  moveSv(event)
})
sv.addEventListener('pointermove', (event) => {
  if (sv.hasPointerCapture(event.pointerId)) moveSv(event)
})
sv.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 10 : 1
  const moves = { ArrowLeft: ['s', -step], ArrowRight: ['s', step], ArrowUp: ['v', step], ArrowDown: ['v', -step] }
  const move = moves[event.key]
  if (!move) return
  event.preventDefault()
  setHsv({ [move[0]]: clamp(picker.hsv[move[0]] + move[1], 0, 100) }, 'sv')
})
$('hue').addEventListener('input', () => setHsv({ h: Number($('hue').value) }, 'hue'))
$('alpha').addEventListener('input', () => setHsv({ a: Number($('alpha').value) / 100 }, 'alpha'))

// Eyedropper for the whole screen (also outside the browser)
if ('EyeDropper' in window) {
  $('eyedropper').hidden = false
  $('eyedropper').addEventListener('click', async () => {
    try {
      const { sRGBHex } = await new EyeDropper().open()
      const color = C.parse(sRGBHex)
      setColor(color)
      BurgStore.saveColor(C.toHex(color))
      copy(fmt(color))
    } catch {
      // Cancelled with Esc
    }
  })
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

let contrastBg = WHITE
const CHECKS = [
  [t('chkAaNormal'), 4.5],
  [t('chkAaLarge'), 3],
  [t('chkAaaNormal'), 7],
  [t('chkAaaLarge'), 4.5],
  [t('chkUi'), 3],
]

function syncBgInputs(source) {
  if (source !== 'text') {
    $('bg-input').value = fmt(contrastBg, 'hex')
    $('bg-input').classList.remove('invalid')
  }
  if (source !== 'native') $('bg-native').value = opaque(contrastBg).toLowerCase()
}

function renderContrast() {
  const fg = picker.color
  $('fg-swatch').style.background = C.toHex(fg)
  $('fg-value').textContent = fmt(fg, 'hex')
  const preview = $('contrast-preview')
  preview.style.background = C.toHex(contrastBg)
  preview.style.color = C.toHex(fg)
  const ratio = C.contrast(fg, contrastBg)
  // WCAG: never round up (4.499 is not 4.5)
  $('ratio').textContent = `${(Math.floor(ratio * 100) / 100).toFixed(2)} : 1`
  $('checks').replaceChildren(
    ...CHECKS.map(([label, min]) =>
      el('li', { className: ratio >= min ? 'pass' : 'fail', textContent: `${ratio >= min ? '✓' : '✗'} ${label}` })
    )
  )
}

$('bg-input').addEventListener('input', () => {
  const color = C.parse($('bg-input').value)
  $('bg-input').classList.toggle('invalid', !color)
  if (!color) return
  contrastBg = color
  syncBgInputs('text')
  renderContrast()
})
$('bg-input').addEventListener('blur', () => syncBgInputs())
$('bg-native').addEventListener('input', () => {
  contrastBg = C.parse($('bg-native').value)
  syncBgInputs('native')
  renderContrast()
})
$('swap').addEventListener('click', () => {
  const previous = picker.color
  setColor(contrastBg)
  contrastBg = previous
  syncBgInputs()
  renderContrast()
})

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const HARMONIES = [
  [t('hComplementary'), [0, 180]],
  [t('hSplit'), [0, 150, 210]],
  [t('hAnalogous'), [-30, 0, 30]],
  [t('hTriadic'), [0, 120, 240]],
  [t('hTetradic'), [0, 90, 180, 270]],
]

function strip(colors, selfIndex) {
  return el(
    'div',
    { className: 'strip' },
    colors.map((color, i) => {
      const hex = C.toHex(color, settings.upper)
      const button = el('button', { className: i === selfIndex ? 'self' : '', textContent: hex.slice(1), title: hex })
      button.style.background = C.toHex(color)
      button.style.color = C.readableText(color)
      button.addEventListener('click', () => setColor(color))
      return button
    })
  )
}

function renderVariants() {
  const base = { ...picker.color, a: 1 }
  const lighter = [0.85, 0.7, 0.5, 0.3, 0.15].map((t) => C.mix(base, WHITE, t))
  const darker = [0.15, 0.3, 0.5, 0.7].map((t) => C.mix(base, BLACK, t))
  $('shades').replaceWith(Object.assign(strip([...lighter, base, ...darker], 5), { id: 'shades' }))
  $('harmonies').replaceChildren(
    ...HARMONIES.flatMap(([label, angles]) => [
      el('h3', { textContent: label }),
      strip(
        angles.map((deg) => (deg ? C.rotateHue(base, deg) : base)),
        angles.indexOf(0)
      ),
    ])
  )
}

// ---------------------------------------------------------------------------
// Palettes (selection in the picker)
// ---------------------------------------------------------------------------

const newPalette = (palettes) => ({ id: Date.now().toString(36), name: t('paletteName', palettes.length + 1), colors: [] })

function renderPaletteSelect(palettes) {
  const select = $('palette-select')
  const previous = select.value
  select.replaceChildren(...palettes.map((p) => new Option(p.name || t('untitled'), p.id)), new Option(t('newPaletteOption'), '__new'))
  if ([...select.options].some((o) => o.value === previous)) select.value = previous
}

$('add-to-palette').addEventListener('click', async () => {
  const palettes = await BurgStore.getPalettes()
  let palette = palettes.find((p) => p.id === $('palette-select').value)
  if (!palette) {
    palette = newPalette(palettes)
    palettes.push(palette)
  }
  const hex = C.toHex(picker.color)
  if (!palette.colors.includes(hex)) palette.colors.push(hex)
  await BurgStore.setPalettes(palettes)
  $('palette-select').value = palette.id
  toast(t('addedTo', palette.name))
})

// ---------------------------------------------------------------------------
// Gradient
// ---------------------------------------------------------------------------

const gradient = {
  type: 'linear',
  angle: 90,
  shape: 'circle',
  pos: 'center',
  stops: [
    { color: C.parse('#ff512f'), pos: 0 },
    { color: C.parse('#dd2476'), pos: 100 },
  ],
  selected: 0,
}

const PRESETS = [
  ['#ff512f', '#dd2476'],
  ['#4facfe', '#00f2fe'],
  ['#43e97b', '#38f9d7'],
  ['#fa709a', '#fee140'],
  ['#30cfd0', '#330867'],
  ['#a18cd1', '#fbc2eb'],
  ['#f6d365', '#fda085'],
  ['#0f2027', '#203a43', '#2c5364'],
  ['#12c2e9', '#c471ed', '#f64f59'],
  ['#ffffff', '#ffffff00'],
  ['#000000cc', '#00000000'],
  ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'],
]

const round1 = (v) => Math.round(v * 10) / 10
const stopColor = (color) => (color.a < 1 ? C.format(color, 'rgb') : C.toHex(color, settings.upper))
const sortedStops = () => [...gradient.stops].sort((a, b) => a.pos - b.pos)
const stopList = () => sortedStops().map((s) => `${stopColor(s.color)} ${round1(s.pos)}%`).join(', ')

function gradientCss() {
  const at = gradient.pos === 'center' ? '' : ` at ${gradient.pos}`
  switch (gradient.type) {
    case 'radial':
      return `radial-gradient(${gradient.shape}${at}, ${stopList()})`
    case 'conic':
      return `conic-gradient(from ${gradient.angle}deg${at}, ${stopList()})`
    default:
      return `linear-gradient(${gradient.angle}deg, ${stopList()})`
  }
}

function colorAt(pos) {
  const stops = sortedStops()
  if (pos <= stops[0].pos) return stops[0].color
  for (let i = 1; i < stops.length; i++) {
    const [a, b] = [stops[i - 1], stops[i]]
    if (pos <= b.pos) return C.mix(a.color, b.color, b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos))
  }
  return stops[stops.length - 1].color
}

function renderGradient({ rows = true, markers = true } = {}) {
  const css = gradientCss()
  $('g-preview').style.background = css
  $('g-bar-fill').style.background = `linear-gradient(90deg, ${stopList()})`
  $('g-css').textContent = `background: ${stopColor(sortedStops()[0].color)};\nbackground: ${css};`

  $('g-angle-row').hidden = gradient.type === 'radial'
  $('g-shape-row').hidden = gradient.type !== 'radial'
  $('g-pos-row').hidden = gradient.type === 'linear'
  $('g-angle').value = gradient.angle
  $('g-angle-num').value = gradient.angle
  $('g-type').value = gradient.type
  $('g-shape').value = gradient.shape
  $('g-pos').value = gradient.pos

  if (markers) renderMarkers()
  if (rows) renderStopRows()
}

function renderMarkers() {
  $('g-markers').replaceChildren(
    ...gradient.stops.map((stop, i) => {
      const marker = el('div', { className: `marker${i === gradient.selected ? ' selected' : ''}`, title: stopColor(stop.color) })
      marker.style.left = `${stop.pos}%`
      marker.style.background = C.toHex(stop.color)
      marker.addEventListener('pointerdown', (event) => {
        event.stopPropagation()
        marker.setPointerCapture(event.pointerId)
        gradient.selected = i
        for (const [n, m] of [...$('g-markers').children].entries()) m.classList.toggle('selected', n === i)
        renderStopRows()
      })
      marker.addEventListener('pointermove', (event) => {
        if (!marker.hasPointerCapture(event.pointerId)) return
        const rect = $('g-bar').getBoundingClientRect()
        stop.pos = round1(clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100))
        marker.style.left = `${stop.pos}%`
        renderGradient({ rows: false, markers: false })
        updateStopRow(i)
      })
      marker.addEventListener('pointerup', () => renderGradient())
      return marker
    })
  )
}

function renderStopRows() {
  $('g-stops').replaceChildren(
    ...gradient.stops.map((stop, i) => {
      const native = el('input', { type: 'color', value: opaque(stop.color).toLowerCase(), title: t('pickColor') })
      const text = el('input', { type: 'text', className: 'text-input', value: stopColor(stop.color), spellcheck: false })
      const alpha = el('input', { type: 'number', className: 'num', min: 0, max: 100, value: Math.round(stop.color.a * 100), title: t('opacity') })
      const pos = el('input', { type: 'number', className: 'num', min: 0, max: 100, step: 0.1, value: stop.pos, title: t('position') })
      const remove = el('button', { className: 'btn icon', textContent: '×', title: t('removeStop') })
      remove.disabled = gradient.stops.length <= 2

      const select = () => {
        if (gradient.selected === i) return
        gradient.selected = i
        for (const [n, row] of [...$('g-stops').children].entries()) row.classList.toggle('selected', n === i)
        renderGradient({ rows: false })
      }
      const changed = (source) => {
        if (source !== 'native') native.value = opaque(stop.color).toLowerCase()
        if (source !== 'text') text.value = stopColor(stop.color)
        if (source !== 'alpha') alpha.value = Math.round(stop.color.a * 100)
        renderGradient({ rows: false })
      }

      native.addEventListener('input', () => {
        stop.color = { ...C.parse(native.value), a: stop.color.a }
        changed('native')
      })
      text.addEventListener('input', () => {
        const color = C.parse(text.value)
        text.classList.toggle('invalid', !color)
        if (!color) return
        stop.color = color
        changed('text')
      })
      text.addEventListener('blur', () => {
        text.value = stopColor(stop.color)
        text.classList.remove('invalid')
      })
      alpha.addEventListener('input', () => {
        stop.color = { ...stop.color, a: clamp(Number(alpha.value) || 0, 0, 100) / 100 }
        changed('alpha')
      })
      pos.addEventListener('input', () => {
        stop.pos = clamp(Number(pos.value) || 0, 0, 100)
        renderGradient({ rows: false })
      })
      remove.addEventListener('click', () => {
        gradient.stops.splice(i, 1)
        gradient.selected = Math.min(gradient.selected, gradient.stops.length - 1)
        renderGradient()
      })

      const row = el('div', { className: `stop${i === gradient.selected ? ' selected' : ''}` }, [
        native,
        text,
        alpha,
        el('span', { className: 'unit', textContent: '%' }),
        pos,
        el('span', { className: 'unit', textContent: '%' }),
        remove,
      ])
      row.addEventListener('focusin', select)
      row.addEventListener('pointerdown', select)
      return row
    })
  )
}

/** Updates only the position in a row (while dragging). */
function updateStopRow(i) {
  const row = $('g-stops').children[i]
  if (row) row.querySelectorAll('.num')[1].value = gradient.stops[i].pos
}

$('g-bar').addEventListener('pointerdown', (event) => {
  if (event.target.classList.contains('marker')) return
  const rect = $('g-bar').getBoundingClientRect()
  const pos = round1(clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100))
  gradient.stops.push({ color: colorAt(pos), pos })
  gradient.selected = gradient.stops.length - 1
  renderGradient()
})

$('g-type').addEventListener('change', () => {
  gradient.type = $('g-type').value
  renderGradient({ rows: false })
})
$('g-shape').addEventListener('change', () => {
  gradient.shape = $('g-shape').value
  renderGradient({ rows: false })
})
$('g-pos').addEventListener('change', () => {
  gradient.pos = $('g-pos').value
  renderGradient({ rows: false })
})
for (const id of ['g-angle', 'g-angle-num']) {
  $(id).addEventListener('input', () => {
    gradient.angle = clamp(Math.round(Number($(id).value) || 0), 0, 360)
    renderGradient({ rows: false })
  })
}
$('g-add').addEventListener('click', () => {
  // New stop in the largest gap between existing stops
  const stops = sortedStops()
  let best = { gap: -1, pos: 50 }
  for (let i = 1; i < stops.length; i++) {
    const gap = stops[i].pos - stops[i - 1].pos
    if (gap > best.gap) best = { gap, pos: round1(stops[i - 1].pos + gap / 2) }
  }
  gradient.stops.push({ color: colorAt(best.pos), pos: best.pos })
  gradient.selected = gradient.stops.length - 1
  renderGradient()
})
$('g-use-current').addEventListener('click', () => {
  gradient.stops[gradient.selected].color = picker.color
  renderGradient()
})
$('g-reverse').addEventListener('click', () => {
  for (const stop of gradient.stops) stop.pos = round1(100 - stop.pos)
  renderGradient()
})
$('g-copy').addEventListener('click', () => copy($('g-css').textContent, 'CSS'))
$('g-copy-value').addEventListener('click', () => copy(gradientCss(), t('gradientLabel')))

for (const preset of PRESETS) {
  const stops = preset.map((hex, i) => ({ color: C.parse(hex), pos: round1((i / (preset.length - 1)) * 100) }))
  const button = el('button', { title: preset.join(' → ') })
  button.style.background = `linear-gradient(90deg, ${preset.join(', ')}), repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 10px 10px`
  button.addEventListener('click', () => {
    gradient.stops = stops.map((s) => ({ ...s }))
    gradient.selected = 0
    renderGradient()
  })
  $('g-presets').append(button)
}

// Paste an existing gradient
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

const SIDE_ANGLES = {
  top: 0, 'top right': 45, 'right top': 45, right: 90, 'bottom right': 135, 'right bottom': 135,
  bottom: 180, 'bottom left': 225, 'left bottom': 225, left: 270, 'top left': 315, 'left top': 315,
}
const POSITIONS = new Set([...$('g-pos').options].map((o) => o.value))

function parseStop(part) {
  const m = part.match(/^((?:[a-z-]+\([^()]*\))|#[0-9a-f]+|[a-z]+)\s*(.*)$/i)
  const color = m && C.parse(m[1])
  if (!color) return null
  const positions = (m[2].match(/-?[\d.]+%/g) || []).map((p) => clamp(parseFloat(p), 0, 100))
  return { color, positions }
}

function importGradient(text) {
  const m = text
    .trim()
    .replace(/;\s*$/, '')
    .replace(/^background(-image)?\s*:\s*/i, '')
    .match(/^(?:repeating-)?(linear|radial|conic)-gradient\(([\s\S]*)\)$/i)
  if (!m) throw new Error(t('errNoGradient'))
  const type = m[1].toLowerCase()
  const parts = splitTopLevel(m[2])
  const next = { type, angle: type === 'linear' ? 180 : 0, shape: 'ellipse', pos: 'center' }

  if (!parseStop(parts[0])) {
    const config = parts.shift().toLowerCase()
    const deg = config.match(/(-?[\d.]+)(deg|turn)/)
    if (deg) next.angle = Math.round((((parseFloat(deg[1]) * (deg[2] === 'turn' ? 360 : 1)) % 360) + 360) % 360)
    const side = config.match(/^to\s+(.+)$/)
    if (side && side[1] in SIDE_ANGLES) next.angle = SIDE_ANGLES[side[1]]
    if (/\bcircle\b/.test(config)) next.shape = 'circle'
    const at = config.match(/\bat\s+(.+)$/)
    if (at && POSITIONS.has(at[1].trim())) next.pos = at[1].trim()
  }

  const stops = []
  const parsed = parts.map(parseStop)
  if (parsed.some((s) => !s) || parsed.length < 2) throw new Error(t('errStops'))
  parsed.forEach(({ color, positions }, i) => {
    if (!positions.length) positions = [round1((i / (parsed.length - 1)) * 100)]
    for (const pos of positions) stops.push({ color, pos })
  })
  Object.assign(gradient, next, { stops, selected: 0 })
}

$('g-import').addEventListener('input', () => {
  const text = $('g-import').value.trim()
  $('g-import-error').hidden = true
  if (!text) return
  try {
    importGradient(text)
    renderGradient()
  } catch (err) {
    $('g-import-error').textContent = err.message
    $('g-import-error').hidden = false
  }
})

// ---------------------------------------------------------------------------
// History & palettes
// ---------------------------------------------------------------------------

function chip(hex, onClick, onRemove) {
  const color = C.parse(hex)
  const swatch = el('span', { className: 'color' })
  swatch.style.setProperty('--c', hex)
  const button = el('button', { className: 'chip', title: t('chipTitle', fmt(color)) }, [
    swatch,
    el('span', { textContent: fmt(color, 'hex') }),
  ])
  button.addEventListener('click', onClick)
  if (onRemove) {
    const remove = el('span', { className: 'remove', textContent: '×', title: t('remove'), role: 'button' })
    remove.addEventListener('click', (event) => {
      event.stopPropagation()
      onRemove()
    })
    button.append(remove)
  }
  return button
}

function openInPicker(hex) {
  setColor(C.parse(hex))
  showTab('kiezer')
  scrollTo({ top: 0, behavior: 'smooth' })
}

async function renderHistory() {
  const list = await BurgStore.getHistory()
  $('history-empty').hidden = list.length > 0
  $('history').replaceChildren(...list.map((hex) => chip(hex, () => openInPicker(hex))))
}

$('history-copy').addEventListener('click', async () => {
  const list = await BurgStore.getHistory()
  copy(list.map((hex) => fmt(C.parse(hex))).join('\n'), t('historyCount', list.length))
})
confirmButton($('history-clear'), () => chrome.storage.local.set({ history: [] }))

const slug = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'color'

async function updatePalette(id, change) {
  const palettes = await BurgStore.getPalettes()
  const palette = palettes.find((p) => p.id === id)
  if (!palette) return
  change(palette)
  await BurgStore.setPalettes(palettes)
}

async function renderPalettes() {
  const palettes = await BurgStore.getPalettes()
  renderPaletteSelect(palettes)
  $('palettes-empty').hidden = palettes.length > 0
  $('palettes').replaceChildren(
    ...palettes.map((palette) => {
      const name = el('input', { type: 'text', className: 'text-input', value: palette.name, ariaLabel: t('paletteNameAria') })
      name.addEventListener('change', () => updatePalette(palette.id, (p) => (p.name = name.value.trim() || t('untitled'))))

      const addCurrent = el('button', { className: 'btn', textContent: t('addFromPicker') })
      addCurrent.addEventListener('click', () => {
        const hex = C.toHex(picker.color)
        updatePalette(palette.id, (p) => p.colors.includes(hex) || p.colors.push(hex))
      })

      const cssVars = el('button', { className: 'btn', textContent: t('cssVariables') })
      cssVars.addEventListener('click', () => {
        const prefix = slug(palette.name)
        const lines = palette.colors.map((hex, i) => `  --${prefix}-${i + 1}: ${fmt(C.parse(hex), 'hex')};`)
        copy(`:root {\n${lines.join('\n')}\n}`, t('cssVariables'))
      })

      const json = el('button', { className: 'btn', textContent: 'JSON' })
      json.addEventListener('click', () =>
        copy(JSON.stringify(palette.colors.map((hex) => fmt(C.parse(hex), 'hex'))), 'JSON')
      )

      const remove = el('button', { className: 'btn danger', textContent: t('delete') })
      confirmButton(remove, async () => {
        const all = await BurgStore.getPalettes()
        BurgStore.setPalettes(all.filter((p) => p.id !== palette.id))
      })

      const grid = el(
        'div',
        { className: 'swatch-grid' },
        palette.colors.map((hex) =>
          chip(
            hex,
            () => openInPicker(hex),
            () => updatePalette(palette.id, (p) => (p.colors = p.colors.filter((h) => h !== hex)))
          )
        )
      )
      const empty = el('p', { className: 'muted', textContent: t('paletteEmpty'), hidden: palette.colors.length > 0 })

      return el('div', { className: 'palette' }, [
        el('div', { className: 'palette-head' }, [name, addCurrent, cssVars, json, remove]),
        grid,
        empty,
      ])
    })
  )
}

$('palette-new').addEventListener('click', async () => {
  const palettes = await BurgStore.getPalettes()
  palettes.push(newPalette(palettes))
  await BurgStore.setPalettes(palettes)
})

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return
  if (changes.history) renderHistory()
  if (changes.palettes) renderPalettes()
  if (changes.settings) {
    settings = await BurgStore.getSettings()
    renderPicker()
    renderGradient()
    renderHistory()
    renderPalettes()
  }
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

;(async () => {
  settings = await BurgStore.getSettings()
  const { current, toolsColor } = await chrome.storage.local.get(['current', 'toolsColor'])
  // Opened from the popup after picking: start with the last picked color
  setColor(C.parse(current) || C.parse(toolsColor) || picker.color)
  syncBgInputs()
  renderGradient()
  renderHistory()
  renderPalettes()
  showTab(location.hash.slice(1))
})()
