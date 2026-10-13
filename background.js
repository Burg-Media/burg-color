'use strict'

// Burg Color: service worker
//
// Starts the eyedropper in the active tab, takes screenshots of the visible
// area for it (chrome.tabs.captureVisibleTab), saves picked colors and shows
// the last color as a dot in the toolbar icon.

importScripts('lib/i18n.js', 'lib/color.js', 'lib/store.js')

const PICKER_CSS = 'html, html * { cursor: crosshair !important; }'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function flashError(tabId, message) {
  chrome.action.setBadgeBackgroundColor({ color: '#F2678C', tabId })
  chrome.action.setBadgeTextColor({ color: '#0E0E10', tabId })
  chrome.action.setBadgeText({ text: '!', tabId })
  chrome.action.setTitle({ title: `Burg Color: ${message}`, tabId })
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId })
    chrome.action.setTitle({ title: 'Burg Color', tabId })
  }, 6000)
}

async function startPicker(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/i18n.js', 'lib/color.js', 'content/picker.js'] })
    return { ok: true }
  } catch {
    const error = t('errPickerBlocked')
    flashError(tabId, error)
    return { ok: false, error }
  }
}

async function capture(tab) {
  if (!tab.active) return { error: t('errTabInactive') }
  for (let attempt = 0; ; attempt++) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
      return { dataUrl }
    } catch (err) {
      // Chrome allows at most two captures per second
      if (attempt < 3 && /MAX_CAPTURE/.test(err.message)) {
        await sleep(600)
        continue
      }
      return { error: err.message }
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'start':
      startPicker(message.tabId).then(sendResponse)
      return true
    case 'capture':
      capture(sender.tab).then(sendResponse)
      return true
    case 'cursor': {
      const details = { target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, css: PICKER_CSS }
      const action = message.on ? chrome.scripting.insertCSS(details) : chrome.scripting.removeCSS(details)
      action.catch(() => {})
      return false
    }
    case 'picked':
      BurgStore.saveColor(message.hex).then(() => sendResponse({ ok: true }))
      return true
  }
  return false
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'pick') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) startPicker(tab.id)
})

// ---------------------------------------------------------------------------
// Toolbar icon with the last picked color
// ---------------------------------------------------------------------------

async function updateIcon(hex) {
  const color = hex && BurgColor.parse(hex)
  if (!color) return
  const imageData = {}
  for (const size of [16, 32]) {
    const blob = await (await fetch(`images/icon_${size}.png`)).blob()
    const bitmap = await createImageBitmap(blob)
    const ctx = new OffscreenCanvas(size, size).getContext('2d')
    ctx.drawImage(bitmap, 0, 0, size, size)
    const r = size * 0.3
    ctx.beginPath()
    ctx.arc(size - r, size - r, r, 0, Math.PI * 2)
    ctx.fillStyle = '#FBF9F4' // paper-colored ring that separates the dot from the violet tile
    ctx.fill()
    ctx.beginPath()
    ctx.arc(size - r, size - r, r - size / 12, 0, Math.PI * 2)
    ctx.fillStyle = BurgColor.toHex({ ...color, a: 1 })
    ctx.fill()
    imageData[size] = ctx.getImageData(0, 0, size, size)
  }
  await chrome.action.setIcon({ imageData })
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.current) updateIcon(changes.current.newValue).catch(() => {})
})

async function restoreIcon() {
  const { current } = await chrome.storage.local.get('current')
  updateIcon(current).catch(() => {})
}
chrome.runtime.onStartup.addListener(restoreIcon)
chrome.runtime.onInstalled.addListener(restoreIcon)

// Burg Media: welcome page after install, short page after uninstall.
// The URL only carries fixed UTM tags; nothing else is sent.
const SITE = 'https://burgmedia.eu/extensies/burg-color/'
const utm = (campaign) => '?utm_source=burg-color&utm_medium=extension&utm_campaign=' + campaign
chrome.runtime.setUninstallURL(SITE + 'verwijderd/' + utm('uninstall'))
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: SITE + 'welkom/' + utm('install') })
})
