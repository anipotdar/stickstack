import * as db from '../lib/db.js';
import { ingest, ensurePack, summarize, DEFAULT_PACK_NAME } from '../lib/ingest.js';
import { filesToInputs, filesFromDataTransfer } from '../lib/unpack.js';
import { renderAndCache, buildBackup } from '../lib/service.js';
import { renderSticker } from '../lib/render.js';
import { getSettings, saveSettings, normalizeSettings, DEFAULT_SETTINGS } from '../lib/settings.js';
import { CONFIG } from '../lib/config.js';
import { formatBytes, safeFileName, cleanName } from '../lib/util.js';
import { zipSync } from '../lib/vendor/fflate.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  stickers: [],
  packs: [],
  view: 'all',
  query: '',
  sort: 'new',
  selected: new Set(),
  lastIndex: -1,
  visible: [],
  urls: new Map(), // id → thumb object URL
};

$('#coffee').href = CONFIG.coffeeUrl;
$('#repo').href = CONFIG.repoUrl;

// ---------------- data ----------------
async function load() {
  const [stickers, packs] = await Promise.all([db.listStickers(), db.listPacks()]);
  // Repair stickers whose pack vanished (e.g. partial restore).
  const ids = new Set(packs.map((p) => p.id));
  const orphans = stickers.filter((s) => !ids.has(s.packId));
  if (orphans.length) {
    const { pack } = await ensurePack(DEFAULT_PACK_NAME);
    await db.updateStickers(orphans.map((o) => o.id), { packId: pack.id });
    orphans.forEach((o) => (o.packId = pack.id));
    if (!ids.has(pack.id)) packs.push(pack);
  }
  state.stickers = stickers;
  state.packs = packs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const live = new Set(stickers.map((s) => s.id));
  for (const [id, url] of state.urls) {
    if (!live.has(id)) {
      URL.revokeObjectURL(url);
      state.urls.delete(id);
    }
  }
  for (const id of [...state.selected]) if (!live.has(id)) state.selected.delete(id);
  if (state.view.startsWith('pack:') && !ids.has(state.view.slice(5)) && !packs.some((p) => `pack:${p.id}` === state.view)) state.view = 'all';
  render();
}

let reloadTimer = 0;
const reloadSoon = () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, 150);
};
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'library:changed') reloadSoon();
  return false;
});
const notifyChanged = () => chrome.runtime.sendMessage({ type: 'library:changed' }).catch(() => {});

// ---------------- rendering ----------------
function visibleList() {
  let list = state.stickers;
  const q = state.query.toLowerCase();
  if (q) {
    const pn = new Map(state.packs.map((p) => [p.id, p.name.toLowerCase()]));
    list = list.filter((s) => s.name.toLowerCase().includes(q) || (pn.get(s.packId) || '').includes(q));
  } else if (state.view === 'fav') list = list.filter((s) => s.fav);
  else if (state.view === 'recent') list = list.filter((s) => s.usedAt);
  else if (state.view.startsWith('pack:')) list = list.filter((s) => s.packId === state.view.slice(5));
  const sorters = {
    new: (a, b) => b.createdAt - a.createdAt,
    old: (a, b) => a.createdAt - b.createdAt,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    used: (a, b) => (b.useCount || 0) - (a.useCount || 0) || b.usedAt - a.usedAt,
  };
  const sort = state.view === 'recent' && !q ? (a, b) => b.usedAt - a.usedAt : sorters[state.sort];
  return [...list].sort(sort);
}

function render() {
  renderSide();
  renderGrid();
  renderSelbar();
}

