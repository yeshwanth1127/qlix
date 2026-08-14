/**
 * Persist unsent chat composer attachments across navigation.
 * sessionStorage cannot hold large File blobs; IndexedDB can.
 */

const DB_NAME = "qlix-agent-chat-drafts";
const DB_VERSION = 1;
const STORE = "pendingFiles";

type StoredPendingFile = {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

export async function loadPendingChatFiles(agentId: string): Promise<File[]> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readonly");
      const raw = await idbRequest(tx.objectStore(STORE).get(agentId));
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB read failed"));
      });
      if (!Array.isArray(raw)) return [];
      const out: File[] = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const row = item as Partial<StoredPendingFile>;
        if (typeof row.name !== "string" || !(row.blob instanceof Blob)) continue;
        out.push(
          new File([row.blob], row.name, {
            type: typeof row.type === "string" ? row.type : row.blob.type,
            lastModified: typeof row.lastModified === "number" ? row.lastModified : Date.now(),
          }),
        );
      }
      return out;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function savePendingChatFiles(agentId: string, files: File[]): Promise<void> {
  try {
    const db = await openDb();
    try {
      const payload: StoredPendingFile[] = files.map((f) => ({
        name: f.name,
        type: f.type,
        lastModified: f.lastModified,
        blob: f,
      }));
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (payload.length === 0) {
        store.delete(agentId);
      } else {
        store.put(payload, agentId);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB write failed"));
        tx.onabort = () => reject(tx.error ?? new Error("indexedDB write aborted"));
      });
    } finally {
      db.close();
    }
  } catch {
    // Private mode / quota / unavailable — draft text still works via sessionStorage.
  }
}

export async function clearPendingChatFiles(agentId: string): Promise<void> {
  await savePendingChatFiles(agentId, []);
}
