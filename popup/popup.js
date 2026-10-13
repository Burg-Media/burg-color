'use strict'

const { FORMATS, parse, format } = BurgColor
const $ = (id) => document.getElementById(id)
localizePage()

let settings = { ...BurgStore.DEFAULT_SETTINGS }
const fmt = (color) => format(color, settings.format, { upper: settings.upper })

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

let toastTimer = 0
function toast(text) {
  $('toast').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), 1500)
}

async function copy(text) {
  toast((await BurgStore.copyText(text)) ? t('copied', text) : t('copyFailed'))
}

function swatchButton(hex, title, onClick) {
  const button = document.createElement('button')
  button.className = 'sw'
  button.style.setProperty('--c', hex)
  button.title = title
  button.addEventListener('click', onClick)
  return button
}

// ---------------------------------------------------------------------------
// Last color and history
// ---------------------------------------------------------------------------

function renderCurrent(hex) {
  const color = parse(hex)
  $('current-section').hidden = !color
  if (!color) return
  $('current-swatch').style.background = hex
  const list = $('current-formats')
  list.replaceChildren()
  for (const { id, label } of FORMATS) {
    if (id === 'hexbare') continue
    const text = format(color, id, { upper: settings.upper })
    const row = document.createElement('button')
    row.className = 'format'
    row.title = t('copyTitle')
    const l = document.createElement('span')
    l.className = 'label'
    l.textContent = label
    const v = document.createElement('span')
    v.className = 'val'
    v.textContent = text
    row.append(l, v)
    row.addEventListener('click', () => copy(text))
    list.append(row)
  }
}

function renderHistory(history) {
  $('history-section').hidden = !history.length
  $('history').replaceChildren(
    ...history.slice(0, 22).map((hex) =>
      swatchButton(hex, t('swatchCopyTitle', hex), () => copy(fmt(parse(hex))))
    )
  )
}

async function refresh() {
  const { current, history = [] } = await chrome.storage.local.get(['current', 'history'])
  renderCurrent(current)
  renderHistory(history)
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.current || changes.history || changes.settings)) refresh()
})

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

for (const { id, label } of FORMATS) $('format').add(new Option(label, id))

;(async () => {
  settings = await BurgStore.getSettings()
  $('format').value = settings.format
  $('upper').checked = settings.upper
  await refresh()
})().catch(() => {})
$('format').addEventListener('change', async () => {
  settings = await BurgStore.setSettings({ format: $('format').value })
})
$('upper').addEventListener('change', async () => {
  settings = await BurgStore.setSettings({ upper: $('upper').checked })
})

// chrome:// links don't open from a plain <a>
$('shortcuts').addEventListener('click', (event) => {
  event.preventDefault()
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
})

function showError(text) {
  $('error').textContent = text
  $('error').hidden = !text
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

$('pick').addEventListener('click', async () => {
  try {
    const tab = await activeTab()
    const response = await chrome.runtime.sendMessage({ type: 'start', tabId: tab?.id })
    if (response?.ok) window.close()
    else showError(response?.error || t('pickStartFailed'))
  } catch {
    showError(t('pickStartFailed'))
  }
})

$('tools').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('tools/tools.html') })
  window.close()
})

// Runs in the page: outlines the elements with this color (found by analyze.js)
function highlight(key) {
  const elements = (window.__burgColorAnalysis && window.__burgColorAnalysis.get(key)) || []
  document.querySelector('burg-color-highlight')?.remove()
  if (!elements.length) return 0
  const host = document.createElement('burg-color-highlight')
  host.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;'
  const root = host.attachShadow({ mode: 'closed' })
  let shown = 0
  let first = null
  for (const el of elements) {
    if (!el.isConnected) continue
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    first ??= rect
    const box = document.createElement('div')
    box.style.cssText = `position:absolute;left:${rect.left + scrollX}px;top:${rect.top + scrollY}px;width:${rect.width}px;height:${rect.height}px;outline:2px solid #8B7BF5;outline-offset:1px;box-shadow:0 0 0 4px rgba(14,14,16,.55);border-radius:2px;transition:opacity .5s;`
    root.appendChild(box)
    shown++
  }
  document.documentElement.appendChild(host)
  if (first && (first.bottom < 0 || first.top > innerHeight)) {
    scrollTo({ top: first.top + scrollY - innerHeight / 3, behavior: 'smooth' })
  }
  setTimeout(() => {
    for (const box of root.children) box.style.opacity = '0'
    setTimeout(() => host.remove(), 500)
  }, 2500)
  return shown
}

const GROUP_LABELS = { background: t('groupBackground'), text: t('groupText'), border: t('groupBorder'), svg: t('groupSvg') }

function renderAnalysis(result, tabId) {
  const container = $('analysis-groups')
  container.replaceChildren()
  const total = new Set(Object.values(result.groups).flatMap((list) => list.map((item) => item.hex))).size
  $('analysis-meta').textContent = t('analysisMeta', total, result.scanned, result.truncated ? '+' : '')

  for (const [group, label] of Object.entries(GROUP_LABELS)) {
    const list = result.groups[group]
    if (!list.length) continue
    const h = document.createElement('h3')
    h.textContent = `${label} (${list.length})`
    const grid = document.createElement('div')
    grid.className = 'swatches'
    for (const { hex, count } of list) {
      grid.append(
        swatchButton(hex, `${hex} · ${count}×`, async () => {
          await copy(fmt(parse(hex)))
          BurgStore.saveColor(hex)
          chrome.scripting.executeScript({ target: { tabId }, func: highlight, args: [`${group}:${hex}`] }).catch(() => {})
        })
      )
    }
    container.append(h, grid)
  }

  if (result.vars.length) {
    const h = document.createElement('h3')
    h.textContent = `${t('cssVariables')} (${result.vars.length})`
    const list = document.createElement('div')
    list.className = 'vars'
    for (const { name, hex } of result.vars) {
      const row = document.createElement('div')
      row.className = 'var'
      const sw = swatchButton(hex, t('varColorCopyTitle', hex), () => copy(fmt(parse(hex))))
      const nameButton = document.createElement('button')
      nameButton.className = 'name'
      nameButton.textContent = name
      nameButton.title = t('varCopyTitle', name)
      nameButton.addEventListener('click', () => copy(`var(${name})`))
      const value = document.createElement('span')
      value.className = 'hex'
      value.textContent = hex
      row.append(sw, nameButton, value)
      list.append(row)
    }
    container.append(h, list)
  }

  if (result.skippedSheets) {
    const note = document.createElement('p')
    note.className = 'muted small'
    note.textContent = t('skippedSheets', result.skippedSheets)
    container.append(note)
  }
  $('analysis').hidden = false
}

$('analyze').addEventListener('click', async () => {
  const tab = await activeTab()
  $('analyze').disabled = true
  showError('')
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/i18n.js', 'lib/color.js', 'content/analyze.js'],
    })
    if (!result) throw new Error()
    renderAnalysis(result, tab.id)
  } catch {
    showError(t('analyzeFailed'))
  } finally {
    $('analyze').disabled = false
  }
})
