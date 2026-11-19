// StickStack web converter — the same engine as the extension, running entirely in the browser.
import { expandInputs, filesToInputs, filesFromDataTransfer } from '../extension/lib/unpack.js';
import { imageInfo } from '../extension/lib/sniff.js';
import { renderSticker, capabilities } from '../extension/lib/render.js';
import { getSettings, saveSettings } from '../extension/lib/settings.js';
import { CONFIG, LIMITS } from '../extension/lib/config.js';
import { formatBytes, safeFileName, cleanName, sha256Hex } from '../extension/lib/util.js';
import { zipSync } from '../extension/lib/vendor/fflate.js';

const $ = (s) => document.querySelector(s);
$('#repo').href = CONFIG.repoUrl;
$('#coffee').href = CONFIG.coffeeUrl;
$('#ext').href = CONFIG.repoUrl + '#install';

const items = []; // { id, hash, name, bytes, info, out?, url?, el }
const skipped = [];
let settings;
let busy = Promise.resolve();

if (!capabilities().imageDecoder) {
  $('#warn').hidden = false;
  $('#warn').textContent = 'Heads up: this browser can’t decode animations, so animated stickers will be converted to still images. Chrome, Edge or Android Chrome convert them to GIF.';
}

const OPT = { size: '#o-size', padding: '#o-padding', background: '#o-bg', animatedFormat: '#o-anim' };

(async () => {
  settings = await getSettings();
  for (const [k, sel] of Object.entries(OPT)) {
    const el = $(sel);
    if ([...el.options].some((o) => o.value === String(settings[k]))) el.value = String(settings[k]);
    el.addEventListener('change', async () => {
      settings = await saveSettings({ [k]: k === 'size' || k === 'padding' ? Number(el.value) : el.value });
      rerenderAll();
    });
  }
})();

// ---------- input ----------
$('#pick-files').addEventListener('click', () => $('#in-files').click());
$('#pick-folder').addEventListener('click', () => $('#in-folder').click());
for (const id of ['#in-files', '#in-folder']) {
  $(id).addEventListener('change', (e) => {
    addFiles([...e.target.files]);
    e.target.value = '';
  });
}
const drop = $('#drop');
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('#in-files').click();
  }
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) drop.classList.remove('over');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  addFiles(await filesFromDataTransfer(e.dataTransfer));
});

function addFiles(files) {
  if (!files.length) return;
  busy = busy.then(async () => {
    const inputs = await filesToInputs(files);
    const { items: found, skipped: sk } = expandInputs(inputs);
    skipped.push(...sk);
    for (const it of found) {
      const hash = await sha256Hex(it.bytes);
      if (items.some((x) => x.hash === hash)) {
        skipped.push({ name: it.path, reason: 'Duplicate — already added' });
        continue;
      }
      const info = imageInfo(it.bytes);
      if (info.width && Math.max(info.width, info.height) < LIMITS.minSide) {
        skipped.push({ name: it.path, reason: `Too small to be a sticker (${info.width}×${info.height}px)` });
        continue;
      }
      const item = { id: hash.slice(0, 12), hash, name: cleanName(it.displayName || it.name), bytes: it.bytes, info, mime: it.mime };
      items.push(item);
      item.el = card(item);
      $('#results').appendChild(item.el);
      await convert(item);
    }
    updateToolbar();
    renderSkipped();
  });
}

// ---------- conversion ----------
async function convert(item) {
  item.el.classList.add('busy');
  try {
    item.out = await renderSticker(item.bytes, item.mime, item.info, settings);
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = URL.createObjectURL(item.out.blob);
    item.err = null;
  } catch (e) {
    item.err = e.userMessage || e.message;
    item.out = null;
  }
  item.el.classList.remove('busy');
  fillCard(item);
}

function rerenderAll() {
  busy = busy.then(async () => {
    for (const it of items) await convert(it);
    updateToolbar();
  });
}

