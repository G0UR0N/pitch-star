// IndexedDB storage: songs (with audio blobs), best scores, and small keyed values (kv: e.g. the
// linked Drive folder handle, which localStorage can't hold).
let dbp;
function open() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('psg', 2);
    r.onupgradeneeded = () => {
      const names = r.result.objectStoreNames;
      if (!names.contains('songs')) r.result.createObjectStore('songs', { keyPath: 'id' });
      if (!names.contains('scores')) r.result.createObjectStore('scores', { keyPath: 'id' });
      if (!names.contains('kv')) r.result.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}
export const allSongs = () => tx('songs', 'readonly', s => s.getAll());
export const getSong = id => tx('songs', 'readonly', s => s.get(id));
export const putSong = song => tx('songs', 'readwrite', s => s.put(song));
export const deleteSong = id => tx('songs', 'readwrite', s => s.delete(id));
export const allScores = () => tx('scores', 'readonly', s => s.getAll());
export const getScore = id => tx('scores', 'readonly', s => s.get(id));
export const putScore = sc => tx('scores', 'readwrite', s => s.put(sc));
export const getKV = k => tx('kv', 'readonly', s => s.get(k));
export const putKV = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
