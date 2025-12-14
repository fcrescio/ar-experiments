const DB_NAME = 'xrnotes-db';
const DB_VERSION = 1;
const NOTE_STORE = 'notes';
const LINE_STORE = 'lines';
const META_STORE = 'meta';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTE_STORE)) {
        db.createObjectStore(NOTE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(LINE_STORE)) {
        db.createObjectStore(LINE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

export function createStorage(audioContext, setStatus) {
  let dbPromise = null;

  async function init() {
    if (!dbPromise) dbPromise = openDatabase();
    return dbPromise;
  }

  async function saveMeta(counter) {
    const db = await init();
    transaction(db, META_STORE, 'readwrite').put({ key: 'noteCounter', value: counter });
  }

  function lineIdFrom(ids) {
    const [a, b] = ids;
    return [a, b].sort().join('|');
  }

  async function persistNote(mesh) {
    const db = await init();
    const payload = {
      id: mesh.userData.id,
      label: mesh.userData.label,
      color: mesh.material.color.getHex(),
      position: mesh.position.toArray(),
      audioBlob: mesh.userData.audioBlob || null
    };
    transaction(db, NOTE_STORE, 'readwrite').put(payload);
  }

  async function removeNote(id) {
    const db = await init();
    transaction(db, NOTE_STORE, 'readwrite').delete(id);
    const lineStore = transaction(db, LINE_STORE, 'readwrite');
    const getAllReq = lineStore.getAll();
    await new Promise((resolve, reject) => {
      getAllReq.onsuccess = () => resolve();
      getAllReq.onerror = () => reject(getAllReq.error);
    });
    getAllReq.result
      .filter((entry) => entry.ids.includes(id))
      .forEach((entry) => lineStore.delete(entry.id));
  }

  async function persistLine(ids) {
    const db = await init();
    transaction(db, LINE_STORE, 'readwrite').put({ id: lineIdFrom(ids), ids });
  }

  async function removeLine(ids) {
    const db = await init();
    transaction(db, LINE_STORE, 'readwrite').delete(lineIdFrom(ids));
  }

  async function loadState() {
    try {
      const db = await init();
      const noteStore = transaction(db, NOTE_STORE, 'readonly');
      const lineStore = transaction(db, LINE_STORE, 'readonly');
      const metaStore = transaction(db, META_STORE, 'readonly');

      const [notes, lines, meta] = await Promise.all([
        new Promise((resolve, reject) => {
          const req = noteStore.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
        new Promise((resolve, reject) => {
          const req = lineStore.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
        new Promise((resolve, reject) => {
          const req = metaStore.get('noteCounter');
          req.onsuccess = () => resolve(req.result?.value);
          req.onerror = () => reject(req.error);
        })
      ]);

      const decodedNotes = await Promise.all(
        notes.map(async (note) => {
          if (note.audioBlob) {
            try {
              const buffer = await note.audioBlob.arrayBuffer();
              const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
              return { ...note, audioBuffer };
            } catch (err) {
              console.warn('[XRNotes] Failed to decode stored audio', err);
              setStatus?.('Stored audio could not be restored.');
            }
          }
          return note;
        })
      );

      return { notes: decodedNotes, lines, noteCounter: meta ?? undefined };
    } catch (err) {
      console.error('[XRNotes] Failed to load saved state', err);
      setStatus?.('Could not load saved notes.');
      return { notes: [], lines: [], noteCounter: undefined };
    }
  }

  return {
    init,
    loadState,
    persistNote,
    removeNote,
    persistLine,
    removeLine,
    saveMeta
  };
}
