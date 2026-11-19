// IndexedDB storage, extension origin only (library page, offscreen document, service worker).
// Content scripts never touch this directly — they ask the service worker.

const DB_NAME = 'stickstack';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('stickers')) {
        const s = db.createObjectStore('stickers', { keyPath: 'id' });
        s.createIndex('hash', 'hash', { unique: true });
        s.createIndex('packId', 'packId');
      }
      if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('renders')) {
        const r = db.createObjectStore('renders', { keyPath: 'key' });
        r.createIndex('stickerId', 'stickerId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('Could not open the sticker database'));
    };
    req.onblocked = () => console.warn('[StickStack] database upgrade blocked by another open tab');
  });
  return dbPromise;
}

const p = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function run(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let result;
    let t;
    try {
      t = db.transaction(stores, mode);
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    Promise.resolve()
      .then(() => fn(t))
      .then((r) => {
        result = r;
      })
      .catch((e) => {
        try {
          t.abort();
        } catch {}
        reject(e);
      });
  });
}

// ---------- stickers ----------
export const listStickers = () => run(['stickers'], 'readonly', (t) => p(t.objectStore('stickers').getAll()));
export const getSticker = (id) => run(['stickers'], 'readonly', (t) => p(t.objectStore('stickers').get(id)));
export const getStickerByHash = (hash) => run(['stickers'], 'readonly', (t) => p(t.objectStore('stickers').index('hash').get(hash)));
export const countStickers = () => run(['stickers'], 'readonly', (t) => p(t.objectStore('stickers').count()));

/** Insert a sticker. Rejects with name 'ConstraintError' if the same image already exists. */
export const addSticker = (rec) => run(['stickers'], 'readwrite', (t) => p(t.objectStore('stickers').add(rec)));

export async function updateStickers(ids, patch) {
  return run(['stickers'], 'readwrite', async (t) => {
    const store = t.objectStore('stickers');
    for (const id of ids) {
      const rec = await p(store.get(id));
      if (!rec) continue;
      const next = typeof patch === 'function' ? patch(rec) : { ...rec, ...patch };
      store.put(next);
    }
  });
}

export async function deleteStickers(ids) {
  return run(['stickers', 'renders'], 'readwrite', async (t) => {
    const s = t.objectStore('stickers');
    const r = t.objectStore('renders').index('stickerId');
    for (const id of ids) {
      s.delete(id);
      const keys = await p(r.getAllKeys(id));
      for (const k of keys) t.objectStore('renders').delete(k);
    }
  });
}

// ---------- packs ----------
export const listPacks = () => run(['packs'], 'readonly', (t) => p(t.objectStore('packs').getAll()));
export const putPack = (pack) => run(['packs'], 'readwrite', (t) => p(t.objectStore('packs').put(pack)));

/** Delete a pack. Its stickers are deleted too, or moved to `moveTo` if given. */
export async function deletePack(packId, moveTo = null) {
  return run(['packs', 'stickers', 'renders'], 'readwrite', async (t) => {
    const stickers = await p(t.objectStore('stickers').index('packId').getAll(packId));
    for (const rec of stickers) {
      if (moveTo) t.objectStore('stickers').put({ ...rec, packId: moveTo });
      else {
        t.objectStore('stickers').delete(rec.id);
        const keys = await p(t.objectStore('renders').index('stickerId').getAllKeys(rec.id));
        for (const k of keys) t.objectStore('renders').delete(k);
      }
    }
    t.objectStore('packs').delete(packId);
  });
}

// ---------- render cache ----------
export const getRender = (key) => run(['renders'], 'readonly', (t) => p(t.objectStore('renders').get(key)));
export const putRender = (rec) => run(['renders'], 'readwrite', (t) => p(t.objectStore('renders').put(rec)));
export const clearRenders = () => run(['renders'], 'readwrite', (t) => p(t.objectStore('renders').clear()));

export async function clearAll() {
  return run(['stickers', 'packs', 'renders'], 'readwrite', (t) => {
    t.objectStore('stickers').clear();
    t.objectStore('packs').clear();
    t.objectStore('renders').clear();
  });
}

/** Strip blobs for messaging / UI lists. */
export function stickerMeta(rec) {
  const { blob, thumb, ...meta } = rec;
  return meta;
}
