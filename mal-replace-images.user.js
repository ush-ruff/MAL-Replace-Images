// ==UserScript==
// @name         MAL - Replace Images
// @namespace    Violentmonkey Scripts
// @match        https://myanimelist.net/*
// @version      0.1.0
// @author       ushruff
// @description  A simple script to fetch high quality images from malscraper and replace them on MAL
// @icon
// @homepageURL  https://github.com/ush-ruff/Common/tree/main/MAL-Replace-Images
// @downloadURL  https://github.com/ush-ruff/Common/tree/main/MAL-Replace-Images/raw/main/mal-replace-images.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      GNU GPLv3
// ==/UserScript==

// -----------------------------------
// Config
// -----------------------------------
const SELECTORS = {
  seasonalImages: `.seasonal-anime .image`,
  allImages: `
    .entry .image > a,
    .picSurround > a,
    .btn-anime > a.link
  `,
}

const SHORTCUT_CLEAR_CACHE = {
  ctrl: true,
  shift: true,
  alt: false,
  key: "x" // case-insensitive
}

const TOAST_DURATION = 5000

const ANIME_LIST_URL = "https://malscraper.azurewebsites.net/covers/all/anime/presets/animetitle"
const MANGA_LIST_URL = "https://malscraper.azurewebsites.net/covers/all/manga/presets/animetitle"
const BASE_URL = "https://cdn.myanimelist.net/images"

const ENABLE_KEY = "malImagesEnabled"

const CACHE_KEY = "imageMapCache"
const CACHE_VERSION_KEY = "imageMapCacheVersion"
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7 * 2 // 2 weeks

const JSON_PATTERN = /\.animetitle\[href\^="\/(anime|manga)\/(\d+)\/"\]\{background-image:url\(([^)]+)\)\}/g
const IMAGE_URL_PATTERN = /\/(anime|manga)\/(\d+)\//


// -----------------------------------
// Runtime
// -----------------------------------
let imageMap = null

registerMenuCommands()

onReady(async () => {
  if (!isEnabled()) {
    console.info("[MAL Images] Disabled")
    return
  }

  registerCacheClearShortcut()
  imageMap = await getCachedImageMap()

  replaceImages(SELECTORS.allImages)
  copyImages(SELECTORS.seasonalImages, "a > img", ".link-image")
})

// -----------------------------------
// Main
// -----------------------------------
function copyImages(selector, source, target) {
  const imageContainers = document.querySelectorAll(selector)

  imageContainers.forEach(imageContainer => {
    const sourceElement = imageContainer.querySelector(source)
    const targetElement = imageContainer.querySelector(target)

    if (!sourceElement || !targetElement) return

    const imageURL = sourceElement.dataset.src ?? sourceElement.src
    targetElement.style.backgroundImage = `url(${imageURL})`
  })
}

function replaceImages(selector) {
  if (!imageMap) return

  const imageContainers = document.querySelectorAll(selector)

  imageContainers.forEach(imageContainer => {
    const imageElement = imageContainer.querySelector("img")
    if (!imageElement) return

    const output = extractTypeAndId(imageContainer.href)
    if (!output) return

    const replacementPath = imageMap?.[output.type]?.[output.id]
    if (!replacementPath) return

    const replacement = expandUrl(replacementPath)
    imageElement.src = replacement
    imageElement.srcset = ""

    if (imageElement.dataset?.src) {
      imageElement.dataset.src = replacement
      imageElement.dataset.srcset = ""
    }
  })
}


// -----------------------------------
// Image map loading & cache
// -----------------------------------
function loadImageList(listUrl) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url: listUrl,
      responseType: "text",
      onload: response => resolve(response.response),
      onerror: reject
    })
  })
}

function updateImageList(data, imageList) {
  const matches = data.matchAll(JSON_PATTERN)

  for (const match of matches) {
    const type = match[1]
    const id = match[2]
    const url = match[3]

    imageList[type][id] = compressUrl(url)
  }

  return imageList
}

