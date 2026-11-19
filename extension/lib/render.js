// Decoding + conversion. Needs a DOM-ish context (page, offscreen document or dedicated worker):
// createImageBitmap, (Offscreen)Canvas and, for animations, WebCodecs ImageDecoder.
import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.js';
import { LIMITS } from './config.js';
import { backgroundColor, normalizeSettings } from './settings.js';
import { hexToRgb } from './util.js';

export const capabilities = () => ({
  imageDecoder: typeof ImageDecoder === 'function',
  offscreenCanvas: typeof OffscreenCanvas === 'function',
});

export class RenderError extends Error {
  constructor(message, userMessage) {
    super(message);
    this.userMessage = userMessage || message;
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function canvasToBlob(c, type, quality) {
  if (c.convertToBlob) return c.convertToBlob({ type, quality });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, quality));
}

const widthOf = (img) => img.displayWidth || img.width;
const heightOf = (img) => img.displayHeight || img.height;

function checkDims(w, h) {
  if (!w || !h) throw new RenderError('zero size', 'Couldn’t read this image (it may be corrupted)');
  if (w > LIMITS.maxSide || h > LIMITS.maxSide) throw new RenderError('too large', `Image is too large (${w}×${h}px)`);
}

async function typeSupported(mime) {
  if (!capabilities().imageDecoder) return false;
  try {
    return await ImageDecoder.isTypeSupported(mime);
  } catch {
    return false;
  }
}

/** Decode the first frame. Returns { image, width, height, close() }. */
export async function decodeFirstFrame(bytes, mime) {
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    checkDims(bmp.width, bmp.height);
    return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch (e) {
    if (e instanceof RenderError) throw e;
    if (await typeSupported(mime)) {
      const dec = new ImageDecoder({ data: bytes, type: mime });
      try {
        const { image } = await dec.decode({ frameIndex: 0 });
        checkDims(widthOf(image), heightOf(image));
        return { image, width: widthOf(image), height: heightOf(image), close: () => image.close() };
      } catch (err) {
        if (err instanceof RenderError) throw err;
      } finally {
        dec.close();
      }
    }
    throw new RenderError(String(e?.message || e), 'Couldn’t read this image (it may be corrupted)');
  }
}

/** Square, transparent thumbnail for library/picker grids. */
export async function makeThumb(bytes, mime, size = 128) {
  const f = await decodeFirstFrame(bytes, mime);
  try {
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const scale = Math.min(size / f.width, size / f.height);
    const w = Math.max(1, Math.round(f.width * scale));
    const h = Math.max(1, Math.round(f.height * scale));
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.image, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
    let blob = await canvasToBlob(c, 'image/webp', 0.82);
    if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(c, 'image/png'); // Safari can't encode WebP
    return { blob, width: f.width, height: f.height };
  } finally {
    f.close();
  }
}

/** Where to draw the sticker inside the output canvas. Keeps aspect ratio; longest side = size. */
export function layout(w, h, size, padding) {
  const pad = Math.round(size * padding);
  const inner = Math.max(8, size - 2 * pad);
  const scale = inner / Math.max(w, h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  return { W: dw + 2 * pad, H: dh + 2 * pad, dx: pad, dy: pad, dw, dh };
}

async function renderStatic(bytes, mime, s) {
  const f = await decodeFirstFrame(bytes, mime);
  try {
    const L = layout(f.width, f.height, s.size, s.padding);
    const c = makeCanvas(L.W, L.H);
    const ctx = c.getContext('2d');
    const bg = backgroundColor(s);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, L.W, L.H);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.image, L.dx, L.dy, L.dw, L.dh);
    const blob = await canvasToBlob(c, 'image/png');
    return { blob, mime: 'image/png', ext: 'png', width: L.W, height: L.H, frames: 1 };
  } finally {
    f.close();
  }
}

const round10 = (ms) => Math.round(ms / 10) * 10;

