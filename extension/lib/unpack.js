// Turns whatever the user dropped (files, folders, .zip, .wastickers, StickStack backups)
// into a flat list of candidate images, with pack hints and human-readable skip reasons.
import { unzipSync } from './vendor/fflate.js';
import { sniff, IMAGE_TYPES } from './sniff.js';
import { LIMITS } from './config.js';
import { basename, dirname, stripExt, cleanName } from './util.js';

export const SKIP_REASONS = {
  empty: 'Empty file',
  gzip: 'Telegram animated stickers (.tgs) aren’t supported yet',
  lottie: 'Lottie animations (WhatsApp’s built-in animated packs) aren’t supported yet',
  webm: 'Video stickers (.webm) aren’t supported yet',
  video: 'Videos aren’t supported — stickers and images only',
  heic: 'HEIC photos can’t be read by the browser — export as PNG or JPEG first',
  svg: 'SVG files aren’t supported',
  json: 'Not an image (looks like a data file)',
  unknown: 'Not a supported image (use WebP, PNG, GIF, JPEG or AVIF)',
  tooBig: `Too large (max ${Math.round(LIMITS.maxImageBytes / 1024 / 1024)} MB per image)`,
  archiveTooBig: `Archive too large (max ${Math.round(LIMITS.maxArchiveBytes / 1024 / 1024)} MB)`,
  archiveBroken: 'Couldn’t open this archive (corrupted, password-protected or unsupported compression)',
  archiveDepth: 'Archive nested too deeply',
  archiveBudget: 'Skipped — this import is too large in total. Import in smaller batches.',
  archiveEntries: `Archive has too many files (max ${LIMITS.maxArchiveEntries})`,
};

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\.nomedia|\.trashed-[^/]*|\._[^/]*)(\/|$)/i;
const HIDDEN = /(^|\/)\.[^/]+$/; // dotfiles (but not "./")
export const isJunk = (path) => JUNK.test(path) || HIDDEN.test(path);

const ARCHIVE_EXT = /\.(zip|wastickers)$/i;
const td = new TextDecoder('utf-8', { fatal: false });
const readText = (u8, max = 200) => td.decode(u8.subarray(0, 4096)).replace(/﻿/g, '').trim().slice(0, max);

/**
 * @param {{name:string, path?:string, bytes:Uint8Array, packHint?:string, fav?:boolean, source?:string}[]} inputs
 * @returns {{items:object[], skipped:{name:string, reason:string}[], packs:Record<string,{name:string, author?:string}>}}
 */
export function expandInputs(inputs) {
  const out = { items: [], skipped: [], packs: {} };
  const budget = { total: 0, exceeded: false };
  for (const inp of inputs) expandOne(inp, 0, out, budget);
  return out;
}

function expandOne(inp, depth, out, budget) {
  const path = inp.path || inp.name || 'file';
  if (isJunk(path)) return; // silently ignore OS clutter
  const bytes = inp.bytes;
  const s = sniff(bytes);
  if (s.type === 'empty') return void out.skipped.push({ name: path, reason: SKIP_REASONS.empty });

  if (s.type === 'zip') {
    if (bytes.length > LIMITS.maxArchiveBytes) return void out.skipped.push({ name: path, reason: SKIP_REASONS.archiveTooBig });
    if (depth >= LIMITS.maxArchiveDepth) return void out.skipped.push({ name: path, reason: SKIP_REASONS.archiveDepth });
    return expandZip(inp, depth, out, budget);
  }
  if (IMAGE_TYPES.has(s.type)) {
    if (bytes.length > LIMITS.maxImageBytes) return void out.skipped.push({ name: path, reason: SKIP_REASONS.tooBig });
    out.items.push({
      name: basename(inp.name || path),
      path,
      bytes,
      kind: s.type,
      mime: s.mime,
      packKey: inp.packHint ? `hint:${inp.packHint}` : null,
      fav: !!inp.fav,
      displayName: inp.displayName || null,
      source: inp.source || 'import',
    });
    if (inp.packHint && !out.packs[`hint:${inp.packHint}`]) out.packs[`hint:${inp.packHint}`] = { name: cleanName(inp.packHint, 'Imported') };
    return;
  }
  out.skipped.push({ name: path, reason: SKIP_REASONS[s.type] || SKIP_REASONS.unknown });
}

