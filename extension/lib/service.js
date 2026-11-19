// Operations shared by the library page and the offscreen document.
import * as db from './db.js';
import { renderSticker } from './render.js';
import { getSettings, renderKey } from './settings.js';
import { bytesToBase64, uid } from './util.js';
import { zipSync } from './vendor/fflate.js';

/** Render a sticker with current settings, using the IndexedDB cache. */
export async function renderAndCache(id, { settings, onProgress } = {}) {
  const s = settings || (await getSettings());
  const key = `${id}:${renderKey(s)}`;
  const cached = await db.getRender(key);
  if (cached) return cached;
  const rec = await db.getSticker(id);
  if (!rec) throw new Error('This sticker no longer exists');
  const bytes = new Uint8Array(await rec.blob.arrayBuffer());
  const out = await renderSticker(bytes, rec.mime, { type: rec.kind, animated: rec.animated, frames: rec.frames, width: rec.width, height: rec.height }, s, { onProgress });
  const entry = { key, stickerId: id, blob: out.blob, mime: out.mime, ext: out.ext, width: out.width, height: out.height, frames: out.frames, degraded: out.degraded || '', overBudget: !!out.overBudget, createdAt: Date.now() };
  try {
    await db.putRender(entry);
  } catch {
    /* cache is best-effort (e.g. storage full) */
  }
  return entry;
}

export async function renderedToPayload(entry, name) {
  const u8 = new Uint8Array(await entry.blob.arrayBuffer());
  return { b64: bytesToBase64(u8), mime: entry.mime, ext: entry.ext, name, degraded: entry.degraded || '', overBudget: !!entry.overBudget, bytes: u8.length };
}

/** Build a portable backup: originals + stickstack.json manifest. */
export async function buildBackup() {
  const [stickers, packs] = await Promise.all([db.listStickers(), db.listPacks()]);
  const files = {};
  const manifest = { format: 'stickstack-backup', version: 1, exportedAt: new Date().toISOString(), packs: packs.map(({ id, name, author }) => ({ id, name, author })), stickers: [] };
  for (const st of stickers) {
    const ext = { webp: 'webp', png: 'png', gif: 'gif', jpeg: 'jpg', avif: 'avif', bmp: 'bmp' }[st.kind] || 'bin';
    const file = `stickers/${st.id}.${ext}`;
    files[file] = [new Uint8Array(await st.blob.arrayBuffer()), { level: 0 }];
    manifest.stickers.push({ file, name: st.name, packId: st.packId, fav: !!st.fav });
  }
  files['stickstack.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

export { uid };
