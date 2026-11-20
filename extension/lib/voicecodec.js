// StickStack voice notes: the file format and drawing helpers.
//
// Substack DMs accept images but not audio, so a voice note travels as an ordinary PNG:
//  - the pixels are a waveform card that anyone can see ("Voice note · 0:42");
//  - the Opus audio rides along in a private ancillary PNG chunk ("ssVn") that image viewers ignore.
// People with StickStack get an inline player; everyone else sees the card.
//
// Plain script with no import/export, so the same file runs as a content script, inside the
// service worker (side-effect import) and in Node tests. It publishes globalThis.StickStackVoice.
(() => {
  'use strict';

  const CHUNK_TYPE = 'ssVn'; // ancillary (s), private (s), reserved bit clear (V), safe-to-copy (n)
  const VERSION = 1;
  const MAX_MS = 5 * 60 * 1000; // longest recording
  const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
  const MAX_HEADER_BYTES = 16 * 1024;
  const MAX_FETCH_BYTES = 12 * 1024 * 1024;
  const BARS = 56;
  const CARD = Object.freeze({ w: 800, h: 200 });
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  const MIME_OK = /^audio\/(webm|ogg|mp4|mpeg|wav)(;\s*codecs="?[\w.]+"?)?$/i;

  // ---------- CRC-32 (PNG chunks) ----------
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const putU32 = (b, o, v) => {
    b[o] = (v >>> 24) & 255;
    b[o + 1] = (v >>> 16) & 255;
    b[o + 2] = (v >>> 8) & 255;
    b[o + 3] = v & 255;
  };
  const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

  function isPng(b) {
    if (!b || b.length < 8) return false;
    for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) return false;
    return true;
  }

  /** List a PNG's chunks up to and including IEND. Returns null if the file is not a well-formed PNG. */
  function readChunks(png) {
    if (!isPng(png)) return null;
    const out = [];
    let o = 8;
    while (o + 12 <= png.length) {
      const length = u32(png, o);
      const end = o + 12 + length;
      if (length > 0x7fffffff || end > png.length) return null;
      const type = ascii(png, o + 4, 4);
      out.push({ type, start: o, dataStart: o + 8, length, end });
      o = end;
      if (type === 'IEND') return out;
    }
    return null; // no IEND → truncated
  }

  function chunkCrcOk(png, c) {
    return crc32(png.subarray(c.start + 4, c.dataStart + c.length)) === u32(png, c.dataStart + c.length);
  }

  function makeChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    putU32(out, 0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    putU32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  /** Return a copy of `png` with one `type` chunk (replacing any existing ones) placed right before IEND. */
  function setChunk(png, type, data) {
    const chunks = readChunks(png);
    if (!chunks) throw new Error('Not a PNG file');
    const parts = [png.subarray(0, 8)];
    for (const c of chunks) {
      if (c.type === type) continue;
      if (c.type === 'IEND') parts.push(makeChunk(type, data));
      parts.push(png.subarray(c.start, c.end));
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  function getChunk(png, type) {
    const chunks = readChunks(png);
    const c = chunks?.find((x) => x.type === type);
    if (!c || !chunkCrcOk(png, c)) return null;
    return png.subarray(c.dataStart, c.dataStart + c.length);
  }

  // ---------- payload ----------
  // [u8 version][u32 header length][header JSON (UTF-8)][audio bytes]
  function clampPeaks(peaks) {
    if (!Array.isArray(peaks)) return [];
    return peaks.slice(0, 256).map((p) => Math.max(0, Math.min(255, Math.round(Number(p) || 0))));
  }

  function encodePayload(meta, audio) {
    if (!(audio instanceof Uint8Array) || !audio.length) throw new Error('No audio to save');
    if (audio.length > MAX_AUDIO_BYTES) throw new Error('This voice note is too long');
    const mime = String(meta?.mime || '');
    if (!MIME_OK.test(mime)) throw new Error('Unsupported audio format');
    const durationMs = Math.round(Number(meta?.durationMs) || 0);
    if (!(durationMs > 0) || durationMs > MAX_MS + 2000) throw new Error('Bad duration');
    const header = new TextEncoder().encode(JSON.stringify({ v: VERSION, mime, ms: durationMs, peaks: clampPeaks(meta.peaks) }));
    const out = new Uint8Array(5 + header.length + audio.length);
    out[0] = VERSION;
    putU32(out, 1, header.length);
    out.set(header, 5);
    out.set(audio, 5 + header.length);
    return out;
  }

  /** Parse and validate a payload. Returns null for anything unexpected (it came from the internet). */
  function decodePayload(data) {
    if (!data || data.length < 6 || data[0] !== VERSION) return null;
    const hlen = u32(data, 1);
    if (hlen < 2 || hlen > MAX_HEADER_BYTES || 5 + hlen >= data.length) return null;
    let h;
    try {
      h = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(5, 5 + hlen)));
    } catch {
      return null;
    }
    if (!h || typeof h !== 'object' || h.v !== VERSION) return null;
    const mime = typeof h.mime === 'string' && MIME_OK.test(h.mime) ? h.mime : null;
    const durationMs = Number(h.ms);
    if (!mime || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_MS + 2000) return null;
    const audio = data.subarray(5 + hlen);
    if (audio.length > MAX_AUDIO_BYTES) return null;
    return { mime, durationMs: Math.round(durationMs), peaks: clampPeaks(h.peaks), audio };
  }

  /** Hide a recording inside a PNG. */
  function embedVoice(png, meta, audio) {
    return setChunk(png, CHUNK_TYPE, encodePayload(meta, audio));
  }

  /** Pull a recording out of a PNG, or null if this is just a picture. */
  function extractVoice(png) {
    const data = getChunk(png, CHUNK_TYPE);
    return data ? decodePayload(data) : null;
  }

  // ---------- waveform ----------
  /** Turn per-frame loudness (RMS, 0–1) into `n` bars of 0–255 for drawing. */
  function downsample(levels, n = BARS) {
    const src = Array.isArray(levels) || ArrayBuffer.isView(levels) ? Array.from(levels, (x) => (Number.isFinite(x) ? Math.max(0, x) : 0)) : [];
    if (!src.length) return new Array(n).fill(0);
    const buckets = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i * src.length) / n);
      const b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / n));
      let peak = 0;
      for (let j = a; j < b && j < src.length; j++) peak = Math.max(peak, src[j]);
      buckets.push(peak);
    }
    // Normalise to the loudest moment, but don't blow quiet hiss up to full height.
    const top = Math.max(0.04, ...buckets);
    return buckets.map((v) => Math.round(Math.sqrt(Math.min(1, v / top)) * 255));
  }

  function formatDuration(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Bars, played part in `played`, rest in `rest`. Works with any 2D canvas context. */
  function drawWave(ctx, peaks, x, y, w, h, progress, played, rest) {
    const n = peaks.length || BARS;
    const pitch = w / n;
    const bw = Math.max(2, pitch * 0.55);
    const mid = y + h / 2;
    for (let i = 0; i < n; i++) {
      const v = (peaks[i] || 0) / 255;
      const bh = Math.max(bw, v * h);
      const bx = x + i * pitch + (pitch - bw) / 2;
      ctx.fillStyle = (i + 0.5) / n <= progress ? played : rest;
      roundRect(ctx, bx, mid - bh / 2, bw, bh, bw / 2);
      ctx.fill();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Draw the card people without the extension see. Canvas must be CARD.w × CARD.h. */
  function drawCard(ctx, { peaks, durationMs }) {
    const { w, h } = CARD;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#4f63d2');
    g.addColorStop(1, '#3f8fb0');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, w, h, 36);
    ctx.fill();

    // play button
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(92, 84, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4f63d2';
    ctx.beginPath();
    ctx.moveTo(80, 62);
    ctx.lineTo(80, 106);
    ctx.lineTo(116, 84);
    ctx.closePath();
    ctx.fill();

    drawWave(ctx, peaks, 164, 44, w - 164 - 130, 80, 0, '#ffffff', 'rgba(255,255,255,0.78)');

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.font = '600 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx.fillText(formatDuration(durationMs), w - 36, 86);

    ctx.textAlign = 'left';
    ctx.font = '500 21px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText('Voice note  ·  play it with the StickStack extension', 48, 164);
  }

  // ---------- where the original bytes live ----------
  // Substack serves images through an image CDN that resizes and re-encodes them (which would
  // drop our chunk), but the URL carries the original upload's address, which we fetch instead.
  const ORIGINAL_HOSTS = new Set(['substack-post-media.s3.amazonaws.com']);

  function isAllowedOriginal(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && ORIGINAL_HOSTS.has(u.hostname) && !u.username && !u.password && !u.port;
    } catch {
      return false;
    }
  }

  /** Map an <img> src on Substack to the URL of the uploaded file, or null if it isn't one. */
  function originalImageUrl(src) {
    if (typeof src !== 'string' || src.length > 4096) return null;
    if (isAllowedOriginal(src)) return src;
    let u;
    try {
      u = new URL(src);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' || u.hostname !== 'substackcdn.com' || !u.pathname.startsWith('/image/fetch/')) return null;
    const rest = src.slice(src.indexOf('/image/fetch/') + '/image/fetch/'.length);
    const m = /https?(?::|%3A)/i.exec(rest);
    if (!m) return null;
    let inner = rest.slice(m.index);
    try {
      if (/^https?%3A/i.test(inner)) inner = decodeURIComponent(inner);
    } catch {
      return null;
    }
    return isAllowedOriginal(inner) ? inner : null;
  }

  /** Cheap check before fetching anything: voice cards are always 4:1. */
  function looksLikeCard(w, h) {
    if (!(w >= 200 && h >= 50)) return false;
    return Math.abs(w / h - CARD.w / CARD.h) < 0.03;
  }

  globalThis.StickStackVoice = Object.freeze({
    CHUNK_TYPE,
    VERSION,
    MAX_MS,
    MAX_AUDIO_BYTES,
    MAX_FETCH_BYTES,
    BARS,
    CARD,
    crc32,
    isPng,
    readChunks,
    setChunk,
    getChunk,
    encodePayload,
    decodePayload,
    embedVoice,
    extractVoice,
    downsample,
    formatDuration,
    drawWave,
    drawCard,
    originalImageUrl,
    isAllowedOriginal,
    looksLikeCard,
  });
})();
