/*
 * Scanner phone storage (IndexedDB):
 *  keys  — festId → offline key bundle (non-extractable CryptoKeys). Wiped on Lock, on a 401 and when expired.
 *  seen  — "festId:ticketId:slot" → time, so the same ticket twice on this phone offline says "Already in (this phone)".
 *  queue — offline scans waiting to be sent to /api/scan when the phone is back online (only under the same login).
 */
const DB = 'thefest-scan';
export type Store = 'keys' | 'seen' | 'queue';
/** by = the scanner user who made the scan; only that user's login syncs it. at = scan time (lunch is per IST day). */
export type Queued = { festId: string; gate: string; counter: string; payload: string; at: number; by: string };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('keys');
      r.result.createObjectStore('seen');
      r.result.createObjectStore('queue', { autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export const idbGet = <T>(store: Store, key: IDBValidKey) => run<T | undefined>(store, 'readonly', (s) => s.get(key));
export const idbPut = (store: Store, value: unknown, key?: IDBValidKey) => run(store, 'readwrite', (s) => s.put(value, key));
export const idbDel = (store: Store, key: IDBValidKey) => run(store, 'readwrite', (s) => s.delete(key));
export const idbClear = (store: Store) => run(store, 'readwrite', (s) => s.clear());
export async function idbAll<T>(store: Store): Promise<{ key: IDBValidKey; value: T }[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const out: { key: IDBValidKey; value: T }[] = [];
    const tx = db.transaction(store, 'readonly');
    const c = tx.objectStore(store).openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { out.push({ key: cur.key, value: cur.value as T }); cur.continue(); } };
    tx.oncomplete = () => { db.close(); resolve(out); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
