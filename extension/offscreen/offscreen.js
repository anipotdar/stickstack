// Hidden document with a DOM: decodes and converts stickers on behalf of the service worker.
import { renderAndCache } from '../lib/service.js';
import { ingest } from '../lib/ingest.js';
import { base64ToBytes } from '../lib/util.js';

const ops = {
  async render({ id }) {
    await renderAndCache(id);
    return {};
  },
  async ingest({ items, packName }) {
    const inputs = items.map((it, i) => ({ name: String(it.name || `sticker-${i + 1}.webp`), bytes: base64ToBytes(it.b64), source: 'whatsapp-web' }));
    const report = await ingest(inputs, { defaultPackName: packName || 'WhatsApp Web' });
    return { report };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  const op = ops[msg.op];
  if (!op) return false;
  op(msg).then(
    (r) => sendResponse({ ok: true, ...r }),
    (e) => sendResponse({ ok: false, error: String(e?.userMessage || e?.message || e) })
  );
  return true;
});
