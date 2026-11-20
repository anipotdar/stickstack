// StickStack — Substack integration.
// Adds a sticker button to Substack editors (Notes, replies, comments, posts) and attaches the
// chosen sticker exactly like a user upload would: paste → file input → drop, with verification.
// Plain script (content scripts can't be ES modules). Everything UI lives in one shadow root.
(() => {
  'use strict';

  // ---------- single instance (survives extension reloads/updates) ----------
  const prev = window.__stickstackSubstack;
  if (prev && prev.alive()) return;
  try {
    prev?.destroy?.();
  } catch {}
  document.querySelectorAll('[data-stickstack-host]').forEach((n) => n.remove());

  // 'closed' keeps page scripts out of our UI (they could otherwise read the sticker library).
  // test/browser/run_extension.py switches this to 'open' in its temporary copy.
  const SHADOW_MODE = 'closed';
  const MAX_IMAGES = 6;
  const VERIFY_MS = 2600;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const SHORTCUT = isMac ? '⌥⇧S' : 'Alt+Shift+S';

  let dead = false;
  const runtimeAlive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  // ---------- messaging ----------
  async function send(msg) {
    if (dead || !runtimeAlive()) {
      onInvalidated();
      throw new Error('StickStack was updated — refresh this page.');
    }
    let r;
    try {
      r = await chrome.runtime.sendMessage(msg);
    } catch (e) {
      if (!runtimeAlive() || /context invalidated/i.test(String(e?.message))) {
        onInvalidated();
        throw new Error('StickStack was updated — refresh this page.');
      }
      throw e;
    }
    if (!r) throw new Error('StickStack didn’t respond. Try again.');
    if (!r.ok) throw new Error(r.error || 'Something went wrong');
    return r;
  }

  // ---------- styles & DOM ----------
  const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M5 3h10.6L21 8.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm9 1.6V8a2 2 0 0 0 2 2h3.4L14 4.6ZM8.5 12.2a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Zm6 0a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Zm-7 2.3c.8 1.9 2.5 3 4.5 3s3.7-1.1 4.5-3H7.5Z"/></svg>`;

  const STYLE = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .light{--bg:#fff;--fg:#1a1a1a;--mut:#6b7280;--line:#e1e5ec;--hov:#eef1f6;--acc:#4f63d2;--accfg:#fff;--shadow:0 12px 40px rgba(15, 23, 42,.18),0 2px 8px rgba(15, 23, 42,.08)}
  .dark{--bg:#171a20;--fg:#e8ebf0;--mut:#9aa1ad;--line:#2a2f38;--hov:#22262e;--acc:#8b9bf5;--accfg:#0c1020;--shadow:0 12px 40px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.3)}
  .fab{position:fixed;width:30px;height:30px;border-radius:50%;border:1px solid var(--line);background:var(--bg);color:var(--acc);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12);opacity:.72;transition:opacity .15s,transform .15s;padding:0;z-index:3}
  .fab:hover,.fab:focus-visible,.fab.on{opacity:1;transform:scale(1.06)}
  .fab:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
  .fab[hidden]{display:none}
  .picker{position:fixed;width:348px;max-width:calc(100vw - 16px);height:420px;max-height:calc(100vh - 16px);background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden;z-index:4;font-size:13px}
  .picker[hidden]{display:none}
  .top{display:flex;gap:6px;padding:10px 10px 6px;align-items:center}
  .search{flex:1;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--hov);color:var(--fg);padding:0 10px;font-size:13px;outline:none}
  .search:focus{border-color:var(--acc)}
  .icon-btn{height:32px;min-width:32px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--mut);cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center}
  .icon-btn:hover{background:var(--hov);color:var(--fg)}
  .tabs{display:flex;gap:4px;padding:0 10px 6px;overflow-x:auto;scrollbar-width:none;flex-shrink:0}
  .tabs::-webkit-scrollbar{display:none}
  .tab{flex-shrink:0;border:0;background:transparent;color:var(--mut);padding:5px 9px;border-radius:999px;cursor:pointer;font-size:12px;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis}
  .tab:hover{background:var(--hov);color:var(--fg)}
  .tab.sel{background:var(--acc);color:var(--accfg);font-weight:600}
  .grid{flex:1;overflow-y:auto;padding:4px 8px 8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));grid-auto-rows:76px;gap:4px;align-content:start}
  .cell{position:relative;border:0;border-radius:10px;background:transparent;cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center}
  .cell:hover,.cell:focus-visible{background:var(--hov);outline:none}
  .cell:focus-visible{box-shadow:inset 0 0 0 2px var(--acc)}
  .cell img{max-width:100%;max-height:100%;object-fit:contain;pointer-events:none;-webkit-user-drag:none}
  .cell .ph{width:40px;height:40px;border-radius:8px;background:var(--hov)}
  .badge{position:absolute;right:4px;bottom:4px;font-size:9px;font-weight:700;letter-spacing:.03em;background:rgba(0,0,0,.55);color:#fff;padding:1px 4px;border-radius:4px}
  .cell.busy::after{content:"";position:absolute;inset:0;border-radius:10px;background:rgba(127,127,127,.25)}
  .cell.busy::before{content:"";position:absolute;width:22px;height:22px;border-radius:50%;border:3px solid var(--acc);border-top-color:transparent;animation:spin .8s linear infinite;z-index:1}
  @keyframes spin{to{transform:rotate(360deg)}}
  .empty{grid-column:1/-1;text-align:center;color:var(--mut);padding:36px 16px;line-height:1.5}
  .empty b{color:var(--fg);display:block;font-size:14px;margin-bottom:4px}
  .btn{margin-top:12px;border:0;background:var(--acc);color:var(--accfg);font-weight:600;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px}
  .foot{border-top:1px solid var(--line);padding:7px 10px;color:var(--mut);font-size:11px;display:flex;justify-content:space-between;gap:8px;flex-shrink:0}
  .toasts{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;z-index:5;pointer-events:none}
  .toast{pointer-events:auto;background:#171a20;color:#e8ebf0;padding:10px 14px;border-radius:10px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:min(460px,calc(100vw - 32px));display:flex;gap:12px;align-items:center;line-height:1.4;animation:in .18s ease-out}
  .toast.err{background:#7a2230}
  .toast button{background:transparent;border:1px solid rgba(255,255,255,.35);color:inherit;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;white-space:nowrap}
  @keyframes in{from{opacity:0;transform:translateY(6px)}}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  `;

  const hostEl = document.createElement('div');
  hostEl.setAttribute('data-stickstack-host', '');
  hostEl.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
  const root = hostEl.attachShadow({ mode: SHADOW_MODE });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="wrap light">
      <button class="fab" type="button" hidden aria-label="Add a sticker (${SHORTCUT})" title="Stickers (${SHORTCUT})">${ICON}</button>
      <div class="picker" hidden role="dialog" aria-label="StickStack stickers">
        <div class="top">
          <input class="search" type="search" placeholder="Search stickers" aria-label="Search stickers" autocomplete="off" spellcheck="false">
          <button class="icon-btn manage" type="button" title="Manage library" aria-label="Manage library">⚙︎</button>
          <button class="icon-btn close" type="button" title="Close (Esc)" aria-label="Close">✕</button>
        </div>
        <div class="tabs" role="tablist"></div>
        <div class="grid" role="listbox" aria-label="Stickers"></div>
        <div class="foot"><span class="hint">Click to attach · Shift+click for several</span><span class="count"></span></div>
      </div>
      <div class="toasts" aria-live="polite"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const wrap = $('.wrap');
  const fab = $('.fab');
  const picker = $('.picker');
  const search = $('.search');
  const tabsEl = $('.tabs');
  const grid = $('.grid');
  const countEl = $('.count');
  const toasts = $('.toasts');

  // Keep the page's keyboard shortcuts and "click outside to close" handlers away from our UI.
  for (const ev of ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut', 'wheel']) picker.addEventListener(ev, (e) => e.stopPropagation());
  for (const ev of ['mousedown', 'pointerdown', 'mouseup', 'pointerup', 'click', 'focusin', 'focusout', 'touchstart']) {
    hostEl.addEventListener(ev, (e) => e.stopPropagation());
  }

  // ---------- mounting & geometry ----------
  // Mount inside the editor's dialog (if any) so modal focus-traps and outside-click handlers
  // treat our UI as part of the dialog. Compensate for transformed ancestors.
  function mountFor(editor) {
    const dialog = editor?.closest?.('[role="dialog"],[aria-modal="true"],dialog');
    const target = dialog || document.body || document.documentElement;
    if (hostEl.parentNode !== target) target.appendChild(hostEl);
  }
  function origin() {
    const r = hostEl.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  function applyTheme() {
    let dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const c = getComputedStyle(document.body || document.documentElement).backgroundColor;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
    if (m && (m[4] === undefined || Number(m[4]) > 0.5)) {
      const lum = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
      dark = lum < 0.45;
    }
    wrap.classList.toggle('dark', dark);
    wrap.classList.toggle('light', !dark);
  }

  // ---------- editor detection ----------
  let activeEditor = null;
  let settings = { closeOnInsert: true, showButton: true };
  const insertedCount = new WeakMap();

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function resolveEditor(node) {
    if (!node) return null;
    if (node.nodeType !== 1) node = node.parentElement;
    if (!node || node === hostEl || hostEl.contains(node)) return null;
    if (node.tagName === 'TEXTAREA') return !node.disabled && !node.readOnly && findImageInputs(node) ? node : null;
    if (!node.isContentEditable) return null;
    let ed = node;
    while (ed.parentElement && ed.parentElement.isContentEditable) ed = ed.parentElement;
    const r = ed.getBoundingClientRect();
    if (r.width < 60 || r.height < 14) return null;
    return ed;
  }

  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  function setActive(ed) {
    if (activeEditor !== ed) {
      activeEditor = ed;
      observeEditor(ed);
    }
    if (settings.showButton !== false) showFab();
  }

  let ro = null;
  function observeEditor(ed) {
    ro?.disconnect();
    if (!ed || typeof ResizeObserver !== 'function') return;
    ro = new ResizeObserver(schedulePosition);
    ro.observe(ed);
  }

  document.addEventListener(
    'focusin',
    (e) => {
      if (dead) return;
      const ed = resolveEditor(e.composedPath?.()[0] || e.target);
      if (ed) setActive(ed);
    },
    true
  );
  document.addEventListener(
    'focusout',
    () => {
      if (!dead) setTimeout(maybeHideFab, 250);
    },
    true
  );

  let fabHover = false;
  fab.addEventListener('mouseenter', () => (fabHover = true));
  fab.addEventListener('mouseleave', () => {
    fabHover = false;
    setTimeout(maybeHideFab, 400);
  });

  function maybeHideFab() {
    if (dead || !picker.hidden || fabHover) return;
    if (activeEditor && resolveEditor(deepActive()) === activeEditor) return;
    fab.hidden = true;
  }

  function showFab() {
    if (!activeEditor || !activeEditor.isConnected) return;
    mountFor(activeEditor);
    applyTheme();
    fab.hidden = false;
    positionAll();
  }

  let raf = 0;
  function schedulePosition() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      positionAll();
    });
  }
  window.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
  window.addEventListener('resize', schedulePosition, { passive: true });

  function positionAll() {
    if (!activeEditor) return;
    if (!activeEditor.isConnected) {
      fab.hidden = true;
      closePicker(false);
      activeEditor = null;
      return;
    }
    const o = origin();
    const r = activeEditor.getBoundingClientRect();
    const vw = innerWidth;
    const vh = innerHeight;
    const offscreen = r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw;
    if (offscreen) {
      fab.style.visibility = 'hidden';
    } else {
      fab.style.visibility = '';
      // Top-right corner of the visible part of the editor.
      const size = 30;
      let x = Math.min(r.right, vw) - size - 4;
      let y = Math.max(r.top, 0) + 4;
      if (r.height < size + 8) y = r.top + (r.height - size) / 2;
      x = Math.max(4, Math.min(vw - size - 4, x));
      y = Math.max(4, Math.min(vh - size - 4, y));
      fab.style.left = `${x - o.x}px`;
      fab.style.top = `${y - o.y}px`;
    }
    if (!picker.hidden) positionPicker();
  }

  function positionPicker() {
    const o = origin();
    const fr = fab.getBoundingClientRect();
    const anchor = fab.hidden || fab.style.visibility === 'hidden' ? activeEditor.getBoundingClientRect() : fr;
    const pw = Math.min(348, innerWidth - 16);
    const ph = Math.min(420, innerHeight - 16);
    let x = anchor.right - pw;
    let y = anchor.bottom + 6;
    if (y + ph > innerHeight - 8) y = anchor.top - ph - 6;
    if (y < 8) y = Math.max(8, innerHeight - ph - 8);
    x = Math.max(8, Math.min(innerWidth - pw - 8, x));
    picker.style.left = `${x - o.x}px`;
    picker.style.top = `${y - o.y}px`;
  }

  // ---------- picker data ----------
  let lib = null; // { stickers, packs }
  let tab = null;
  let query = '';
  const thumbCache = new Map();
  const fileCache = new Map(); // id → File (prepared for drag)

  async function loadLibrary() {
    const r = await send({ type: 'library:list' });
    settings = r.settings || settings;
    lib = { stickers: r.stickers || [], packs: (r.packs || []).sort((a, b) => a.name.localeCompare(b.name)) };
    const live = new Set(lib.stickers.map((s) => s.id));
    for (const k of thumbCache.keys()) if (!live.has(k)) thumbCache.delete(k);
  }

  function tabsList() {
    const t = [];
    const st = lib.stickers;
    if (st.some((s) => s.usedAt)) t.push({ id: 'recent', label: '🕘 Recent' });
    if (st.some((s) => s.fav)) t.push({ id: 'fav', label: '★ Favourites' });
    t.push({ id: 'all', label: `All ${st.length}` });
    for (const p of lib.packs) {
      const n = st.filter((s) => s.packId === p.id).length;
      if (n) t.push({ id: `pack:${p.id}`, label: p.name, title: `${p.name} (${n})` });
    }
    return t;
  }

  function filtered() {
    let st = lib.stickers;
    if (query) {
      const q = query.toLowerCase();
      const packName = new Map(lib.packs.map((p) => [p.id, p.name.toLowerCase()]));
      return st.filter((s) => s.name.toLowerCase().includes(q) || (packName.get(s.packId) || '').includes(q)).sort((a, b) => b.createdAt - a.createdAt);
    }
    if (tab === 'recent') return st.filter((s) => s.usedAt).sort((a, b) => b.usedAt - a.usedAt).slice(0, 48);
    if (tab === 'fav') return st.filter((s) => s.fav).sort((a, b) => b.createdAt - a.createdAt);
    if (tab?.startsWith('pack:')) {
      const id = tab.slice(5);
      return st.filter((s) => s.packId === id).sort((a, b) => a.createdAt - b.createdAt);
    }
    return [...st].sort((a, b) => b.createdAt - a.createdAt);
  }

  function renderTabs() {
    const list = tabsList();
    // Default like WhatsApp: Recent first, otherwise everything. Favourites stay one tap away.
    if (!list.some((t) => t.id === tab)) tab = list.some((t) => t.id === 'recent') ? 'recent' : 'all';
    tabsEl.innerHTML = '';
    for (const t of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (t.id === tab && !query ? ' sel' : '');
      b.textContent = t.label;
      b.title = t.title || t.label;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => {
        tab = t.id;
        query = '';
        search.value = '';
        renderTabs();
        renderGrid();
      });
      tabsEl.appendChild(b);
    }
    tabsEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  let io = null;
  let pendingThumbs = new Set();
  let thumbTimer = 0;

  function renderGrid() {
    io?.disconnect();
    grid.innerHTML = '';
    if (!lib.stickers.length) {
      grid.innerHTML = `<div class="empty"><b>No stickers yet</b>Import your WhatsApp stickers — from your Android phone, WhatsApp Web or a .wastickers pack.<br><button class="btn" type="button">Import stickers</button></div>`;
      grid.querySelector('.btn').addEventListener('click', () => openLibrary('import'));
      countEl.textContent = '';
      return;
    }
    const items = filtered();
    countEl.textContent = `${items.length} sticker${items.length === 1 ? '' : 's'}`;
    if (!items.length) {
      grid.innerHTML = `<div class="empty"><b>Nothing here</b>${query ? 'No stickers match your search.' : 'Star stickers in the library to see them here.'}</div>`;
      return;
    }
    io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const id = en.target.dataset.id;
          io.unobserve(en.target);
          if (thumbCache.has(id)) setThumb(en.target, thumbCache.get(id));
          else pendingThumbs.add(id);
        }
        if (pendingThumbs.size && !thumbTimer) thumbTimer = setTimeout(flushThumbs, 30);
      },
      { root: grid, rootMargin: '200px' }
    );
    const frag = document.createDocumentFragment();
    items.forEach((s, i) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'cell';
      c.dataset.id = s.id;
      c.title = s.name;
      c.setAttribute('role', 'option');
      c.setAttribute('aria-label', s.name + (s.animated ? ' (animated)' : ''));
      c.tabIndex = i === 0 ? 0 : -1;
      c.draggable = true;
      c.innerHTML = `<span class="ph"></span>${s.animated ? '<span class="badge">GIF</span>' : ''}`;
      frag.appendChild(c);
    });
    grid.appendChild(frag);
    grid.querySelectorAll('.cell').forEach((c) => io.observe(c));
  }

  function setThumb(cell, url) {
    const ph = cell.querySelector('.ph');
    if (!ph) return;
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    ph.replaceWith(img);
  }

  async function flushThumbs() {
    thumbTimer = 0;
    const ids = [...pendingThumbs].slice(0, 60);
    ids.forEach((id) => pendingThumbs.delete(id));
    if (!ids.length) return;
    try {
      const { thumbs } = await send({ type: 'library:thumbs', ids });
      for (const [id, url] of Object.entries(thumbs || {})) {
        thumbCache.set(id, url);
        const cell = grid.querySelector(`.cell[data-id="${CSS.escape(id)}"]`);
        if (cell) setThumb(cell, url);
      }
    } catch {}
    if (pendingThumbs.size) thumbTimer = setTimeout(flushThumbs, 30);
  }

  // ---------- open / close ----------
  async function openPicker() {
    if (dead) return;
    if (!activeEditor || !activeEditor.isConnected) {
      const ed = resolveEditor(deepActive());
      if (ed) setActive(ed);
    }
    if (!activeEditor) {
      toast('Click into a Substack note, reply or comment box first, then open stickers.');
      return;
    }
    mountFor(activeEditor);
    applyTheme();
    picker.hidden = false;
    fab.classList.add('on');
    positionPicker();
    grid.innerHTML = '<div class="empty">Loading…</div>';
    try {
      await loadLibrary();
    } catch (e) {
      grid.innerHTML = `<div class="empty"><b>Couldn’t load stickers</b>${escapeHtml(e.message)}</div>`;
      return;
    }
    renderTabs();
    renderGrid();
    // Don't fight a modal's focus trap: only focus our search box when the editor isn't in a dialog.
    if (!activeEditor.closest('[role="dialog"],[aria-modal="true"],dialog')) search.focus({ preventScroll: true });
    else grid.querySelector('.cell')?.focus({ preventScroll: true });
  }

  function closePicker(refocus = true) {
    if (picker.hidden) return;
    picker.hidden = true;
    fab.classList.remove('on');
    io?.disconnect();
    if (refocus && activeEditor?.isConnected) activeEditor.focus({ preventScroll: true });
    setTimeout(maybeHideFab, 300);
  }

  const togglePicker = () => (picker.hidden ? openPicker() : closePicker());

  fab.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's caret
  fab.addEventListener('click', togglePicker);
  $('.close').addEventListener('click', () => closePicker());
  $('.manage').addEventListener('click', () => openLibrary(''));
  search.addEventListener('input', () => {
    query = search.value.trim();
    renderTabs();
    renderGrid();
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      if (picker.hidden) return;
      const path = e.composedPath();
      if (path.includes(hostEl)) return;
      closePicker(false);
    },
    true
  );

  picker.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePicker();
      return;
    }
    const cells = [...grid.querySelectorAll('.cell')];
    const i = cells.indexOf(root.activeElement);
    if (e.target === search && (e.key === 'ArrowDown' || e.key === 'Enter') && cells.length) {
      e.preventDefault();
      if (e.key === 'Enter') return void pick(cells[0].dataset.id, cells[0], e.shiftKey);
      return void focusCell(cells, 0);
    }
    if (i < 0) return;
    const cols = Math.max(1, Math.round(grid.clientWidth / (cells[0].offsetWidth + 4)));
    const map = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    if (map[e.key] !== undefined) {
      e.preventDefault();
      const n = i + map[e.key];
      if (n < 0 && e.key === 'ArrowUp') return void search.focus();
      focusCell(cells, Math.max(0, Math.min(cells.length - 1, n)));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(cells[i].dataset.id, cells[i], e.shiftKey);
    }
  });
  function focusCell(cells, n) {
    cells.forEach((c, k) => (c.tabIndex = k === n ? 0 : -1));
    cells[n].focus();
    cells[n].scrollIntoView({ block: 'nearest' });
  }

  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) pick(cell.dataset.id, cell, e.shiftKey);
  });

  // Prepare on hover so drag-and-drop has the file ready (dragstart must be synchronous).
  let hoverTimer = 0;
  grid.addEventListener('pointerover', (e) => {
    const cell = e.target.closest('.cell');
    clearTimeout(hoverTimer);
    if (!cell || fileCache.has(cell.dataset.id)) return;
    hoverTimer = setTimeout(() => prepare(cell.dataset.id).catch(() => {}), 250);
  });
  grid.addEventListener('dragstart', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const file = fileCache.get(cell.dataset.id);
    if (!file) {
      e.preventDefault();
      toast('Preparing this sticker… try dragging again in a moment.');
      prepare(cell.dataset.id).catch(() => {});
      return;
    }
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.items.add(file);
    const img = cell.querySelector('img');
    if (img) e.dataTransfer.setDragImage(img, 32, 32);
  });

  // ---------- preparing & inserting ----------
  const preparing = new Map();
  function prepare(id) {
    if (fileCache.has(id)) return Promise.resolve(fileCache.get(id));
    if (preparing.has(id)) return preparing.get(id);
    const p = send({ type: 'sticker:render', id })
      .then((r) => {
        const bin = atob(r.b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const file = new File([u8], fileName(r.name, r.ext), { type: r.mime, lastModified: Date.now() });
        file._degraded = r.degraded;
        if (fileCache.size > 40) fileCache.delete(fileCache.keys().next().value);
        fileCache.set(id, file);
        return file;
      })
      .finally(() => preparing.delete(id));
    preparing.set(id, p);
    return p;
  }

  function fileName(name, ext) {
    const base = String(name || 'sticker')
      .normalize('NFKD')
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40);
    return `${base || 'sticker'}.${ext}`;
  }

  let queue = Promise.resolve();
  function pick(id, cell, keepOpen) {
    const editor = activeEditor;
    if (!editor?.isConnected) {
      toast('The box you were typing in is gone. Click into it again.');
      return;
    }
    cell?.classList.add('busy');
    queue = queue
      .then(async () => {
        let file;
        try {
          file = await prepare(id);
        } catch (e) {
          toast(e.message || 'Couldn’t prepare this sticker', 'err');
          return;
        }
        const n = insertedCount.get(editor) || 0;
        if (n >= MAX_IMAGES) toast(`Heads up: Substack Notes take up to ${MAX_IMAGES} images — this one may be rejected.`);
        const res = await insert(editor, file);
        if (res.ok) {
          insertedCount.set(editor, n + 1);
          if (file._degraded) toast(file._degraded);
          if (!keepOpen && settings.closeOnInsert !== false) closePicker();
        } else {
          await fallback(file);
        }
      })
      .finally(() => cell?.classList.remove('busy'));
  }

  function isImageInput(inp) {
    if (inp.type !== 'file' || inp.disabled) return false;
    const a = (inp.accept || '').toLowerCase();
    return !a || /image|\.png|\.gif|\.jpe?g|\.webp/.test(a);
  }

  function acceptsFile(inp, file) {
    const a = (inp.accept || '').toLowerCase().trim();
    if (!a) return true;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return a.split(',').some((t) => {
      t = t.trim();
      return t === file.type || t === ext || (t.endsWith('/*') && file.type.startsWith(t.slice(0, -1)));
    });
  }

  /** Nearest image file inputs that unambiguously belong to this editor's composer. */
  function findImageInputs(editor) {
    let node = editor.parentElement;
    for (let depth = 0; node && depth < 10 && node !== document.documentElement; depth++, node = node.parentElement) {
      const inputs = [...node.querySelectorAll('input[type="file"]')].filter(isImageInput);
      if (!inputs.length) continue;
      const others = [...node.querySelectorAll('[contenteditable="true"],textarea')].filter((el) => el !== editor && !editor.contains(el) && !el.contains(editor) && visible(el));
      return others.length ? null : inputs; // another editor in scope → can't be sure which composer owns it
    }
    return null;
  }

  function composerRegion(editor) {
    let node = editor;
    for (let i = 0; i < 6 && node.parentElement && node.parentElement !== document.body; i++) node = node.parentElement;
    return editor.closest('[role="dialog"],[aria-modal="true"],dialog,form') || node;
  }

  /** Resolve true when something that looks like an attachment shows up near the editor. */
  function watchForAttachment(editor, ms) {
    return new Promise((resolve) => {
      const region = composerRegion(editor);
      const er = editor.getBoundingClientRect();
      const near = (el) => {
        if (region.contains(el)) return true;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return false;
        return r.bottom > er.top - 300 && r.top < er.bottom + 500 && r.right > er.left - 300 && r.left < er.right + 300;
      };
      const looksLikeMedia = (el) => {
        if (el.nodeType !== 1 || el === hostEl || hostEl.contains(el)) return false;
        const cands = [el, ...el.querySelectorAll('img,video,canvas,[role="progressbar"],[aria-busy="true"],progress')];
        return cands.some((c) => {
          const tag = c.tagName;
          if (tag === 'IMG') {
            const src = c.getAttribute('src') || '';
            const w = c.width || c.getBoundingClientRect().width;
            return (src.startsWith('blob:') || src.startsWith('data:image') || w > 40 || !c.complete) && near(c);
          }
          if (tag === 'VIDEO' || tag === 'CANVAS' || tag === 'PROGRESS') return near(c);
          return (c.getAttribute('role') === 'progressbar' || c.getAttribute('aria-busy') === 'true') && near(c);
        });
      };
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        mo.disconnect();
        clearTimeout(t);
        resolve(v);
      };
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'attributes' && m.target.tagName === 'IMG' && looksLikeMedia(m.target)) return finish(true);
          for (const n of m.addedNodes) if (looksLikeMedia(n)) return finish(true);
        }
      });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      const t = setTimeout(() => finish(false), ms);
    });
  }

  function dataTransferWith(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    return dt;
  }

  const strategies = {
    async paste(editor, file) {
      editor.focus({ preventScroll: true });
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: dataTransferWith(file) });
      const seen = watchForAttachment(editor, VERIFY_MS);
      editor.dispatchEvent(ev);
      // ProseMirror-based editors call preventDefault only when a handler took the paste.
      if (ev.defaultPrevented) return true;
      return seen;
    },
    async input(editor, file) {
      const inputs = findImageInputs(editor);
      const input = inputs?.find((i) => acceptsFile(i, file));
      if (!input) return false;
      const seen = watchForAttachment(editor, VERIFY_MS);
      try {
        input.files = dataTransferWith(file).files;
      } catch {
        return false;
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return seen;
    },
    async drop(editor, file) {
      const r = editor.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + Math.min(r.height / 2, 40), dataTransfer: dataTransferWith(file) };
      const seen = watchForAttachment(editor, VERIFY_MS);
      editor.dispatchEvent(new DragEvent('dragenter', opts));
      editor.dispatchEvent(new DragEvent('dragover', opts));
      const ev = new DragEvent('drop', opts);
      editor.dispatchEvent(ev);
      if (ev.defaultPrevented) return true;
      return seen;
    },
  };

  const PREF_KEY = 'stickstack:method';
  function preferredOrder() {
    const base = ['paste', 'input', 'drop'];
    let pref = null;
    try {
      pref = sessionStorage.getItem(PREF_KEY);
    } catch {}
    return pref && base.includes(pref) ? [pref, ...base.filter((m) => m !== pref)] : base;
  }

  async function insert(editor, file) {
    if (!editor.isConnected) return { ok: false };
    for (const m of preferredOrder()) {
      let ok = false;
      try {
        ok = await strategies[m](editor, file);
      } catch {
        ok = false;
      }
      if (ok) {
        try {
          sessionStorage.setItem(PREF_KEY, m);
        } catch {}
        return { ok: true, method: m };
      }
    }
    return { ok: false };
  }

  async function fallback(file) {
    if (file.type === 'image/png' && navigator.clipboard?.write && typeof ClipboardItem === 'function') {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]);
        toast(`Couldn’t attach automatically — the sticker is copied. Press ${isMac ? '⌘V' : 'Ctrl+V'} in the box.`, '', { label: 'Download', run: () => download(file) });
        return;
      } catch {}
    }
    toast('This box didn’t accept the sticker automatically. Drag it from the picker into the box, or download it.', 'err', { label: 'Download', run: () => download(file) });
  }

  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.style.display = 'none';
    root.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------- toasts ----------
  function toast(text, kind = '', action = null) {
    if (!hostEl.isConnected) (document.body || document.documentElement).appendChild(hostEl);
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ` ${kind}` : '');
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', () => {
        action.run();
        el.remove();
      });
      el.appendChild(b);
    }
    toasts.appendChild(el);
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
    setTimeout(() => el.remove(), action ? 9000 : 5000);
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function openLibrary(hash) {
    send({ type: 'library:open', hash }).catch((e) => toast(e.message, 'err'));
    closePicker(false);
  }

  // ---------- extension messages ----------
  const onMessage = (msg) => {
    if (msg?.type === 'picker:toggle') togglePicker();
  };
  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch {}

  function onInvalidated() {
    if (dead) return;
    dead = true;
    fab.hidden = true;
    picker.hidden = true;
    toast('StickStack was updated. Refresh this page to keep using stickers.');
    setTimeout(destroy, 8000);
  }

  // Load settings once (e.g. whether to show the floating button).
  send({ type: 'settings:get' })
    .then((r) => (settings = r.settings || settings))
    .catch(() => {});
  try {
    chrome.storage?.onChanged?.addListener((changes) => {
      if (changes.settings?.newValue) {
        settings = changes.settings.newValue;
        fileCache.clear();
        if (settings.showButton === false) fab.hidden = true;
      }
    });
  } catch {}

  // Orphan check: after an extension update this old instance should clean up quietly.
  const heartbeat = setInterval(() => {
    if (!runtimeAlive()) {
      clearInterval(heartbeat);
      dead = true;
      destroy();
    }
  }, 10000);

  function destroy() {
    dead = true;
    clearInterval(heartbeat);
    ro?.disconnect();
    io?.disconnect();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {}
    hostEl.remove();
  }

  // If the user is already typing in an editor when we load (e.g. injected after install).
  const ed0 = resolveEditor(deepActive());
  if (ed0) setActive(ed0);

  // `api` is shared with content/voice.js (same extension, same isolated world).
  window.__stickstackSubstack = {
    alive: () => !dead && runtimeAlive(),
    destroy,
    api: { send, insert, toast, resolveEditor, deepActive, isDark: () => wrap.classList.contains('dark'), applyTheme },
    _test: { insert, strategies, findImageInputs, resolveEditor },
  };
})();