function renderSide() {
  const st = state.stickers;
  $('#n-all').textContent = st.length;
  $('#n-fav').textContent = st.filter((s) => s.fav).length;
  $('#n-recent').textContent = st.filter((s) => s.usedAt).length;
  $$('.view').forEach((b) => b.classList.toggle('sel', !state.query && b.dataset.view === state.view));
  const nav = $('#packs');
  nav.innerHTML = '';
  if (!state.packs.length) nav.innerHTML = '<p class="muted" style="padding:0 10px;font-size:13px">Packs appear here after you import.</p>';
  for (const p of state.packs) {
    const n = st.filter((s) => s.packId === p.id).length;
    const b = document.createElement('div');
    b.className = 'pack' + (!state.query && state.view === `pack:${p.id}` ? ' sel' : '');
    b.tabIndex = 0;
    b.setAttribute('role', 'button');
    b.dataset.pack = p.id;
    b.innerHTML = `<span class="nm"></span><span class="n">${n}</span><button class="pk-more" title="Pack options" aria-label="Pack options">⋯</button>`;
    $('.nm', b).textContent = p.name;
    b.title = p.author ? `${p.name} — by ${p.author}` : p.name;
    b.addEventListener('click', (e) => {
      if (e.target.closest('.pk-more')) return packMenu(p, n);
      setView(`pack:${p.id}`);
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') setView(`pack:${p.id}`);
    });
    // drop target for moving stickers
    b.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-stickstack')) {
        e.preventDefault();
        b.classList.add('dropok');
      }
    });
    b.addEventListener('dragleave', () => b.classList.remove('dropok'));
    b.addEventListener('drop', async (e) => {
      b.classList.remove('dropok');
      const raw = e.dataTransfer.getData('application/x-stickstack');
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      const ids = JSON.parse(raw);
      await db.updateStickers(ids, { packId: p.id });
      toast(`Moved ${ids.length} to “${p.name}”`);
      await load();
      notifyChanged();
    });
    nav.appendChild(b);
  }
  // move-to select in selection bar + import target
  const opts = state.packs.map((p) => `<option value="${p.id}"></option>`).join('');
  for (const sel of [$('#sel-move'), $('#target-pack')]) {
    const keep = sel.value;
    const first = sel.options[0].outerHTML;
    sel.innerHTML = first + opts + (sel.id === 'sel-move' ? '<option value="__new">＋ New pack…</option>' : '<option value="__new">＋ New pack…</option>');
    state.packs.forEach((p, i) => (sel.options[i + 1].textContent = p.name));
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
  }
}

function setView(v) {
  state.view = v;
  state.query = '';
  $('#search').value = '';
  state.lastIndex = -1;
  render();
  $('main').scrollTo?.(0, 0);
}

function viewTitle() {
  if (state.query) return `Search: “${state.query}”`;
  if (state.view === 'fav') return 'Favourites';
  if (state.view === 'recent') return 'Recently used';
  if (state.view.startsWith('pack:')) return state.packs.find((p) => p.id === state.view.slice(5))?.name || 'Pack';
  return 'All stickers';
}

function thumbURL(s) {
  if (!state.urls.has(s.id)) state.urls.set(s.id, URL.createObjectURL(s.thumb || s.blob));
  return state.urls.get(s.id);
}

function renderGrid() {
  const list = (state.visible = visibleList());
  $('#view-title').textContent = viewTitle();
  $('#view-count').textContent = `${list.length} sticker${list.length === 1 ? '' : 's'}`;
  const grid = $('#grid');
  grid.innerHTML = '';
  const empty = $('#empty');
  if (!list.length) {
    empty.hidden = false;
    if (!state.stickers.length) {
      empty.innerHTML = `<div class="big">🗂️</div><b>Your sticker library is empty</b>Import stickers from your Android phone, WhatsApp Web or a sticker pack.<br><br><button class="primary" id="empty-import">Import stickers</button>`;
      $('#empty-import').addEventListener('click', openImport);
    } else if (state.query) empty.innerHTML = `<b>No matches</b>Try another word, or clear the search.`;
    else if (state.view === 'fav') empty.innerHTML = `<b>No favourites yet</b>Hover a sticker and tap ☆ to keep it handy in the Substack picker.`;
    else if (state.view === 'recent') empty.innerHTML = `<b>Nothing used yet</b>Stickers you add on Substack show up here.`;
    else empty.innerHTML = `<b>This pack is empty</b>Drag stickers onto it in the sidebar, or import into it.`;
    return;
  }
  empty.hidden = true;
  const frag = document.createDocumentFragment();
  list.forEach((s, i) => {
    const t = document.createElement('div');
    t.className = 'tile' + (state.selected.has(s.id) ? ' sel' : '');
    t.dataset.id = s.id;
    t.dataset.i = i;
    t.tabIndex = 0;
    t.draggable = true;
    t.setAttribute('role', 'checkbox');
    t.setAttribute('aria-checked', state.selected.has(s.id));
    t.setAttribute('aria-label', s.name);
    t.innerHTML = `<div class="img"><img loading="lazy" alt=""></div><div class="name"></div>
      <span class="check">✓</span>${s.fav ? '<span class="fav-on" title="Favourite">★</span>' : ''}${s.animated ? '<span class="badge">GIF</span>' : ''}
      <div class="tbtns"><button class="t-fav" title="${s.fav ? 'Unfavourite' : 'Favourite'}">${s.fav ? '★' : '☆'}</button><button class="t-dl" title="Download as it will be posted">⬇</button></div>`;
    $('img', t).src = thumbURL(s);
    $('.name', t).textContent = s.name;
    t.title = `${s.name}\n${s.width}×${s.height} · ${s.kind.toUpperCase()}${s.animated ? ` · ${s.frames} frames` : ''} · ${formatBytes(s.size)}${s.useCount ? ` · used ${s.useCount}×` : ''}`;
    frag.appendChild(t);
  });
  grid.appendChild(frag);
}

