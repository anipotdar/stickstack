// StickStack service worker: message router, storage access for content scripts,
// and the bridge to the offscreen document that does the heavy image work.
import * as db from './lib/db.js';
import { getSettings, renderKey } from './lib/settings.js';
import { blobToDataURL, bytesToBase64 } from './lib/util.js';
import './lib/voicecodec.js'; // defines globalThis.StickStackVoice

const Voice = globalThis.StickStackVoice;
import { renderedToPayload } from './lib/service.js';

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');
const LIBRARY_URL = chrome.runtime.getURL('library/library.html');

// ---------------- install / update ----------------
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: `${LIBRARY_URL}?welcome=1` });
  // Tabs that were open before install/update don't have (current) content scripts — inject them.
  for (const cs of chrome.runtime.getManifest().content_scripts || []) {
    try {
      const tabs = await chrome.tabs.query({ url: cs.matches });
      for (const tab of tabs) {
        if (tab.discarded || !tab.id) continue;
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js }).catch(() => {});
      }
    } catch {}
  }
});

// Scripts injected into Substack pages (built-in hosts and user-enabled custom domains).
const SUBSTACK_SCRIPTS = (chrome.runtime.getManifest().content_scripts || []).find((cs) => cs.js?.includes('content/substack.js'))?.js || ['content/substack.js'];

const customId = (origin) => `custom-${new URL(origin.replace('/*', '/')).hostname.replace(/[^a-z0-9.-]/gi, '')}`;
const BUILT_IN = new Set(chrome.runtime.getManifest().host_permissions);

chrome.permissions.onAdded.addListener(async ({ origins = [] }) => {
  // A custom-domain Substack publication was enabled from the popup.
  for (const origin of origins) {
    if (BUILT_IN.has(origin) || !/^https:\/\/[^*/]+\/\*$/.test(origin)) continue;
    const id = customId(origin);
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
      await chrome.scripting.registerContentScripts([{ id, matches: [origin], js: SUBSTACK_SCRIPTS, runAt: 'document_idle', persistAcrossSessions: true }]);
      const tabs = await chrome.tabs.query({ url: origin });
      for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: SUBSTACK_SCRIPTS }).catch(() => {});
    } catch (e) {
      console.warn('[StickStack] could not enable', origin, e);
    }
  }
});

chrome.permissions.onRemoved.addListener(async ({ origins = [] }) => {
  // User revoked a custom domain in chrome://extensions — drop its registered script too.
  try {
    const regs = await chrome.scripting.getRegisteredContentScripts();
    const ids = regs.filter((r) => r.matches?.some((m) => origins.includes(m))).map((r) => r.id);
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  } catch {}
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-picker') return;
  const t = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!t?.id) return;
  chrome.tabs.sendMessage(t.id, { type: 'picker:toggle' }).catch(() => {});
});

// ---------------- offscreen document ----------------
let creating = null;
let idleTimer = null;

async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [OFFSCREEN_URL] });
  if (ctx.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({ url: OFFSCREEN_URL, reasons: ['BLOBS'], justification: 'Decode WhatsApp stickers and convert them to PNG/GIF with canvas.' })
      .catch((e) => {
        if (!/single offscreen|already/i.test(String(e?.message))) throw e;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

async function callOffscreen(payload) {
  await ensureOffscreen();
  clearTimeout(idleTimer);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await chrome.runtime.sendMessage({ target: 'offscreen', ...payload });
      if (r === undefined) throw new Error('Receiving end does not exist');
      if (!r.ok) throw new Error(r.error || 'Conversion failed');
      scheduleOffscreenClose();
      return r;
    } catch (e) {
      lastErr = e;
      if (!/Receiving end does not exist|Could not establish connection/i.test(String(e?.message))) break;
      await new Promise((res) => setTimeout(res, 150 * (attempt + 1)));
      await ensureOffscreen();
    }
  }
  scheduleOffscreenClose();
  throw lastErr;
}

function scheduleOffscreenClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 3 * 60 * 1000);
}

const notifyChanged = () => chrome.runtime.sendMessage({ type: 'library:changed' }).catch(() => {});

// ---------------- handlers ----------------
async function getRenderedPayload(id) {
  const settings = await getSettings();
  const key = `${id}:${renderKey(settings)}`;
  let entry = await db.getRender(key);
  if (!entry) {
    await callOffscreen({ op: 'render', id });
    entry = await db.getRender(key);
  }
  if (!entry) throw new Error('Could not prepare this sticker');
  const rec = await db.getSticker(id);
  if (!rec) throw new Error('This sticker was deleted');
  db.updateStickers([id], (r) => ({ ...r, usedAt: Date.now(), useCount: (r.useCount || 0) + 1 })).catch(() => {});
  return renderedToPayload(entry, rec.name);
}

async function openLibrary(hash = '') {
  const url = LIBRARY_URL + (hash ? `#${hash}` : '');
  const tabs = await chrome.tabs.query({ url: `${LIBRARY_URL}*` });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { active: true, ...(hash ? { url } : {}) });
    if (tabs[0].windowId) chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
  } else await chrome.tabs.create({ url });
  return {};
}

