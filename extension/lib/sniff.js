// Format detection by magic bytes + lightweight header parsing.
// Pure functions: no DOM, no chrome.* — runs in pages, workers and Node (tests).

const ascii = (b, o, n) => {
  let s = '';
  for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

export const IMAGE_TYPES = new Set(['webp', 'png', 'gif', 'jpeg', 'avif', 'bmp']);

/** Identify a file from its first bytes. Never trusts the file extension. */
export function sniff(b) {
  if (!b || b.length === 0) return { type: 'empty' };
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { type: 'webp', mime: 'image/webp' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a) return { type: 'png', mime: 'image/png' };
  if (b.length >= 6 && ascii(b, 0, 4) === 'GIF8') return { type: 'gif', mime: 'image/gif' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'jpeg', mime: 'image/jpeg' };
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6) || (b[2] === 7 && b[3] === 8))) return { type: 'zip' };
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return { type: 'gzip' }; // Telegram .tgs
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: 'webm' };
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return { type: 'avif', mime: 'image/avif' };
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return { type: 'heic' };
    return { type: 'video' };
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return { type: 'bmp', mime: 'image/bmp' };
  const head = ascii(b, 0, Math.min(512, b.length)).replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return { type: 'svg' };
  if (head.startsWith('{') && head.includes('"v"') && head.includes('"layers"')) return { type: 'lottie' };
  if (head.startsWith('{') || head.startsWith('[')) return { type: 'json' };
  return { type: 'unknown' };
}

/** Parse a WebP container. Returns null if the bytes are not a readable WebP. */
export function webpInfo(b) {
  if (!b || b.length < 20) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffSize = dv.getUint32(4, true);
  const info = { width: 0, height: 0, animated: false, alpha: false, frames: 0, truncated: riffSize + 8 > b.length };
  let animFlag = false;
  let anmf = 0;
  let still = false;
  let off = 12;
  let guard = 0;
  while (off + 8 <= b.length && guard++ < 100000) {
    const fourcc = ascii(b, off, 4);
    const size = dv.getUint32(off + 4, true);
    const data = off + 8;
    if (data + size > b.length) info.truncated = true;
    if (fourcc === 'VP8X' && data + 10 <= b.length) {
      const flags = b[data];
      animFlag = !!(flags & 0x02);
      info.alpha = !!(flags & 0x10);
      info.width = 1 + (b[data + 4] | (b[data + 5] << 8) | (b[data + 6] << 16));
      info.height = 1 + (b[data + 7] | (b[data + 8] << 8) | (b[data + 9] << 16));
    } else if (fourcc === 'VP8 ' && data + 10 <= b.length) {
      still = true;
      if (!info.width && b[data + 3] === 0x9d && b[data + 4] === 0x01 && b[data + 5] === 0x2a) {
        info.width = dv.getUint16(data + 6, true) & 0x3fff;
        info.height = dv.getUint16(data + 8, true) & 0x3fff;
      }
    } else if (fourcc === 'VP8L' && data + 5 <= b.length) {
      still = true;
      if (!info.width && b[data] === 0x2f) {
        const bits = dv.getUint32(data + 1, true);
        info.width = (bits & 0x3fff) + 1;
        info.height = ((bits >>> 14) & 0x3fff) + 1;
        info.alpha = info.alpha || !!((bits >>> 28) & 1);
      }
    } else if (fourcc === 'ANMF') {
      anmf++;
    } else if (fourcc === 'ALPH') {
      info.alpha = true;
    }
    if (size > b.length) break;
    off = data + size + (size & 1);
  }
  info.frames = animFlag ? anmf : still ? 1 : 0;
  info.animated = animFlag && anmf > 1;
  if (!info.width || !info.height || info.frames === 0) return null;
  return info;
}

/** Parse PNG/APNG header. */
export function pngInfo(b) {
  if (!b || b.length < 33) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (ascii(b, 12, 4) !== 'IHDR') return null;
  const info = { width: dv.getUint32(16), height: dv.getUint32(20), animated: false, frames: 1, alpha: false, truncated: false };
  const colorType = b[25];
  info.alpha = colorType === 4 || colorType === 6;
  let off = 8;
  let guard = 0;
  while (off + 12 <= b.length && guard++ < 100000) {
    const len = dv.getUint32(off);
    const type = ascii(b, off + 4, 4);
    if (type === 'tRNS') info.alpha = true;
    if (type === 'acTL' && off + 16 <= b.length) {
      const n = dv.getUint32(off + 8);
      if (n > 1) {
        info.animated = true;
        info.frames = n;
      }
    }
    if (type === 'IDAT' || type === 'IEND') break;
    if (len > b.length) {
      info.truncated = true;
      break;
    }
    off += 12 + len;
  }
  if (!info.width || !info.height) return null;
  return info;
}

/** Parse GIF structure: logical size + frame count. */
export function gifInfo(b) {
  if (!b || b.length < 13) return null;
  const info = { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), animated: false, frames: 0, alpha: false, truncated: false };
  let off = 13;
  if (b[10] & 0x80) off += 3 * (1 << ((b[10] & 0x07) + 1));
  const skipSubBlocks = (p) => {
    while (p < b.length) {
      const n = b[p];
      p += 1;
      if (n === 0) return p;
      p += n;
    }
    info.truncated = true;
    return b.length;
  };
  let guard = 0;
  while (off < b.length && guard++ < 200000) {
    const id = b[off];
    if (id === 0x3b) break; // trailer
    if (id === 0x21) {
      const label = b[off + 1];
      if (label === 0xf9 && off + 3 < b.length && b[off + 3] & 0x01) info.alpha = true;
      off = skipSubBlocks(off + 2);
    } else if (id === 0x2c) {
      if (off + 10 > b.length) {
        info.truncated = true;
        break;
      }
      info.frames++;
      const packed = b[off + 9];
      off += 10;
      if (packed & 0x80) off += 3 * (1 << ((packed & 0x07) + 1));
      off += 1; // LZW min code size
      off = skipSubBlocks(off);
    } else {
      break; // garbage — stop parsing, keep what we found
    }
  }
  if (!info.width || !info.height || info.frames === 0) return null;
  info.animated = info.frames > 1;
  return info;
}

/** Best-effort metadata for any supported image. Unknown fields are left 0/false. */
export function imageInfo(b) {
  const s = sniff(b);
  let meta = null;
  if (s.type === 'webp') meta = webpInfo(b);
  else if (s.type === 'png') meta = pngInfo(b);
  else if (s.type === 'gif') meta = gifInfo(b);
  return { ...s, ...(meta || { width: 0, height: 0, animated: false, frames: 1, alpha: false }), parsed: !!meta };
}
