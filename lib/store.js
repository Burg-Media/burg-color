'use strict'

// Burg Color: storage in chrome.storage.local. Shared by the service worker,
// popup and tools page.
//
//   settings  { format, upper }        copy format
//   current   '#rrggbb[aa]'            last picked color (also in the icon)
//   history   ['#rrggbb[aa]', …]       newest first
//   palettes  [{ id, name, colors }]

self.BurgStore ??= (() => {
  const HISTORY_MAX = 60
  const DEFAULT_SETTINGS = { format: 'hex', upper: true }
  const local = chrome.storage.local

  async function getSettings() {
    const { settings } = await local.get('settings')
    return { ...DEFAULT_SETTINGS, ...settings }
  }

  async function setSettings(patch) {
    const settings = { ...(await getSettings()), ...patch }
    await local.set({ settings })
    return settings
  }

  /** Puts a color at the front of the history and makes it the current color. */
  async function saveColor(hex) {
    const { history = [] } = await local.get('history')
    const next = [hex, ...history.filter((h) => h !== hex)].slice(0, HISTORY_MAX)
    await local.set({ history: next, current: hex })
  }

  async function getHistory() {
    const { history = [] } = await local.get('history')
    return history
  }

  async function getPalettes() {
    const { palettes = [] } = await local.get('palettes')
    return palettes
  }

  const setPalettes = (palettes) => local.set({ palettes })

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  return { DEFAULT_SETTINGS, getSettings, setSettings, saveColor, getHistory, getPalettes, setPalettes, copyText }
})()