// grid interactions (delegated)
$('#grid').addEventListener('click', async (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  const s = state.stickers.find((x) => x.id === t.dataset.id);
  if (!s) return;
  if (e.target.closest('.t-fav')) {
    e.stopPropagation();
    await db.updateStickers([s.id], { fav: !s.fav });
    s.fav = !s.fav;
    render();
    notifyChanged();
    return;
  }
  if (e.target.closest('.t-dl')) {
    e.stopPropagation();
    return downloadStickers([s.id]);
  }
  toggleSelect(Number(t.dataset.i), e.shiftKey);
});
$('#grid').addEventListener('keydown', (e) => {
  const t = e.target.closest('.tile');
  if (t && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    toggleSelect(Number(t.dataset.i), e.shiftKey);
  }
});
// Animated preview on hover — show the original file.
$('#grid').addEventListener('mouseover', (e) => {
  const t = e.target.closest('.tile');
  if (!t || t._anim) return;
  const s = state.stickers.find((x) => x.id === t.dataset.id);
  if (!s?.animated) return;
  t._anim = URL.createObjectURL(s.blob);
  $('img', t).src = t._anim;
  t.addEventListener(
    'mouseleave',
    () => {
      $('img', t).src = thumbURL(s);
      URL.revokeObjectURL(t._anim);
      t._anim = null;
    },
    { once: true }
  );
});
$('#grid').addEventListener('dragstart', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  const ids = state.selected.has(t.dataset.id) ? [...state.selected] : [t.dataset.id];
  e.dataTransfer.setData('application/x-stickstack', JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'move';
});

function toggleSelect(i, range) {
  const list = state.visible;
  const s = list[i];
  if (!s) return;
  if (range && state.lastIndex >= 0) {
    const [a, b] = [Math.min(state.lastIndex, i), Math.max(state.lastIndex, i)];
    const on = !state.selected.has(s.id);
    for (let k = a; k <= b; k++) on ? state.selected.add(list[k].id) : state.selected.delete(list[k].id);
  } else if (state.selected.has(s.id)) state.selected.delete(s.id);
  else state.selected.add(s.id);
  state.lastIndex = i;
  $$('.tile').forEach((t) => {
    const on = state.selected.has(t.dataset.id);
    t.classList.toggle('sel', on);
    t.setAttribute('aria-checked', on);
  });
  renderSelbar();
}

function renderSelbar() {
  const n = state.selected.size;
  $('#selbar').hidden = n === 0;
  $('#sel-count').textContent = `${n} selected`;
  $('#sel-rename').hidden = n !== 1;
  $('#btn-selectall').textContent = n && n === state.visible.length ? 'Select none' : 'Select all';
}

$('#btn-selectall').addEventListener('click', () => {
  if (state.selected.size && state.selected.size === state.visible.length) state.selected.clear();
  else state.visible.forEach((s) => state.selected.add(s.id));
  renderGrid();
  renderSelbar();
});

