import { CONFIG } from '../lib/config.js';
import { countStickers, listPacks } from '../lib/db.js';

const $ = (id) => document.getElementById(id);
const LIB = chrome.runtime.getURL('library/library.html');

$('coffee').href = CONFIG.coffeeUrl;
$('repo').href = CONFIG.repoUrl;
$('shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

async function openLibrary(hash = '') {
  const tabs = await chrome.tabs.query({ url: `${LIB}*` });
  if (tabs[0]?.id) await chrome.tabs.update(tabs[0].id, { active: true, url: LIB + (hash ? `#${hash}` : '') });
  else await chrome.tabs.create({ url: LIB + (hash ? `#${hash}` : '') });
  window.close();
}
$('open').addEventListener('click', () => openLibrary());
$('import').addEventListener('click', () => openLibrary('import'));

(async () => {
  try {
    const [n, packs] = await Promise.all([countStickers(), listPacks()]);
    $('count').textContent = n ? `${n} sticker${n === 1 ? '' : 's'} · ${packs.length} pack${packs.length === 1 ? '' : 's'}` : 'No stickers yet';
  } catch {
    $('count').textContent = '';
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  renderContext(tab);
})();

const isMac = /Mac/.test(navigator.platform);
const shortcut = isMac ? '<kbd>⌥</kbd><kbd>⇧</kbd><kbd>S</kbd>' : '<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>';

async function sendOrInject(tabId, file, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    return chrome.tabs.sendMessage(tabId, msg);
  }
}

async function renderContext(tab) {
  const box = $('context');
  let url;
  try {
    url = new URL(tab?.url || '');
  } catch {
    return;
  }
  const host = url.hostname;

  if (host === 'web.whatsapp.com') {
    box.innerHTML = `<p><b>Collect stickers from WhatsApp Web</b><br><span class="muted">Opens a panel. Then open your sticker tray (😊 → Stickers) and scroll.</span></p><button class="primary" id="collect">Start collecting</button><p class="err" id="werr" hidden></p>`;
    box.hidden = false;
    $('collect').addEventListener('click', async () => {
      try {
        await sendOrInject(tab.id, 'content/whatsapp.js', { type: 'wa:collector', action: 'start' });
        window.close();
      } catch (e) {
        $('werr').hidden = false;
        $('werr').textContent = 'Couldn’t start on this page. Reload WhatsApp Web and try again.';
      }
    });
    return;
  }

  if (host === 'substack.com' || host.endsWith('.substack.com')) {
    box.innerHTML = `<p><b>Ready on Substack</b><br><span class="muted">Click into a Note, reply or comment box and use the sticker button, or press ${shortcut}.</span></p>`;
    box.hidden = false;
    return;
  }

  if (url.protocol !== 'https:') return;

  // Custom-domain Substack publications (e.g. newsletter.example.com).
  const origin = `${url.origin}/*`;
  const id = `custom-${host.replace(/[^a-z0-9.-]/gi, '')}`;
  const granted = await chrome.permissions.contains({ origins: [origin] });
  const regs = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
  const enabled = granted && regs.length > 0;
  box.hidden = false;
  if (enabled) {
    box.innerHTML = `<p><span class="ok">✓ Enabled on ${escapeHtml(host)}</span></p><button class="small" id="disable">Disable on this site</button>`;
    $('disable').addEventListener('click', async () => {
      await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
      await chrome.permissions.remove({ origins: [origin] }).catch(() => {});
      renderContext(tab);
    });
    return;
  }
  // Only offer this on pages that are actually Substack publications, so StickStack is never
  // switched on for unrelated sites (banking, email…) by mistake.
  if (!(await looksLikeSubstack(tab.id))) {
    box.hidden = true;
    return;
  }
  box.innerHTML = `<p><b>Substack publication on its own domain?</b><br><span class="muted">Turn on StickStack for <b>${escapeHtml(host)}</b> to use stickers in its comments and notes.</span></p><button id="enable">Enable on this site</button><p class="err" id="eerr" hidden></p>`;
  $('enable').addEventListener('click', async () => {
    try {
      // The service worker registers the content script in permissions.onAdded — this popup may
      // close while Chrome shows the permission prompt, so it must not be the one doing it.
      const ok = await chrome.permissions.request({ origins: [origin] });
      if (!ok) return;
      setTimeout(() => renderContext(tab), 400);
    } catch (e) {
      $('eerr').hidden = false;
      $('eerr').textContent = String(e?.message || e);
    }
  });
}

/** Uses the temporary activeTab grant from opening the popup; reads nothing but the page's own tags. */
async function looksLikeSubstack(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        !!document.querySelector(
          'link[href^="https://substackcdn.com/"],script[src^="https://substackcdn.com/"],meta[name="generator"][content*="Substack" i],link[rel="alternate"][href*=".substack.com/"]'
        ),
    });
    return r?.result === true;
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