async function getCachedImageMap() {
  const cached = GM_getValue(CACHE_KEY)
  if (cached?.data && !isCacheExpired(cached.timestamp) ) {
    return cached.data
  }

  let imageList = {
    "anime": {},
    "manga": {}
  }

  let animeData, mangaData

  try {
    ;[animeData, mangaData] = await Promise.all([
      loadImageList(ANIME_LIST_URL),
      loadImageList(MANGA_LIST_URL)
    ])
  } catch (err) {
    console.error("[MAL Images] Failed to download image lists", err)
    showToast("[MAL Images] Failed to update image list", TOAST_DURATION)
    return cached?.data ?? { anime: {}, manga: {} }
  }

  updateImageList(animeData, imageList)
  updateImageList(mangaData, imageList)

  GM_setValue(CACHE_KEY, {
    data: imageList,
    timestamp: Date.now()
  })

  console.info(`[MAL Images] Loaded ${Object.keys(imageList.anime).length} anime + ${Object.keys(imageList.manga).length} manga covers`)
  return imageList
}

function isCacheExpired(timestamp) {
  if (!timestamp) return true
  return Date.now() - timestamp > CACHE_MAX_AGE
}


// -----------------------------------
// Helper functions
// -----------------------------------
function onReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn)
    return
  }
  fn()
}

function extractTypeAndId(url) {
  const match = url.match(IMAGE_URL_PATTERN)
  if (!match) return null

  return {
    type: match[1],
    id: Number(match[2])
  }
}

function compressUrl(url) {
  if (!url) return url

  if (url.startsWith("//")) url = "https:" + url
  return url.startsWith(BASE_URL) ? url.slice(BASE_URL.length) : url
}

function expandUrl(path) {
  if (!path) return path

  if (path.startsWith("http")) return path
  if (path.startsWith("//")) return "https:" + path
  return path.startsWith("/") ? BASE_URL + path : BASE_URL + "/" + path
}

// -----------------------------------
// User Input & Notifications
// -----------------------------------
function isEnabled() {
  const value = GM_getValue(ENABLE_KEY)
  return value !== false
}

function registerMenuCommands() {
  const label = isEnabled() ? "Disable MAL Images" : "Enable MAL Images"

  GM_registerMenuCommand(label, () => {
    const next = !isEnabled()
    GM_setValue(ENABLE_KEY, next)

    showToast(`[MAL Images] Script ${next ? "enabled" : "disabled"}`)
    location.reload()
  })

  GM_registerMenuCommand("Clear image cache", async () => {
    await clearCacheAndRefresh()
  })
}

function registerCacheClearShortcut() {
  document.addEventListener("keydown", async event => {
    if (event.repeat) return
    if (!isShortcutPressed(event, SHORTCUT_CLEAR_CACHE)) return

    await clearCacheAndRefresh()
  })
}

async function clearCacheAndRefresh(showFeedback = true) {
  GM_setValue(CACHE_KEY, undefined)
  imageMap = null

  if (showFeedback) {
    showToast("[MAL Images] Cache cleared", TOAST_DURATION)
  }

  imageMap = await getCachedImageMap()
  replaceImages(SELECTORS.allImages)
}

function isShortcutPressed(event, shortcut) {
  if (["INPUT", "TEXTAREA"].includes(event.target?.tagName)) return

  if (shortcut.ctrl !== undefined && event.ctrlKey !== shortcut.ctrl) return false
  if (shortcut.shift !== undefined && event.shiftKey !== shortcut.shift) return false
  if (shortcut.alt !== undefined && event.altKey !== shortcut.alt) return false

  return event.key.toLowerCase() === shortcut.key.toLowerCase()
}

function showToast(message, duration = 2000) {
  const existing = document.getElementById("mal-images-toast")
  if (existing) existing.remove()

  const toast = document.createElement("div")
  toast.id = "mal-images-toast"
  toast.textContent = message

  Object.assign(toast.style, {
    position: "fixed",
    top: "24px",
    left: "24px",
    fontSize: "0.825rem",
    fontFamily: "var(--ff-main, 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif')",
    padding: "1rem 1.5rem",
    background: "var(--accent-color, rgba(0, 0, 0, 0.85))",
    borderRadius: "6px",
    color: "var(--text-bright, #fff)",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
    opacity: "0",
    transition: "opacity 0.2s ease",
    zIndex: 99999,
  })

  document.body.appendChild(toast)

  // fade in
  requestAnimationFrame(() => {
    toast.style.opacity = "1"
  })

  // fade out + cleanup
  setTimeout(() => {
    toast.style.opacity = "0"
    setTimeout(() => toast.remove(), 200)
  }, duration)
}
