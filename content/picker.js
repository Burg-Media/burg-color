'use strict'

// Burg Color: eyedropper on the page.
//
// Reads the pixel under the cursor from a screenshot of the visible area, so
// images, gradients, shadows and canvas work too. Scrolling or resizing takes
// a new screenshot.
//
// Click = pick and stop · Shift+click = pick and continue · arrows = 1 px
// (with Shift 10 px) · Enter = pick · Esc or right-click = stop.
// Injected on demand (after lib/i18n.js and lib/color.js); starting it again stops it.
;(() => {
  if (window.__burgColorPicker) {
    window.__burgColorPicker.stop()
    return
  }

  const { format, toHex } = self.BurgColor
  const ZOOM = 11 // pixels in the magnifier (odd, so there is a center pixel)
  const CELL = 11 // display size per pixel
  const LOUPE = ZOOM * CELL
  const HALF = (ZOOM - 1) / 2

  const settings = { format: 'hex', upper: true }
  ;(async () => {
    const { settings: stored } = await chrome.storage.local.get('settings')
    Object.assign(settings, stored)
  })().catch(() => {})

  let bitmap = null // screenshot
  let pixels = null // its ImageData
  let scale = 1 // device pixels per CSS pixel
  let x = innerWidth / 2
  let y = innerHeight / 2
  let current = null
  let raf = 0
  let recaptureTimer = 0
  let stopped = false

  // ---------------------------------------------------------------------------
  // UI in a closed shadow root
  // ---------------------------------------------------------------------------

  const host = document.createElement('div')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      .loupe { position: fixed; display: none; font: 12px/1.3 system-ui, -apple-system, sans-serif; }
      canvas { display: block; width: ${LOUPE}px; height: ${LOUPE}px; border-radius: 10px;
               border: 2px solid #8B7BF5; box-shadow: 0 0 0 1px rgba(14,14,16,.5), 0 6px 20px rgba(14,14,16,.3); }
      .info { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; padding: 6px 8px;
              border-radius: 10px; background: #0E0E10; color: #F4F3F0; box-shadow: inset 0 3px 0 #8B7BF5, 0 4px 14px rgba(14,14,16,.3);
              padding-top: 8px;
              min-width: ${LOUPE}px; width: max-content; max-width: 280px; }
      .row { display: flex; align-items: center; gap: 6px; }
      .swatch { flex: none; width: 14px; height: 14px; border-radius: 4px; border: 1px solid rgba(244,243,240,.6); }
      .value { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-variant-numeric: tabular-nums; white-space: nowrap;
               overflow: hidden; text-overflow: ellipsis; }
      .el { color: #A5A5AD; font-size: 10.5px; font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .hint, .toast { position: fixed; left: 50%; transform: translateX(-50%); padding: 7px 14px; border-radius: 999px;
                      font: 13px/1.4 system-ui, -apple-system, sans-serif; color: #F4F3F0; background: #0E0E10;
                      border: 1px solid #2A2A30; box-shadow: 0 4px 14px rgba(14,14,16,.3); white-space: nowrap; transition: opacity .4s; }
      .hint { bottom: 16px; }
      .hint.fade { opacity: 0; }
      .toast { top: 16px; display: none; align-items: center; gap: 8px; }
      .toast.error { background: #F2678C; border-color: #F2678C; color: #0E0E10; }
      kbd { font: inherit; font-size: 11px; padding: 0 4px; border-radius: 4px; background: rgba(244,243,240,.15); font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; }
      textarea { position: fixed; opacity: 0; }
    </style>
    <div class="loupe">
      <canvas width="${LOUPE * devicePixelRatio}" height="${LOUPE * devicePixelRatio}"></canvas>
      <div class="info">
        <div class="row"><span class="swatch"></span><span class="value"></span></div>
        <div class="el"></div>
      </div>
    </div>
    <div class="hint">${t('hintPick')} · <kbd>Shift</kbd>${t('hintShiftClick')} · <kbd>←↑→↓</kbd> 1 px · <kbd>Esc</kbd> ${t('hintStop')}</div>
    <div class="toast"><span class="swatch"></span><span class="text"></span></div>`
  document.documentElement.appendChild(host)

  const loupe = root.querySelector('.loupe')
  const canvas = root.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  ctx.scale(devicePixelRatio, devicePixelRatio)
  const swatch = root.querySelector('.info .swatch')
  const value = root.querySelector('.info .value')
  const elInfo = root.querySelector('.el')
  const hint = root.querySelector('.hint')
  const toastEl = root.querySelector('.toast')
  setTimeout(() => hint.classList.add('fade'), 5000)

  // ---------------------------------------------------------------------------
  // Screenshot
  // ---------------------------------------------------------------------------

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))

  async function capture() {
    host.style.visibility = 'hidden' // keep our own UI out of the screenshot
    await nextFrame()
    await nextFrame()
    try {
      const response = await chrome.runtime.sendMessage({ type: 'capture' })
      if (stopped) return
      if (!response || response.error) throw new Error(response?.error || t('errNoCapture'))
      // Decode the base64 here: fetch() of a data: URL can be blocked by the page's CSP
      const base64 = atob(response.dataUrl.slice(response.dataUrl.indexOf(',') + 1))
      const bytes = new Uint8Array(base64.length)
      for (let i = 0; i < base64.length; i++) bytes[i] = base64.charCodeAt(i)
      const next = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const off = new OffscreenCanvas(next.width, next.height).getContext('2d', { willReadFrequently: true })
      off.drawImage(next, 0, 0)
      bitmap?.close()
      bitmap = next
      pixels = off.getImageData(0, 0, next.width, next.height)
      scale = next.width / innerWidth
    } catch (err) {
      pixels = null
      toast(t('pickerFailed', err.message), null, true)
    } finally {
      host.style.visibility = ''
      schedule()
    }
  }

  function recaptureSoon() {
    pixels = null // stale until the new screenshot arrives
    loupe.style.display = 'none'
    clearTimeout(recaptureTimer)
    recaptureTimer = setTimeout(capture, 350)
  }

  function pixelAt(px, py) {
    if (!pixels || px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) return null
    const i = (py * pixels.width + px) * 4
    const d = pixels.data
    return { r: d[i], g: d[i + 1], b: d[i + 2], a: 1 }
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  function schedule() {
    if (!raf && !stopped) raf = requestAnimationFrame(render)
  }

  function describe(el) {
    if (!el || el === document.documentElement) return 'html'
    let text = el.tagName.toLowerCase()
    if (el.id) text += `#${el.id}`
    const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2) : []
    if (classes[0]) text += `.${classes.join('.')}`
    return text
  }

  function render() {
    raf = 0
    const px = Math.floor(x * scale)
    const py = Math.floor(y * scale)
    current = pixelAt(px, py)
    if (!current) {
      loupe.style.display = 'none'
      return
    }

    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#808080'
    ctx.fillRect(0, 0, LOUPE, LOUPE)
    ctx.drawImage(bitmap, px - HALF, py - HALF, ZOOM, ZOOM, 0, 0, LOUPE, LOUPE)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < ZOOM; i++) {
      ctx.moveTo(i * CELL + 0.5, 0)
      ctx.lineTo(i * CELL + 0.5, LOUPE)
      ctx.moveTo(0, i * CELL + 0.5)
      ctx.lineTo(LOUPE, i * CELL + 0.5)
    }
    ctx.stroke()
    const c = HALF * CELL
    ctx.strokeStyle = '#000'
    ctx.strokeRect(c - 0.5, c - 0.5, CELL + 2, CELL + 2)
    ctx.strokeStyle = '#fff'
    ctx.strokeRect(c + 0.5, c + 0.5, CELL, CELL)

    const hex = toHex(current)
    swatch.style.background = hex
    value.textContent = format(current, settings.format, { upper: settings.upper })
    elInfo.textContent = describe(document.elementFromPoint(x, y))

    loupe.style.display = 'block'
    const w = loupe.offsetWidth
    const h = loupe.offsetHeight
    let left = x + 22
    let top = y + 22
    if (left + w > innerWidth - 4) left = x - 22 - w
    if (top + h > innerHeight - 4) top = y - 22 - h
    loupe.style.left = `${Math.max(4, left)}px`
    loupe.style.top = `${Math.max(4, top)}px`
  }

  // ---------------------------------------------------------------------------
  // Picking
  // ---------------------------------------------------------------------------

  let toastTimer = 0
  function toast(text, hex, error = false) {
    toastEl.classList.toggle('error', error)
    toastEl.querySelector('.text').textContent = text
    const sw = toastEl.querySelector('.swatch')
    sw.style.display = hex ? '' : 'none'
    if (hex) sw.style.background = hex
    toastEl.style.display = 'flex'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastEl.style.display = 'none'), error ? 5000 : 1800)
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      root.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    }
  }

  async function pick(keepGoing) {
    if (!current) return
    const color = current
    const text = format(color, settings.format, { upper: settings.upper })
    const copied = await copy(text)
    chrome.runtime.sendMessage({ type: 'picked', hex: toHex(color) }).catch(() => {})
    toast(copied ? t('copied', text) : t('copyFailedValue', text), toHex(color))
    if (!keepGoing) stop(1800)
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  const block = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const handlers = {
    mousemove(event) {
      x = event.clientX
      y = event.clientY
      schedule()
    },
    click(event) {
      block(event)
      if (event.button === 0) pick(event.shiftKey)
    },
    contextmenu(event) {
      block(event)
      stop()
    },
    keydown(event) {
      const step = event.shiftKey ? 10 : 1
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (event.key === 'Escape') {
        block(event)
        stop()
      } else if (event.key === 'Enter') {
        block(event)
        pick(event.shiftKey)
      } else if (moves[event.key]) {
        block(event)
        x = Math.min(innerWidth - 1, Math.max(0, x + moves[event.key][0]))
        y = Math.min(innerHeight - 1, Math.max(0, y + moves[event.key][1]))
        schedule()
      }
    },
    scroll: recaptureSoon,
    resize: recaptureSoon,
  }
  // Keeps the page from reacting to clicks (links, buttons, focus, selection)
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick']) {
    handlers[type] = block
  }

  for (const [type, fn] of Object.entries(handlers)) {
    window.addEventListener(type, fn, { capture: true, passive: type === 'scroll' || type === 'resize' })
  }

  function stop(delay = 0) {
    if (stopped) return
    stopped = true
    delete window.__burgColorPicker
    for (const [type, fn] of Object.entries(handlers)) window.removeEventListener(type, fn, { capture: true })
    clearTimeout(recaptureTimer)
    cancelAnimationFrame(raf)
    loupe.style.display = 'none'
    hint.style.display = 'none'
    chrome.runtime.sendMessage({ type: 'cursor', on: false }).catch(() => {})
    setTimeout(() => {
      host.remove()
      bitmap?.close()
    }, delay)
  }

  window.__burgColorPicker = { stop }
  chrome.runtime.sendMessage({ type: 'cursor', on: true }).catch(() => {})
  capture()
})()