$('#selbar').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-sel]')?.dataset.sel;
  if (!act) return;
  const ids = [...state.selected];
  if (act === 'clear') {
    state.selected.clear();
    renderGrid();
    renderSelbar();
  } else if (act === 'fav' || act === 'unfav') {
    await db.updateStickers(ids, { fav: act === 'fav' });
    await load();
    notifyChanged();
  } else if (act === 'download') downloadStickers(ids);
  else if (act === 'rename') {
    const s = state.stickers.find((x) => x.id === ids[0]);
    const name = await ask({ title: 'Rename sticker', text: 'Names make stickers easy to find with search in the Substack picker.', input: s.name, ok: 'Rename' });
    if (name === null) return;
    await db.updateStickers(ids, { name: cleanName(name, s.name) });
    await load();
    notifyChanged();
  } else if (act === 'delete') {
    const ok = await ask({ title: `Delete ${ids.length} sticker${ids.length === 1 ? '' : 's'}?`, text: 'This removes them from StickStack on this computer. Notes you already posted are not affected.', ok: 'Delete', danger: true });
    if (ok === null) return;
    await db.deleteStickers(ids);
    state.selected.clear();
    toast(`Deleted ${ids.length} sticker${ids.length === 1 ? '' : 's'}`);
    await load();
    notifyChanged();
  }
});

$('#sel-move').addEventListener('change', async (e) => {
  let packId = e.target.value;
  e.target.value = '';
  if (!packId) return;
  if (packId === '__new') {
    const name = await ask({ title: 'New pack', text: 'Name your pack', input: '', ok: 'Create' });
    if (!name) return;
    packId = (await ensurePack(name)).pack.id;
  }
  const ids = [...state.selected];
  await db.updateStickers(ids, { packId });
  const p = (await db.listPacks()).find((x) => x.id === packId);
  toast(`Moved ${ids.length} to “${p?.name || 'pack'}”`);
  await load();
  notifyChanged();
});

$$('.view').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$('#sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderGrid();
});
let searchTimer = 0;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    state.lastIndex = -1;
    render();
  }, 120);
});

// ---------------- packs ----------------
$('#btn-newpack').addEventListener('click', async () => {
  const name = await ask({ title: 'New pack', text: 'Give it a name — e.g. “Reactions”, “Cats”, “Bollywood”.', input: '', ok: 'Create' });
  if (!name) return;
  const { pack, created } = await ensurePack(name);
  toast(created ? `Created “${pack.name}”` : `“${pack.name}” already exists`);
  await load();
  setView(`pack:${pack.id}`);
});

async function packMenu(p, n) {
  const choice = await ask({ title: p.name, text: `${n} sticker${n === 1 ? '' : 's'}${p.author ? ` · by ${p.author}` : ''}`, input: p.name, ok: 'Rename', extra: { label: 'Delete pack…', value: 'delete' } });
  if (choice === null) return;
  if (choice === '__extra:delete') {
    const keep = await ask({ title: `Delete “${p.name}”?`, text: n ? 'Choose what happens to its stickers.' : 'The pack is empty.', check: n ? 'Also delete its stickers' : null, ok: 'Delete pack', danger: true });
    if (keep === null) return;
    const deleteStickers = keep === '__checked';
    let moveTo = null;
    if (n && !deleteStickers) {
      const fallbackName = p.name.toLowerCase() === DEFAULT_PACK_NAME.toLowerCase() ? 'Unsorted' : DEFAULT_PACK_NAME;
      moveTo = (await ensurePack(fallbackName)).pack.id;
    }
    await db.deletePack(p.id, moveTo);
    toast(deleteStickers || !n ? `Deleted “${p.name}”` : `Deleted “${p.name}” — its stickers moved to another pack`);
    if (state.view === `pack:${p.id}`) state.view = 'all';
  } else {
    const name = cleanName(choice, p.name);
    const clash = state.packs.find((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase());
    if (clash) return toast(`A pack called “${clash.name}” already exists`, 'err');
    await db.putPack({ ...p, name });
  }
  await load();
  notifyChanged();
}

// ---------------- import ----------------
const dlgImport = $('#dlg-import');
let importAbort = null;
let importing = false;

function openImport() {
  if (!dlgImport.open) dlgImport.showModal();
  $('#result').hidden = true;
}
$('#btn-import').addEventListener('click', openImport);
$('#welcome-import').addEventListener('click', openImport);
$('#pick-files').addEventListener('click', () => $('#in-files').click());
$('#pick-folder').addEventListener('click', () => $('#in-folder').click());
$('#in-files').addEventListener('change', (e) => {
  runImport([...e.target.files]);
  e.target.value = '';
});
$('#in-folder').addEventListener('change', (e) => {
  runImport([...e.target.files]);
  e.target.value = '';
});
$('#pcancel').addEventListener('click', () => importAbort?.abort());
dlgImport.addEventListener('cancel', (e) => {
  if (importing) e.preventDefault(); // don't close mid-import with Esc
});
$('#target-pack').addEventListener('change', async (e) => {
  if (e.target.value !== '__new') return;
  const name = await ask({ title: 'New pack', text: 'Imported stickers will go into this pack.', input: '', ok: 'Create' });
  if (!name) return void (e.target.value = '');
  const { pack } = await ensurePack(name);
  await load();
  $('#target-pack').value = pack.id;
});

$$('.gtab').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.gtab').forEach((x) => x.classList.toggle('sel', x === b));
    $$('.guide').forEach((g) => (g.hidden = g.dataset.g !== b.dataset.g));
  })
);

