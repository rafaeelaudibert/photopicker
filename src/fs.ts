import type { PhotoItem } from './types'

const IMAGE_EXT = /\.(jpe?g|png|webp|avif)$/i
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export const supportsFileSystemAccess = () =>
  typeof (window as any).showDirectoryPicker === 'function'

export const pickSourceFolder = (): Promise<FileSystemDirectoryHandle> =>
  (window as any).showDirectoryPicker({ id: 'photopicker-source', mode: 'read' })

export const pickDestFolder = (): Promise<FileSystemDirectoryHandle> =>
  (window as any).showDirectoryPicker({ id: 'photopicker-dest', mode: 'readwrite' })

/** Chrome hands back a handle from IndexedDB without permission; ask for it again. */
export async function ensureReadPermission(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const h = dir as any
  if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true
  return (await h.requestPermission({ mode: 'read' })) === 'granted'
}

export async function scanFolder(
  dir: FileSystemDirectoryHandle,
  onProgress: (found: number) => void,
): Promise<PhotoItem[]> {
  const items: PhotoItem[] = []

  async function walk(handle: FileSystemDirectoryHandle, prefix: string) {
    for await (const entry of (handle as any).values() as AsyncIterable<FileSystemHandle>) {
      if (entry.name.startsWith('.')) continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        await walk(entry as FileSystemDirectoryHandle, path)
      } else if (IMAGE_EXT.test(entry.name)) {
        items.push({ key: path, name: entry.name, dirPath: prefix, handle: entry as FileSystemFileHandle })
        if (items.length % 50 === 0) onProgress(items.length)
      }
    }
  }

  await walk(dir, '')
  onProgress(items.length)
  return items.sort((a, b) => collator.compare(a.key, b.key))
}

/** Appends " (2)", " (3)"… when two source subfolders contain the same file name. */
function uniqueName(name: string, taken: Set<string>): string {
  const lower = name.toLowerCase()
  if (!taken.has(lower)) {
    taken.add(lower)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase())
      return candidate
    }
  }
}

/** Five at a time. Copying one file at a time left the disk idle between the
 *  read and the write of each; the names are assigned up front so they stay in
 *  list order however the writes interleave. */
const BATCH = 5

export async function copyToFolder(
  dest: FileSystemDirectoryHandle,
  items: PhotoItem[],
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const taken = new Set<string>()
  const targets = items.map((item) => ({ item, name: uniqueName(item.name, taken) }))
  let done = 0

  for (let i = 0; i < targets.length; i += BATCH) {
    await Promise.all(
      targets.slice(i, i + BATCH).map(async ({ item, name }) => {
        const file = await item.handle.getFile()
        const target = await dest.getFileHandle(name, { create: true })
        const writable = await target.createWritable()
        await writable.write(file)
        await writable.close()
        onProgress(++done, targets.length)
      }),
    )
  }
}
