// StickStack — WhatsApp Web sticker collector.
// Read-only and local: it looks at stickers your browser has already downloaded and shows them
// so you can choose which to save. It never sends messages, clicks or automates WhatsApp.
// Activated from the StickStack toolbar popup.
(() => {
  'use strict';
  const prev = window.__stickstackWA;
  if (prev && prev.alive()) return;
  try {
    prev?.destroy?.();
  } catch {}
  document.querySelectorAll('[data-stickstack-wa]').forEach((n) => n.remove());

  const runtimeAlive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  let dead = false;

  // ---- tiny WebP header reader (content scripts can't import ES modules) ----
  const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
  function webpInfo(b) {
    if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let off = 12;
    let w = 0;
    let h = 0;
    let anim = false;
    let frames = 0;
    let guard = 0;
    while (off + 8 <= b.length && guard++ < 20000) {
      const cc = ascii(b, off, 4);
      const size = dv.getUint32(off + 4, true);
      const d = off + 8;
      if (cc === 'VP8X' && d + 10 <= b.length) {
        anim = !!(b[d] & 2);
        w = 1 + (b[d + 4] | (b[d + 5] << 8) | (b[d + 6] << 16));
        h = 1 + (b[d + 7] | (b[d + 8] << 8) | (b[d + 9] << 16));
      } else if (cc === 'VP8 ' && !w && d + 10 <= b.length) {
        w = dv.getUint16(d + 6, true) & 0x3fff;
        h = dv.getUint16(d + 8, true) & 0x3fff;
      } else if (cc === 'VP8L' && !w && d + 5 <= b.length) {
        const bits = dv.getUint32(d + 1, true);
        w = (bits & 0x3fff) + 1;
        h = ((bits >>> 14) & 0x3fff) + 1;
      } else if (cc === 'ANMF') frames++;
      off = d + size + (size & 1);
    }
    return w && h ? { w, h, animated: anim && frames > 1 } : null;
  }

  async function sha1(u8) {
    const d = await crypto.subtle.digest('SHA-1', u8);
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function toB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---- UI ----
  const host = document.createElement('div');
  host.setAttribute('data-stickstack-wa', '');
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
    .panel{width:340px;max-height:min(560px,calc(100vh - 32px));display:flex;flex-direction:column;background:#fff;color:#1a1a1a;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;font-size:13px;border:1px solid #e1e5ec}
    @media (prefers-color-scheme:dark){.panel{background:#171a20;color:#e8ebf0;border-color:#2a2f38}.sub,.foot{color:#9aa1ad!important}.cell{background:#22262e!important}input[type=text]{background:#22262e!important;color:#e8ebf0!important;border-color:#2a2f38!important}}
    .head{padding:12px 14px 6px;display:flex;align-items:center;gap:8px}
    .head b{flex:1;font-size:14px}
    .x{border:0;background:transparent;color:inherit;font-size:16px;cursor:pointer;opacity:.6}
    .sub{padding:0 14px 8px;color:#6b7280;line-height:1.45}
    .stat{padding:0 14px 8px;font-weight:600}
    .grid{flex:1;overflow-y:auto;padding:4px 10px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;min-height:80px}
    .cell{position:relative;aspect-ratio:1;border-radius:10px;background:#eef1f6;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px solid transparent}
    .cell.sel{border-color:#4f63d2}
    .cell img{max-width:88%;max-height:88%;pointer-events:none}
    .cell .chk{position:absolute;top:4px;right:4px;width:16px;height:16px;border-radius:50%;background:#4f63d2;color:#fff;font-size:11px;display:none;align-items:center;justify-content:center}
    .cell.sel .chk{display:flex}
    .cell .b{position:absolute;left:4px;bottom:4px;font-size:9px;font-weight:700;background:rgba(0,0,0,.55);color:#fff;padding:1px 4px;border-radius:4px}
    .empty{grid-column:1/-1;text-align:center;color:#9aa1ad;padding:20px 8px;line-height:1.5}
    .row{display:flex;gap:6px;padding:8px 14px}
    input[type=text]{flex:1;height:32px;border:1px solid #e1e5ec;border-radius:8px;padding:0 10px;font-size:13px;background:#fff;color:#1a1a1a}
    button.main{border:0;background:#4f63d2;color:#fff;font-weight:700;border-radius:8px;padding:0 14px;height:34px;cursor:pointer;font-size:13px}
    button.main:disabled{opacity:.5;cursor:default}
    button.ghost{border:1px solid #e1e5ec;background:transparent;color:inherit;border-radius:8px;padding:0 10px;height:30px;cursor:pointer;font-size:12px}
    .foot{padding:6px 14px 12px;color:#6b7280;font-size:11px;line-height:1.4}
  </style>
  <div class="panel" role="dialog" aria-label="StickStack sticker collector">
    <div class="head"><b>StickStack · Collect stickers</b><button class="x" title="Close" aria-label="Close">✕</button></div>
    <div class="sub">Open your <b>sticker tray</b> (😊 → Stickers) or a chat full of stickers and scroll through it. Stickers appear here as WhatsApp loads them.</div>
    <div class="stat"></div>
    <div class="grid"></div>
    <div class="row"><button class="ghost all">Select all</button><button class="ghost none">Select none</button><button class="ghost scan">Scan again</button></div>
    <div class="row"><input type="text" class="pack" maxlength="60" aria-label="Pack name"><button class="main save" disabled>Save</button></div>
    <div class="foot">Stays on your computer. Only stickers already shown on screen are read. WhatsApp’s built-in animated packs (Lottie) can’t be collected.</div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const grid = $('.grid');
  const stat = $('.stat');
  const saveBtn = $('.save');
  const packInput = $('.pack');
  packInput.value = `WhatsApp ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  // Keep WhatsApp's own keyboard shortcuts out of our inputs.
  for (const ev of ['keydown', 'keyup', 'keypress', 'paste']) root.addEventListener(ev, (e) => e.stopPropagation());

  const found = new Map(); // hash → { bytes, url, animated, sel }
  const seenSrc = new Set();
  let active = false;
  let mo = null;
  let inflight = 0;
  const queue = [];

  function updateStat() {
    const sel = [...found.values()].filter((f) => f.sel).length;
    stat.textContent = found.size ? `${found.size} found · ${sel} selected` : inflight ? 'Looking…' : 'No stickers found yet';
    saveBtn.disabled = !sel;
    saveBtn.textContent = sel ? `Save ${sel}` : 'Save';
    if (!found.size && !grid.querySelector('.empty')) grid.innerHTML = '<div class="empty">Waiting for stickers…<br>Open the sticker tray and scroll.</div>';
  }

  function addCell(hash, f) {
    grid.querySelector('.empty')?.remove();
    const c = document.createElement('div');
    c.className = 'cell sel';
    c.dataset.hash = hash;
    c.innerHTML = `<img alt=""><span class="chk">✓</span>${f.animated ? '<span class="b">GIF</span>' : ''}`;
    c.querySelector('img').src = f.url;
    c.addEventListener('click', () => {
      f.sel = !f.sel;
      c.classList.toggle('sel', f.sel);
      updateStat();
    });
    grid.appendChild(c);
  }

  function candidateSrcs(scope) {
    const out = [];
    const SEL = 'img, [style*="blob:"]';
    const list = [];
    if (scope.nodeType === 1 && scope.matches(SEL)) list.push(scope);
    if (scope.querySelectorAll) list.push(...scope.querySelectorAll(SEL));
    for (const el of list) {
      if (host.contains(el)) continue;
      if (el.tagName === 'IMG') {
        const s = el.currentSrc || el.src;
        if (s && (s.startsWith('blob:') || s.startsWith('data:image/webp'))) out.push(s);
      } else {
        const m = /url\(["']?(blob:[^"')]+)/.exec(el.getAttribute('style') || '');
        if (m) out.push(m[1]);
      }
    }
    return out;
  }

  function enqueue(srcs) {
    for (const s of srcs) {
      if (seenSrc.has(s)) continue;
      seenSrc.add(s);
      queue.push(s);
    }
    pump();
  }

  function pump() {
    while (active && inflight < 4 && queue.length) {
      const src = queue.shift();
      inflight++;
      inspect(src).finally(() => {
        inflight--;
        updateStat();
        pump();
      });
    }
  }

  async function inspect(src) {
    try {
      const res = await fetch(src);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length < 64 || buf.length > 10 * 1024 * 1024) return;
      const info = webpInfo(buf); // stickers are always WebP; photos/avatars are JPEG
      if (!info) return;
      const ratio = info.w / info.h;
      if (info.w < 96 || info.h < 96 || ratio < 0.5 || ratio > 2) return;
      const hash = await sha1(buf);
      if (found.has(hash)) return;
      const f = { bytes: buf, url: URL.createObjectURL(new Blob([buf], { type: 'image/webp' })), animated: info.animated, sel: true };
      found.set(hash, f);
      addCell(hash, f);
    } catch {
      /* revoked blob URL or network hiccup — ignore */
    }
  }

  function scanAll() {
    enqueue(candidateSrcs(document));
  }

  function start() {
    if (active || dead) return;
    active = true;
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    scanAll();
    mo = new MutationObserver((muts) => {
      const srcs = [];
      for (const m of muts) {
        if (m.type === 'attributes') srcs.push(...candidateSrcs(m.target));
        else for (const n of m.addedNodes) if (n.nodeType === 1) srcs.push(...candidateSrcs(n));
      }
      if (srcs.length) enqueue(srcs);
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style'] });
    updateStat();
  }

  function stop() {
    active = false;
    mo?.disconnect();
    mo = null;
    host.remove();
  }

  $('.x').addEventListener('click', stop);
  $('.scan').addEventListener('click', () => {
    seenSrc.clear();
    scanAll();
  });
  $('.all').addEventListener('click', () => setAll(true));
  $('.none').addEventListener('click', () => setAll(false));
  function setAll(v) {
    for (const [hash, f] of found) {
      f.sel = v;
      grid.querySelector(`.cell[data-hash="${hash}"]`)?.classList.toggle('sel', v);
    }
    updateStat();
  }

  saveBtn.addEventListener('click', async () => {
    const chosen = [...found.entries()].filter(([, f]) => f.sel);
    if (!chosen.length) return;
    if (!runtimeAlive()) {
      stat.textContent = 'StickStack was updated — refresh WhatsApp Web and try again.';
      return;
    }
    saveBtn.disabled = true;
    const packName = packInput.value.trim() || 'WhatsApp Web';
    let added = 0;
    let dupes = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < chosen.length; i += 10) {
        stat.textContent = `Saving ${Math.min(i + 10, chosen.length)} / ${chosen.length}…`;
        const batch = chosen.slice(i, i + 10).map(([hash, f], k) => ({ name: `whatsapp-${hash.slice(0, 10)}.webp`, b64: toB64(f.bytes), k }));
        const r = await chrome.runtime.sendMessage({ type: 'wa:ingest', items: batch, packName });
        if (!r?.ok) throw new Error(r?.error || 'Save failed');
        added += r.report.added.length;
        dupes += r.report.duplicates.length;
        skipped += r.report.skipped.length;
      }
      for (const [hash] of chosen) {
        const f = found.get(hash);
        f.sel = false;
        grid.querySelector(`.cell[data-hash="${hash}"]`)?.classList.remove('sel');
      }
      updateStat();
      stat.textContent = `✓ Saved ${added}${dupes ? ` · ${dupes} already in library` : ''}${skipped ? ` · ${skipped} skipped` : ''}`;
    } catch (e) {
      stat.textContent = `Couldn’t save: ${e.message}`;
    } finally {
      saveBtn.disabled = false;
    }
  });

  const onMessage = (msg, _s, sendResponse) => {
    if (msg?.type === 'wa:collector') {
      if (msg.action === 'stop') stop();
      else start();
      sendResponse?.({ ok: true, active });
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  function destroy() {
    dead = true;
    stop();
    for (const f of found.values()) URL.revokeObjectURL(f.url);
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {}
  }
  window.__stickstackWA = { alive: () => !dead && runtimeAlive(), destroy };
})();
