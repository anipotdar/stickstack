// Import pipeline: expand archives → validate → dedupe → probe → thumbnail → store.
// Runs in extension pages with a DOM (library page, offscreen document).
import * as db from './db.js';
import { expandInputs } from './unpack.js';
import { imageInfo } from './sniff.js';
import { makeThumb, RenderError } from './render.js';
import { LIMITS } from './config.js';
import { sha256Hex, uid, cleanName } from './util.js';

export const DEFAULT_PACK_NAME = 'My stickers';

/** Find a pack by (case-insensitive) name, or create it. */
export async function ensurePack(name, extra = {}) {
  const clean = cleanName(name, DEFAULT_PACK_NAME);
  const packs = await db.listPacks();
  const hit = packs.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (hit) return { pack: hit, created: false };
  const pack = { id: uid(), name: clean, createdAt: Date.now(), ...extra };
  await db.putPack(pack);
  return { pack, created: true };
}

/**
 * @param {{name, path?, bytes:Uint8Array, packHint?}[]} inputs
 * @param {{targetPackId?:string|null, defaultPackName?:string, onProgress?:(done:number,total:number,name:string)=>void, signal?:AbortSignal}} opts
 */
export async function ingest(inputs, { targetPackId = null, defaultPackName = DEFAULT_PACK_NAME, onProgress, signal } = {}) {
  const report = { added: [], duplicates: [], skipped: [], packsCreated: [], cancelled: false };
  const { items, skipped, packs } = expandInputs(inputs);
  report.skipped.push(...skipped);

  const packIds = new Map(); // packKey → id
  const resolvePack = async (packKey) => {
    if (targetPackId) return targetPackId;
    const key = packKey || '__default__';
    if (packIds.has(key)) return packIds.get(key);
    const meta = packKey ? packs[packKey] : null;
    const { pack, created } = await ensurePack(meta?.name || defaultPackName, meta?.author ? { author: meta.author } : {});
    if (created) report.packsCreated.push(pack.name);
    packIds.set(key, pack.id);
    return pack.id;
  };

  const seen = new Set();
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) {
      report.cancelled = true;
      break;
    }
    const item = items[i];
    onProgress?.(i, items.length, item.name);
    try {
      const hash = await sha256Hex(item.bytes);
      if (seen.has(hash) || (await db.getStickerByHash(hash))) {
        report.duplicates.push(item.path || item.name);
        continue;
      }
      seen.add(hash);
      const info = imageInfo(item.bytes);
      // Truncated files: makeThumb throws if nothing decodes; animations keep the frames that do.
      const thumb = await makeThumb(item.bytes, item.mime);
      const width = info.width || thumb.width;
      const height = info.height || thumb.height;
      if (Math.max(width, height) < LIMITS.minSide) throw new RenderError('tiny', `Too small to be a sticker (${width}×${height}px)`);
      const rec = {
        id: uid(),
        hash,
        name: cleanName(item.displayName || item.name),
        packId: await resolvePack(item.packKey),
        kind: info.type,
        mime: item.mime,
        animated: !!info.animated,
        frames: info.frames || 1,
        width,
        height,
        size: item.bytes.length,
        blob: new Blob([item.bytes], { type: item.mime }),
        thumb: thumb.blob,
        fav: !!item.fav,
        createdAt: Date.now() + i, // stable ordering within one import
        usedAt: 0,
        useCount: 0,
        source: item.source || 'import',
      };
      try {
        await db.addSticker(rec);
        report.added.push(rec.id);
      } catch (e) {
        if (e?.name === 'ConstraintError') report.duplicates.push(item.path || item.name); // raced with another import
        else throw e;
      }
    } catch (e) {
      if (e?.name === 'QuotaExceededError') {
        report.skipped.push({ name: item.path || item.name, reason: 'Browser storage is full — free up disk space or delete some stickers' });
        break;
      }
      report.skipped.push({ name: item.path || item.name, reason: e?.userMessage || 'Couldn’t read this image (it may be corrupted)' });
    }
  }
  onProgress?.(items.length, items.length, '');
  return report;
}

export function summarize(report) {
  const parts = [];
  parts.push(`${report.added.length} sticker${report.added.length === 1 ? '' : 's'} added`);
  if (report.duplicates.length) parts.push(`${report.duplicates.length} already in your library`);
  if (report.skipped.length) parts.push(`${report.skipped.length} skipped`);
  if (report.cancelled) parts.push('import cancelled');
  return parts.join(' · ');
}
