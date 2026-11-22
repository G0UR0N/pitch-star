// IndexedDB storage: songs (with audio blobs) and best scores.
let dbp;
function open() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('psg', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('songs', { keyPath: 'id' });
      r.result.createObjectStore('scores', { keyPath: 'id' });
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