// ---------- UI ----------
function card(item) {
  const el = document.createElement('article');
  el.className = 'card';
  el.innerHTML = `<div class="img"></div><div class="meta"></div><div class="row"><button class="dl">Download</button><button class="sh" hidden>Share</button></div>`;
  el.querySelector('.dl').addEventListener('click', () => item.out && saveBlob(item.out.blob, safeFileName(item.name, item.out.ext)));
  el.querySelector('.sh').addEventListener('click', () => share([item]));
  return el;
}

function fillCard(item) {
  const el = item.el;
  const box = el.querySelector('.img');
  box.innerHTML = '';
  const meta = el.querySelector('.meta');
  if (item.err) {
    meta.textContent = `⚠︎ ${item.err}`;
    el.querySelector('.dl').disabled = true;
    return;
  }
  const img = document.createElement('img');
  img.alt = item.name;
  img.src = item.url;
  box.appendChild(img);
  const o = item.out;
  meta.textContent = `${o.ext.toUpperCase()} · ${o.width}×${o.height} · ${formatBytes(o.blob.size)}`;
  meta.title = `${item.name}${o.degraded ? `\n${o.degraded}` : ''}`;
  el.querySelector('.dl').disabled = false;
  el.querySelector('.sh').hidden = !canShare([item]);
}

function updateToolbar() {
  const ok = items.filter((i) => i.out);
  $('#toolbar').hidden = !items.length;
  const anim = ok.filter((i) => i.out.ext === 'gif').length;
  $('#summary').textContent = `${ok.length} converted${anim ? ` · ${anim} animated` : ''}${items.length - ok.length ? ` · ${items.length - ok.length} failed` : ''}`;
  $('#share-all').hidden = !(ok.length > 1 && canShare(ok));
}

function renderSkipped() {
  const d = $('#skipped');
  d.hidden = !skipped.length;
  if (!skipped.length) return;
  d.querySelector('summary').textContent = `${skipped.length} file${skipped.length === 1 ? '' : 's'} skipped — why?`;
  const ul = d.querySelector('ul');
  ul.innerHTML = '';
  for (const s of skipped.slice(0, 200)) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b> — <span></span>';
    li.querySelector('b').textContent = s.name;
    li.querySelector('span').textContent = s.reason;
    ul.appendChild(li);
  }
}

$('#zip-all').addEventListener('click', async () => {
  const files = {};
  const used = new Set();
  for (const it of items.filter((i) => i.out)) {
    let n = safeFileName(it.name, it.out.ext);
    for (let k = 2; used.has(n); k++) n = safeFileName(`${it.name}-${k}`, it.out.ext);
    used.add(n);
    files[n] = [new Uint8Array(await it.out.blob.arrayBuffer()), { level: 0 }]; // already compressed formats
  }
  if (!Object.keys(files).length) return;
  saveBlob(new Blob([zipSync(files)], { type: 'application/zip' }), 'stickers-for-substack.zip');
});
$('#share-all').addEventListener('click', () => share(items.filter((i) => i.out)));
$('#clear').addEventListener('click', () => {
  for (const it of items) if (it.url) URL.revokeObjectURL(it.url);
  items.length = 0;
  skipped.length = 0;
  $('#results').innerHTML = '';
  updateToolbar();
  renderSkipped();
});

function toFiles(list) {
  return list.map((i) => new File([i.out.blob], safeFileName(i.name, i.out.ext), { type: i.out.mime }));
}
function canShare(list) {
  try {
    return !!navigator.canShare && navigator.canShare({ files: toFiles(list.slice(0, 1)) });
  } catch {
    return false;
  }
}
async function share(list) {
  try {
    await navigator.share({ files: toFiles(list) });
  } catch (e) {
    if (e?.name !== 'AbortError') alert('Sharing isn’t available here — use Download instead.');
  }
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// test hook
window.__stickstack = { items, skipped, whenIdle: () => busy };
