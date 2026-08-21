/**
 * Writing the task pack straight into the user's repository, so the round trip
 * of download → find → unzip → move disappears.
 *
 * The chosen directory handle is kept in IndexedDB. Chrome still requires a
 * user gesture to re-grant permission after a restart, so callers must be able
 * to fall back to the ZIP path.
 */

const DB_NAME = 'hangar';
const STORE = 'handles';
const HANDLE_KEY = 'exportRoot';

export function isSupported() {
  return typeof globalThis.showDirectoryPicker === 'function';
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');

    transaction.objectStore(STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');

    transaction.objectStore(STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/** Prompts for a folder. Must be called from a user gesture. */
export async function pickDirectory() {
  const handle = await globalThis.showDirectoryPicker({
    mode: 'readwrite',
    id: 'hangar-export-root',
  });

  await idbSet(HANDLE_KEY, handle);

  return handle;
}

export async function forgetDirectory() {
  await idbDelete(HANDLE_KEY);
}

/**
 * @param {boolean} allowPrompt pass true only from inside a user gesture
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function getDirectory(allowPrompt = false) {
  const handle = await idbGet(HANDLE_KEY);

  if (!handle) {
    return null;
  }

  const options = { mode: 'readwrite' };

  if ((await handle.queryPermission(options)) === 'granted') {
    return handle;
  }

  if (!allowPrompt) {
    return null;
  }

  return (await handle.requestPermission(options)) === 'granted' ? handle : null;
}

async function resolveDirectory(root, segments) {
  let current = root;

  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }

  return current;
}

/**
 * @param {FileSystemDirectoryHandle} root
 * @param {Array<{ path: string, data: Uint8Array | string }>} entries
 * @param {(written: number, total: number) => void} [onProgress]
 */
export async function writeFiles(root, entries, onProgress) {
  let written = 0;

  for (const entry of entries) {
    const segments = entry.path.split('/');
    const filename = segments.pop();
    const directory = await resolveDirectory(root, segments);
    const fileHandle = await directory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();

    await writable.write(entry.data);
    await writable.close();

    written++;
    onProgress?.(written, entries.length);
  }

  return written;
}