const drop = $('#drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  drop.classList.remove('over');
  runImport(await filesFromDataTransfer(e.dataTransfer));
});
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('#in-files').click();
  }
});

// Drop anywhere on the page.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  if (!dlgImport.open) $('#dropcover').hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('#dropcover').hidden = true;
  }
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropcover').hidden = true;
  const files = await filesFromDataTransfer(e.dataTransfer);
  openImport();
  runImport(files);
});

async function runImport(files, opts = {}) {
  if (!files?.length) return;
  if (importing) return toast('An import is already running — wait for it to finish.', 'err');
  importing = true;
  importAbort = new AbortController();
  const target = $('#target-pack').value;
  $('#progress').hidden = false;
  $('#result').hidden = true;
  $('#pbar').style.width = '0%';
  $('#ptext').textContent = `Reading ${files.length} file${files.length === 1 ? '' : 's'}…`;
  let report;
  try {
    const inputs = await filesToInputs(files);
    navigator.storage?.persist?.().catch(() => {});
    report = await ingest(inputs, {
      targetPackId: target && target !== '__new' ? target : null,
      signal: importAbort.signal,
      onProgress: (done, total, name) => {
        $('#pbar').style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
        $('#ptext').textContent = total ? `${done} / ${total}${name ? ` · ${name}` : ''}` : '';
      },
      ...opts,
    });
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'err');
    report = null;
  } finally {
    importing = false;
    $('#progress').hidden = true;
  }
  if (!report) return;
  showResult(report);
  await load();
  notifyChanged();
  if (report.added.length) {
    $('#welcome').hidden = true;
    chrome.storage.local.set({ welcomed: true });
  }
}

function showResult(r) {
  const box = $('#result');
  box.hidden = false;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  let html = `<b>${r.added.length ? '✓ ' : ''}${esc(summarize(r))}</b>`;
  if (r.packsCreated.length) html += `<span class="muted">New pack${r.packsCreated.length === 1 ? '' : 's'}: ${r.packsCreated.map(esc).join(', ')}</span>`;
  if (r.added.length) html += `<div class="muted">Open Substack and click the sticker button in any Note or reply.</div>`;
  if (r.skipped.length) {
    html += `<details${r.added.length ? '' : ' open'}><summary>Why ${r.skipped.length} file${r.skipped.length === 1 ? ' was' : 's were'} skipped</summary><ul>${r.skipped
      .slice(0, 200)
      .map((s) => `<li><b>${esc(s.name)}</b> — ${esc(s.reason)}</li>`)
      .join('')}</ul></details>`;
  }
  box.innerHTML = html;
}

// ---------------- downloads & backup ----------------
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

