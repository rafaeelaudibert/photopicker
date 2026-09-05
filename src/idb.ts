/**
 * Two-key store for the source folder handle, so a cull can span several
 * sessions without re-picking the folder every time.
 */
const DB_NAME = 'photopicker'
const STORE = 'handles'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close())
}

export const saveHandle = (h: FileSystemDirectoryHandle) =>
  tx<void>('readwrite', (s) => s.put(h, 'source'))

export const loadHandle = () =>
  tx<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get('source'))

export const clearHandle = () => tx<void>('readwrite', (s) => s.delete('source'))
