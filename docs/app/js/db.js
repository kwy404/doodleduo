// Boards live in this browser's IndexedDB: the list (name, dates, a small preview), the CRDT
// state of each board and the pictures they use, by hash. Nothing is uploaded anywhere.

const NAME = 'doodleduo';
const VERSION = 1;
let opening = null;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('states')) db.createObjectStore('states');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Every board, newest first. */
export async function listBoards() {
  const all = (await run('boards', 'readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export const getBoard = (id) => run('boards', 'readonly', (s) => s.get(id));
export const putBoard = (meta) => run('boards', 'readwrite', (s) => s.put(meta));
export const getState = (id) => run('states', 'readonly', (s) => s.get(id));
export const putState = (id, state) => run('states', 'readwrite', (s) => s.put(state, id));

export async function deleteBoard(id) {
  await run('boards', 'readwrite', (s) => s.delete(id));
  await run('states', 'readwrite', (s) => s.delete(id));
}

/** Pictures: { mime, bytes } by SHA-256 hex. */
export const getBlob = (hash) => run('blobs', 'readonly', (s) => s.get(hash));
export const putBlob = (hash, value) => run('blobs', 'readwrite', (s) => s.put(value, hash));
export const hasBlob = async (hash) => !!(await run('blobs', 'readonly', (s) => s.getKey(hash)));

/** Asks the browser to keep this site's storage when space runs low. Not every browser agrees. */
export async function persist() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