async function downloadStickers(ids) {
  try {
    if (ids.length === 1) {
      const s = state.stickers.find((x) => x.id === ids[0]);
      const r = await renderAndCache(ids[0]);
      saveBlob(r.blob, safeFileName(s?.name, r.ext));
      if (r.degraded) toast(r.degraded);
      return;
    }
    toast(`Preparing ${ids.length} stickers…`);
    const files = {};
    const used = new Set();
    for (const id of ids) {
      const s = state.stickers.find((x) => x.id === id);
      const r = await renderAndCache(id);
      let name = safeFileName(s?.name, r.ext);
      for (let k = 2; used.has(name); k++) name = safeFileName(`${s?.name}-${k}`, r.ext);
      used.add(name);
      files[name] = [new Uint8Array(await r.blob.arrayBuffer()), { level: 0 }];
    }
    saveBlob(new Blob([zipSync(files)], { type: 'application/zip' }), 'stickstack-stickers.zip');
  } catch (e) {
    toast(`Download failed: ${e.message}`, 'err');
  }
}

const menu = $('#more-menu');
$('#btn-more').addEventListener('click', (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
});
document.addEventListener('click', (e) => {
  if (!menu.hidden && !e.target.closest('.menu-wrap')) menu.hidden = true;
});
menu.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  menu.hidden = true;
  if (act === 'backup') {
    if (!state.stickers.length) return toast('Nothing to back up yet.');
    toast('Building backup…');
    try {
      const blob = await buildBackup();
      saveBlob(blob, `stickstack-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err) {
      toast(`Backup failed: ${err.message}`, 'err');
    }
  } else if (act === 'restore') $('#in-restore').click();
  else if (act === 'converter') window.open(CONFIG.converterUrl, '_blank', 'noopener');
  else if (act === 'shortcuts') chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  else if (act === 'wipe') {
    const typed = await ask({ title: 'Delete everything?', text: `This permanently deletes all ${state.stickers.length} stickers and ${state.packs.length} packs from StickStack. Type DELETE to confirm. (Tip: export a backup first.)`, input: '', ok: 'Delete everything', danger: true });
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'DELETE') return toast('Nothing deleted — you didn’t type DELETE.');
    await db.clearAll();
    state.selected.clear();
    toast('Library cleared');
    await load();
    notifyChanged();
  }
});
$('#in-restore').addEventListener('change', (e) => {
  const f = [...e.target.files];
  e.target.value = '';
  if (!f.length) return;
  openImport();
  $('#target-pack').value = '';
  runImport(f);
});

// ---------------- settings ----------------
const dlgSettings = $('#dlg-settings');
const form = {
  get: () => {
    const v = {};
    for (const el of $$('.fields [name]', dlgSettings)) v[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    return normalizeSettings(v);
  },
  set: (s) => {
    for (const el of $$('.fields [name]', dlgSettings)) {
      if (el.type === 'checkbox') el.checked = !!s[el.name];
      else el.value = String(s[el.name]);
    }
    syncSettingsUI();
  },
};
function syncSettingsUI() {
  const s = form.get();
  $('#pad-val').textContent = `${Math.round(s.padding * 100)}%`;
  $('.custom-bg', dlgSettings).hidden = s.background !== 'custom';
}
$('#btn-settings').addEventListener('click', async () => {
  form.set(await getSettings());
  dlgSettings.showModal();
  updatePreview();
  try {
    const est = await navigator.storage.estimate();
    $('#storage').textContent = `Using ${formatBytes(est.usage || 0)} of local storage for ${state.stickers.length} stickers.`;
  } catch {}
});
let pvTimer = 0;
let pvURL = null;
dlgSettings.addEventListener('input', () => {
  syncSettingsUI();
  clearTimeout(pvTimer);
  pvTimer = setTimeout(updatePreview, 200);
});
async function updatePreview() {
  const s = form.get();
  const sample = state.stickers.find((x) => x.animated && s.animatedFormat !== 'static') || state.stickers[0];
  if (!sample) {
    $('#pv-info').textContent = 'Import a sticker to see a preview.';
    return;
  }
  $('#pv-info').textContent = 'Rendering…';
  try {
    const bytes = new Uint8Array(await sample.blob.arrayBuffer());
    const out = await renderSticker(bytes, sample.mime, { type: sample.kind, animated: sample.animated, frames: sample.frames, width: sample.width, height: sample.height }, s);
    if (pvURL) URL.revokeObjectURL(pvURL);
    pvURL = URL.createObjectURL(out.blob);
    $('#pv-img').src = pvURL;
    $('#pv-img2').src = pvURL;
    $('#pv-info').textContent = `${out.ext.toUpperCase()} · ${out.width}×${out.height} · ${formatBytes(out.blob.size)}${out.frames > 1 ? ` · ${out.frames} frames` : ''}${out.overBudget ? ' · over size limit' : ''}`;
  } catch (e) {
    $('#pv-info').textContent = `Preview failed: ${e.userMessage || e.message}`;
  }
}
$('#settings-reset').addEventListener('click', () => {
  form.set(DEFAULT_SETTINGS);
  updatePreview();
});
$('#settings-save').addEventListener('click', async () => {
  const before = await getSettings();
  const next = await saveSettings(form.get());
  if (JSON.stringify(before) !== JSON.stringify(next)) await db.clearRenders().catch(() => {});
  dlgSettings.close();
  toast('Settings saved');
});

// ---------------- dialogs & toasts ----------------
const dlgAsk = $('#dlg-ask');
/**
 * Prompt/confirm. Resolves to: input value (prompt), '__checked'/'' (confirm with checkbox), 'ok' (confirm),
 * '__extra:<value>' for the extra button, or null if cancelled.
 */
function ask({ title, text = '', input = null, ok = 'OK', danger = false, check = null, extra = null }) {
  return new Promise((resolve) => {
    $('#ask-title').textContent = title;
    $('#ask-text').textContent = text;
    const inp = $('#ask-input');
    inp.hidden = input === null;
    inp.value = input ?? '';
    $('#ask-check-wrap').hidden = !check;
    $('#ask-check').checked = false;
    $('#ask-check-label').textContent = check || '';
    const okBtn = $('#ask-ok');
    okBtn.textContent = ok;
    okBtn.classList.toggle('danger', danger);
    okBtn.classList.toggle('primary', !danger);
    let extraBtn = $('#ask-extra');
    extraBtn?.remove();
    if (extra) {
      extraBtn = document.createElement('button');
      extraBtn.id = 'ask-extra';
      extraBtn.value = `__extra:${extra.value}`;
      extraBtn.className = 'danger';
      extraBtn.textContent = extra.label;
      extraBtn.style.marginRight = 'auto';
      $('.dlg-foot', dlgAsk).prepend(extraBtn);
    }
    dlgAsk.returnValue = '';
    dlgAsk.showModal();
    if (input !== null) {
      inp.focus();
      inp.select();
    }
    dlgAsk.addEventListener(
      'close',
      () => {
        const v = dlgAsk.returnValue;
        if (v.startsWith('__extra:')) return resolve(v);
        if (v !== 'ok') return resolve(null);
        if (input !== null) return resolve(inp.value.trim() ? inp.value : null);
        if (check) return resolve($('#ask-check').checked ? '__checked' : '');
        resolve('ok');
      },
      { once: true }
    );
  });
}
$('#ask-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    dlgAsk.close('ok');
  }
});

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 3) $('#toasts').firstElementChild.remove();
  setTimeout(() => el.remove(), 4500);
}

// ---------------- keyboard ----------------
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('#search').focus();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && !typing) {
    e.preventDefault();
    state.visible.forEach((s) => state.selected.add(s.id));
    renderGrid();
    renderSelbar();
  } else if (e.key === 'Escape' && state.selected.size) {
    state.selected.clear();
    renderGrid();
    renderSelbar();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected.size && !typing) {
    e.preventDefault();
    $('[data-sel="delete"]').click();
  }
});

// ---------------- boot ----------------
(async () => {
  await load();
  const { welcomed } = await chrome.storage.local.get('welcomed');
  if (!welcomed && (new URLSearchParams(location.search).has('welcome') || !state.stickers.length)) $('#welcome').hidden = false;
  $('#welcome-close').addEventListener('click', () => {
    $('#welcome').hidden = true;
    chrome.storage.local.set({ welcomed: true });
  });
  const route = () => {
    if (location.hash === '#import') {
      openImport();
      history.replaceState(null, '', location.pathname + location.search);
    }
  };
  route();
  window.addEventListener('hashchange', route);
})();