function expandZip(inp, depth, out, budget) {
  const zipPath = inp.path || inp.name;
  let count = 0;
  let tooMany = false;
  const oversized = [];
  let entries;
  try {
    entries = unzipSync(inp.bytes, {
      filter: (f) => {
        if (f.name.endsWith('/') || isJunk(f.name)) return false;
        if (++count > LIMITS.maxArchiveEntries) {
          tooMany = true;
          return false;
        }
        const cap = ARCHIVE_EXT.test(f.name) ? LIMITS.maxArchiveBytes : LIMITS.maxImageBytes;
        if (f.originalSize > cap) {
          oversized.push(f.name);
          return false;
        }
        if (budget.total + f.originalSize > LIMITS.maxArchiveTotalBytes) {
          budget.exceeded = true;
          return false;
        }
        budget.total += f.originalSize;
        return true;
      },
    });
  } catch {
    out.skipped.push({ name: zipPath, reason: SKIP_REASONS.archiveBroken });
    return;
  }
  if (tooMany) out.skipped.push({ name: zipPath, reason: SKIP_REASONS.archiveEntries });
  if (budget.exceeded) out.skipped.push({ name: zipPath, reason: SKIP_REASONS.archiveBudget });
  for (const n of oversized) out.skipped.push({ name: `${zipPath} › ${n}`, reason: ARCHIVE_EXT.test(n) ? SKIP_REASONS.archiveTooBig : SKIP_REASONS.tooBig });

  const names = Object.keys(entries);
  const zipLabel = cleanName(stripExt(basename(zipPath)), 'Imported');
  const zipKey = `zip:${zipPath}:${depth}`;

  // 1) StickStack backup
  const manifestName = names.find((n) => basename(n) === 'stickstack.json' && !n.includes('/'));
  if (manifestName) {
    let manifest = null;
    try {
      manifest = JSON.parse(td.decode(entries[manifestName]));
    } catch {}
    if (manifest && manifest.format === 'stickstack-backup' && Array.isArray(manifest.stickers)) {
      const packsById = new Map((manifest.packs || []).map((pk) => [pk.id, pk]));
      for (const st of manifest.stickers) {
        const bytes = entries[st.file];
        if (!bytes) continue;
        const pk = packsById.get(st.packId);
        const packKey = pk ? `backup:${pk.id}` : null;
        if (pk && !out.packs[packKey]) out.packs[packKey] = { name: cleanName(pk.name, 'Imported') };
        pushEntry(out, { name: basename(st.file), path: `${zipPath} › ${st.file}`, bytes, packKey, fav: !!st.fav, displayName: st.name, source: 'backup' });
      }
      return;
    }
  }

  // 2) WhatsApp .wastickers pack (zip with title.txt/author.txt + .webp stickers + tray icon)
  const titleEntry = names.find((n) => /(^|\/)title\.txt$/i.test(n));
  const authorEntry = names.find((n) => /(^|\/)author\.txt$/i.test(n));
  const isWa = /\.wastickers$/i.test(zipPath) || !!titleEntry;
  if (isWa) {
    const title = titleEntry ? readText(entries[titleEntry], 60) : '';
    const author = authorEntry ? readText(entries[authorEntry], 60) : '';
    out.packs[zipKey] = { name: cleanName(title || zipLabel, 'WhatsApp pack'), author };
    let found = 0;
    for (const n of names) {
      const bytes = entries[n];
      if (/\.txt$/i.test(n)) continue;
      const s = sniff(bytes);
      if (s.type !== 'webp') continue; // tray icon is PNG; stickers are always WebP
      found++;
      pushEntry(out, { name: basename(n), path: `${zipPath} › ${n}`, bytes, packKey: zipKey, source: 'wastickers' });
    }
    if (!found) out.skipped.push({ name: zipPath, reason: 'No stickers found in this pack' });
    return;
  }

  // 3) Generic archive. Group by folder when the archive holds several folders.
  const dirs = new Set(names.map((n) => dirname(n)));
  const multiFolder = dirs.size > 1;
  if (!names.length) out.skipped.push({ name: zipPath, reason: 'Archive is empty' });
  for (const n of names) {
    const bytes = entries[n];
    const childPath = `${zipPath} › ${n}`;
    if (sniff(bytes).type === 'zip') {
      expandOne({ name: basename(n), path: childPath, bytes }, depth + 1, out, budget);
      continue;
    }
    let packKey = zipKey;
    let packName = zipLabel;
    if (multiFolder && dirname(n)) {
      packName = cleanName(basename(dirname(n)), zipLabel);
      packKey = `${zipKey}/${dirname(n)}`;
    }
    if (!out.packs[packKey]) out.packs[packKey] = { name: packName };
    pushEntry(out, { name: basename(n), path: childPath, bytes, packKey, source: 'zip' });
  }
}

function pushEntry(out, e) {
  const s = sniff(e.bytes);
  if (!IMAGE_TYPES.has(s.type)) {
    // Readme/metadata files inside archives are expected clutter — don't report them.
    if (!/\.(txt|md|json|html?|xml|csv|url|ini|plist)$/i.test(e.name)) out.skipped.push({ name: e.path, reason: SKIP_REASONS[s.type] || SKIP_REASONS.unknown });
    return;
  }
  if (e.bytes.length > LIMITS.maxImageBytes) return void out.skipped.push({ name: e.path, reason: SKIP_REASONS.tooBig });
  out.items.push({ ...e, kind: s.type, mime: s.mime, fav: !!e.fav, displayName: e.displayName || null });
}

/**
 * Read browser File objects (from <input>, drag & drop, or directory pickers) into inputs.
 * Folder imports use the immediate parent folder as the pack name.
 */
export async function filesToInputs(files) {
  const list = [...files];
  const inputs = [];
  for (const f of list) {
    const rel = f.webkitRelativePath || f._relPath || f.name;
    const parent = dirname(rel);
    inputs.push({
      name: f.name,
      path: rel,
      bytes: new Uint8Array(await f.arrayBuffer()),
      packHint: parent ? basename(parent) : null,
    });
  }
  return inputs;
}

/** Recursively collect files from a drop event, including dropped folders. */
export async function filesFromDataTransfer(dt) {
  const items = [...(dt.items || [])];
  const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const files = [];
  let guard = 0;
  async function walk(entry, prefix) {
    if (guard++ > 20000) return;
    if (entry.isFile) {
      const file = await new Promise((res) => entry.file(res, () => res(null)));
      if (file) {
        file._relPath = prefix ? `${prefix}/${file.name}` : file.name;
        files.push(file);
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // readEntries returns results in chunks — keep reading until empty.
      for (;;) {
        const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const child of batch) await walk(child, path);
      }
    }
  }
  for (const e of entries) await walk(e, '');
  return files;
}
