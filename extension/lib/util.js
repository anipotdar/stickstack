// Small shared helpers (no DOM, no chrome.*).

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

export async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export async function blobToDataURL(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(u8)}`;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
export const dirname = (p) => {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.join('/');
};
export const stripExt = (n) => String(n || '').replace(/\.[a-z0-9]{1,10}$/i, '');

/** Human-friendly sticker/pack name; collapses junk and caps length. */
export function cleanName(name, fallback = 'Sticker') {
  let n = stripExt(basename(name))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) n = fallback;
  return n.length > 60 ? n.slice(0, 57) + '…' : n;
}

/** Safe file name for downloads. */
export function safeFileName(name, ext) {
  const base = String(name || 'sticker')
    .normalize('NFKD')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50) || 'sticker';
  return `${base}.${ext}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hexToRgb(hex, fallback = { r: 255, g: 255, b: 255 }) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}