function sameFrame(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  // Compare as 32-bit words — fast enough for 512×512 (~65k comparisons).
  const x = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function writeGifFrame(gif, rgba, W, H, delay, opts, first) {
  if (opts.transparent) {
    // GIF transparency is on/off. Pixels under 50% alpha become transparent; partly
    // transparent edge pixels are blended onto the matte colour so outlines stay smooth.
    const { r: mr, g: mg, b: mb } = opts.matte;
    const mask = new Uint8Array(W * H);
    let anyT = false;
    for (let i = 0, px = 0; i < rgba.length; i += 4, px++) {
      const a = rgba[i + 3];
      if (a === 255) continue;
      if (a < 128) {
        mask[px] = 1;
        anyT = true;
        rgba[i] = mr;
        rgba[i + 1] = mg;
        rgba[i + 2] = mb;
      } else {
        const k = a / 255;
        rgba[i] = rgba[i] * k + mr * (1 - k);
        rgba[i + 1] = rgba[i + 1] * k + mg * (1 - k);
        rgba[i + 2] = rgba[i + 2] * k + mb * (1 - k);
      }
      rgba[i + 3] = 255;
    }
    const palette = quantize(rgba, anyT ? 255 : 256, { format: 'rgb565' });
    const index = applyPalette(rgba, palette, 'rgb565');
    let ti = -1;
    if (anyT) {
      ti = palette.length;
      palette.push([0, 0, 0]);
      for (let px = 0; px < mask.length; px++) if (mask[px]) index[px] = ti;
    }
    gif.writeFrame(index, W, H, { palette, delay, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: 2, repeat: first ? opts.repeat : undefined });
  } else {
    const palette = quantize(rgba, 256, { format: 'rgb565' });
    const index = applyPalette(rgba, palette, 'rgb565');
    gif.writeFrame(index, W, H, { palette, delay, dispose: 1, repeat: first ? opts.repeat : undefined });
  }
}

/** Animated image (WebP/APNG/GIF) → animated GIF. */
async function encodeGif(bytes, mime, s, side, frameStep, onProgress) {
  const dec = new ImageDecoder({ data: bytes, type: mime, preferAnimation: true });
  try {
    await dec.tracks.ready;
    try {
      await dec.completed;
    } catch {
      /* truncated file: use the frames we have */
    }
    const track = dec.tracks.selectedTrack;
    const frameCount = Math.max(1, track?.frameCount || 1);
    const rep = track?.repetitionCount;
    // ImageDecoder: Infinity = loop forever, 0 = play once, n = repeat n times. gifenc: 0 = forever, -1 = once.
    const repeat = rep === undefined || rep === Infinity ? 0 : rep === 0 ? -1 : Math.min(65535, Math.round(rep));
    const step = Math.max(frameStep, Math.ceil(frameCount / LIMITS.maxFrames));
    const bg = backgroundColor(s);
    const opts = { transparent: !bg, matte: hexToRgb(s.gifMatte), repeat };
    const gif = GIFEncoder();
    let canvas, ctx, L;
    let pending = null; // { data, start }
    let tIdeal = 0;
    let tEmitted = 0;
    let emitted = 0;
    let decodedAny = false;

    const emit = (data, delay) => {
      writeGifFrame(gif, data, L.W, L.H, delay, opts, emitted === 0);
      emitted++;
      tEmitted += delay;
    };

    for (let i = 0; i < frameCount; i += step) {
      let result;
      try {
        result = await dec.decode({ frameIndex: i, completeFramesOnly: true });
      } catch {
        if (!decodedAny) throw new RenderError('decode failed', 'Couldn’t decode this animation');
        break; // truncated tail — keep what decoded
      }
      decodedAny = true;
      const img = result.image;
      if (!canvas) {
        checkDims(widthOf(img), heightOf(img));
        L = layout(widthOf(img), heightOf(img), side, s.padding);
        canvas = makeCanvas(L.W, L.H);
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
      }
      // VideoFrame.duration is in microseconds. Browsers show ≤10ms frames at 100ms — do the same.
      let d = (img.duration ?? 0) / 1000;
      if (!(d > 10)) d = 100;
      d *= Math.min(step, frameCount - i);
      ctx.clearRect(0, 0, L.W, L.H);
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, L.W, L.H);
      }
      ctx.drawImage(img, L.dx, L.dy, L.dw, L.dh);
      img.close();
      const data = ctx.getImageData(0, 0, L.W, L.H).data;
      const start = tIdeal;
      tIdeal += d;
      if (pending && sameFrame(pending.data, data)) continue; // identical frame → just extend
      if (pending) {
        // GIF delays are 10ms ticks and browsers clamp <20ms. Track drift so total timing stays true;
        // a frame too short to show gets dropped and its time folds into the next one.
        const delay = round10(start - tEmitted);
        if (delay >= 20) emit(pending.data, delay);
      }
      pending = { data, start };
      onProgress?.(Math.min(1, (i + 1) / frameCount));
    }
    if (pending) emit(pending.data, Math.max(20, round10(tIdeal - tEmitted)));
    if (!emitted) throw new RenderError('no frames', 'Couldn’t decode this animation');
    gif.finish();
    return { bytes: gif.bytes(), width: L.W, height: L.H, frames: emitted };
  } finally {
    dec.close();
  }
}

