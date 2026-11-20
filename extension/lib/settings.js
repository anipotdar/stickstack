// Settings: chrome.storage.local inside the extension, localStorage on the web converter.

export const DEFAULT_SETTINGS = Object.freeze({
  size: 512, // longest side of the exported sticker, px
  padding: 0, // 0 – 0.3, fraction of size added as empty margin
  background: 'transparent', // 'transparent' | 'white' | 'black' | 'custom'
  customBg: '#fff7f0',
  animatedFormat: 'gif', // 'gif' | 'webp' (original) | 'static'
  gifMatte: '#ffffff', // colour used to smooth GIF edges (GIF has no partial transparency)
  gifMaxMB: 4, // size budget for animated output
  closeOnInsert: true,
  showButton: true,
  voiceNotes: true, // mic button in DM composers + inline players for received voice notes
});

const SIZES = [128, 192, 256, 320, 384, 448, 512, 640, 768];
const BG = ['transparent', 'white', 'black', 'custom'];
const ANIM = ['gif', 'webp', 'static'];
const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.size = SIZES.includes(Number(s.size)) ? Number(s.size) : DEFAULT_SETTINGS.size;
  s.padding = Math.min(0.3, Math.max(0, Number(s.padding) || 0));
  s.padding = Math.round(s.padding * 100) / 100;
  if (!BG.includes(s.background)) s.background = DEFAULT_SETTINGS.background;
  if (!HEX.test(s.customBg)) s.customBg = DEFAULT_SETTINGS.customBg;
  if (!ANIM.includes(s.animatedFormat)) s.animatedFormat = DEFAULT_SETTINGS.animatedFormat;
  if (!HEX.test(s.gifMatte)) s.gifMatte = DEFAULT_SETTINGS.gifMatte;
  s.gifMaxMB = Math.min(15, Math.max(1, Number(s.gifMaxMB) || DEFAULT_SETTINGS.gifMaxMB));
  s.closeOnInsert = s.closeOnInsert !== false;
  s.showButton = s.showButton !== false;
  s.voiceNotes = s.voiceNotes !== false;
  return s;
}

/** Settings that change the rendered file. Used as the render-cache key. */
export function renderKey(s) {
  const n = normalizeSettings(s);
  return ['v1', n.size, n.padding, n.background, n.background === 'custom' ? n.customBg : '', n.animatedFormat, n.gifMatte, n.gifMaxMB].join('|');
}

export function backgroundColor(s) {
  if (s.background === 'white') return '#ffffff';
  if (s.background === 'black') return '#000000';
  if (s.background === 'custom') return s.customBg;
  return null;
}

const hasChromeStorage = () => typeof chrome !== 'undefined' && !!chrome?.storage?.local;
const LS_KEY = 'stickstack.settings';

export async function getSettings() {
  try {
    if (hasChromeStorage()) {
      const { settings } = await chrome.storage.local.get('settings');
      return normalizeSettings(settings);
    }
    return normalizeSettings(JSON.parse(localStorage.getItem(LS_KEY) || 'null'));
  } catch {
    return normalizeSettings(null);
  }
}

export async function saveSettings(patch) {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  if (hasChromeStorage()) await chrome.storage.local.set({ settings: next });
  else {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* private mode — settings just won't persist */
    }
  }
  return next;
}
