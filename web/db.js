// IndexedDB wrapper. All storage goes through here so it can be swapped for a server later.
const STORES = ['photos', 'refs', 'recipes', 'settings'];
let dbp;
const open = () => (dbp ||= new Promise((res, rej) => {
  const rq = indexedDB.open('framecoach', 1);
  rq.onupgradeneeded = () => {
    const db = rq.result;
    db.createObjectStore('photos', { keyPath: 'id' }).createIndex('contentHash', 'contentHash', { unique: true });
    STORES.slice(1).forEach((s) => db.createObjectStore(s, { keyPath: 'id' }));
  };
  rq.onsuccess = () => res(rq.result);
  rq.onerror = () => rej(rq.error);
}));
const tx = async (store, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r?.result);
    t.onerror = () => rej(t.error);
  });
};
export const all = (s) => tx(s, 'readonly', (o) => o.getAll());
export const put = (s, v) => tx(s, 'readwrite', (o) => o.put({ ...v, updatedAt: new Date().toISOString() }));
export const del = (s, id) => tx(s, 'readwrite', (o) => o.delete(id));
export const clear = (s) => tx(s, 'readwrite', (o) => o.clear());
export const byHash = async (h) => (await all('photos')).find((p) => p.contentHash === h);

export async function exportAll() {
  const out = { app: 'framecoach', schemaVersion: 1, exportedAt: new Date().toISOString() };
  for (const s of STORES) out[s] = await all(s);
  return out;
}
export async function importAll(data) {
  if (data.app !== 'framecoach') throw new Error('Not a FrameCoach export');
  for (const s of STORES) for (const v of data[s] || []) await put(s, v);
}
export async function deleteAll() {
  for (const s of STORES) await clear(s);
}