/**
 * Convert a stored sticker into the file that gets attached to Substack.
 * @param {Uint8Array} bytes original file
 * @param {string} mime original MIME type
 * @param {{type:string, animated:boolean, frames:number, width:number, height:number}} info
 * @returns {Promise<{blob:Blob, mime:string, ext:string, width:number, height:number, frames:number, degraded?:string, overBudget?:boolean}>}
 */
export async function renderSticker(bytes, mime, info, settings, { onProgress } = {}) {
  const s = normalizeSettings(settings);
  const animated = !!info.animated && (info.frames || 0) > 1;
  const untouched = s.padding === 0 && !backgroundColor(s) && Math.max(info.width || 0, info.height || 0) <= s.size;

  if (animated && s.animatedFormat === 'webp' && info.type === 'webp') {
    return { blob: new Blob([bytes], { type: 'image/webp' }), mime: 'image/webp', ext: 'webp', width: info.width, height: info.height, frames: info.frames };
  }
  if (animated && s.animatedFormat !== 'static' && info.type === 'gif' && untouched && bytes.length <= s.gifMaxMB * 1048576) {
    return { blob: new Blob([bytes], { type: 'image/gif' }), mime: 'image/gif', ext: 'gif', width: info.width, height: info.height, frames: info.frames };
  }
  if (!animated || s.animatedFormat === 'static') return renderStatic(bytes, mime, s);
  if (!(await typeSupported(mime))) {
    const out = await renderStatic(bytes, mime, s);
    out.degraded = 'This browser can’t decode animations, so a still image was used. Chrome, Edge or Android work best.';
    return out;
  }

  const budget = s.gifMaxMB * 1048576;
  const S = s.size;
  const attempts = [
    [S, 1],
    [Math.round(S * 0.8), 1],
    [Math.round(S * 0.65), 1],
    [Math.round(S * 0.65), 2],
    [Math.round(S * 0.5), 2],
    [Math.round(S * 0.4), 3],
  ];
  let last = null;
  for (let a = 0; a < attempts.length; a++) {
    const [side, step] = attempts[a];
    const r = await encodeGif(bytes, mime, s, side, step, (p) => onProgress?.((a + p) / attempts.length));
    last = r;
    if (r.bytes.length <= budget) break;
  }
  return {
    blob: new Blob([last.bytes], { type: 'image/gif' }),
    mime: 'image/gif',
    ext: 'gif',
    width: last.width,
    height: last.height,
    frames: last.frames,
    overBudget: last.bytes.length > budget,
  };
}