/** GET a URL without cookies, refusing redirects and anything larger than `max` bytes (even without Content-Length). */
async function fetchCapped(url, max) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'force-cache', redirect: 'error', referrerPolicy: 'no-referrer', signal: ctrl.signal });
    if (!res.ok) throw new Error(`Couldn’t load the voice note (${res.status})`);
    if (Number(res.headers.get('content-length') || 0) > max) return null;
    const reader = res.body.getReader();
    const parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        ctrl.abort();
        return null;
      }
      parts.push(value);
    }
    const out = new Uint8Array(size);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- who may call what ----------------
// Messages can only come from this extension, but content scripts run inside web pages, so each
// handler also checks which page it was called from (defence in depth if a page is compromised).
const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
const senderOrigin = (sender) => {
  try {
    return sender.origin || new URL(sender.url).origin;
  } catch {
    return '';
  }
};
const fromExtensionPage = (sender) => senderOrigin(sender) === EXT_ORIGIN;
async function fromSubstackPage(sender) {
  const origin = senderOrigin(sender);
  if (!sender.tab || !origin.startsWith('https://')) return false;
  const host = new URL(origin).hostname;
  if (host === 'substack.com' || host.endsWith('.substack.com')) return true;
  return chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false); // user-enabled custom domain
}
const fromWhatsAppWeb = (sender) => !!sender.tab && senderOrigin(sender) === 'https://web.whatsapp.com';

const ALLOWED = {
  'library:list': ['ext', 'substack'],
  'library:thumbs': ['ext', 'substack'],
  'sticker:render': ['ext', 'substack'],
  'sticker:fav': ['ext', 'substack'],
  'library:open': ['ext', 'substack', 'whatsapp'],
  'settings:get': ['ext', 'substack', 'whatsapp'],
  'voice:fetch': ['substack'],
  'wa:ingest': ['whatsapp'],
};
async function senderAllowed(type, sender) {
  for (const kind of ALLOWED[type] || []) {
    if (kind === 'ext' && fromExtensionPage(sender)) return true;
    if (kind === 'whatsapp' && fromWhatsAppWeb(sender)) return true;
    if (kind === 'substack' && (await fromSubstackPage(sender))) return true;
  }
  return false;
}

const handlers = {
  async 'library:list'() {
    const [stickers, packs, settings] = await Promise.all([db.listStickers(), db.listPacks(), getSettings()]);
    return { stickers: stickers.map(db.stickerMeta), packs, settings };
  },
  async 'library:thumbs'({ ids }) {
    const thumbs = {};
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 120)) {
      const rec = await db.getSticker(id);
      if (rec?.thumb) thumbs[id] = await blobToDataURL(rec.thumb);
    }
    return { thumbs };
  },
  async 'sticker:render'({ id }) {
    if (typeof id !== 'string') throw new Error('Bad sticker id');
    return getRenderedPayload(id);
  },
  async 'sticker:fav'({ id, fav }) {
    await db.updateStickers([id], { fav: !!fav });
    notifyChanged();
    return {};
  },
  async 'library:open'({ hash }) {
    return openLibrary(typeof hash === 'string' ? hash : '');
  },
  async 'settings:get'() {
    return { settings: await getSettings() };
  },
  // Voice notes: fetch an uploaded image's original bytes (the page can't, because of CORS) and
  // return the recording inside it, if any. Only Substack's own upload bucket is allowed.
  async 'voice:fetch'({ url }) {
    if (!Voice.isAllowedOriginal(url)) throw new Error('Not a Substack upload');
    const bytes = await fetchCapped(url, Voice.MAX_FETCH_BYTES);
    if (!bytes || !Voice.isPng(bytes)) return { voice: null };
    const v = Voice.extractVoice(bytes);
    return { voice: v && { mime: v.mime, durationMs: v.durationMs, peaks: v.peaks, audio: bytesToBase64(v.audio) } };
  },
  async 'wa:ingest'({ items, packName }) {
    if (!Array.isArray(items) || !items.length) return { report: { added: [], duplicates: [], skipped: [] } };
    const r = await callOffscreen({ op: 'ingest', items: items.slice(0, 50), packName: String(packName || 'WhatsApp Web').slice(0, 60) });
    notifyChanged();
    return { report: r.report };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || msg.target === 'offscreen') return false;
  if (sender.id !== chrome.runtime.id) return false;
  const handler = handlers[msg.type];
  if (!handler) return false;
  senderAllowed(msg.type, sender)
    .then((ok) => {
      if (!ok) throw new Error('Not allowed from this page');
      return handler(msg, sender);
    })
    .then(
      (r) => sendResponse({ ok: true, ...(r || {}) }),
      (e) => sendResponse({ ok: false, error: String(e?.userMessage || e?.message || e) })
    );
  return true;
});
