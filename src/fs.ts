import { readTakenAt } from './exif'
import type { PhotoItem } from './types'

const IMAGE_EXT = /\.(jpe?g|png|webp|avif)$/i
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Path order, which is also the order the grid starts in. */
export const compareNames = (a: PhotoItem, b: PhotoItem) => collator.compare(a.key, b.key)

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
  return items.sort(compareNames)
}

/** Photos have no capture time until someone reads it out of every file, which
 *  is a read per photo and only worth doing when the user asks for that order.
 *  Eight at a time: the reads are short and mostly waiting on the disk.
 *  A photo with no Exif date falls back to the file's own timestamp, so it
 *  lands near its neighbours rather than in a clump at the start of 1970. */
const DATE_BATCH = 8

export async function readTakenTimes(
  items: PhotoItem[],
  onProgress: (done: number) => void,
  signal: AbortSignal,
): Promise<Map<string, number>> {
  const times = new Map<string, number>()
  let done = 0

  for (let i = 0; i < items.length && !signal.aborted; i += DATE_BATCH) {
    await Promise.all(
      items.slice(i, i + DATE_BATCH).map(async (item) => {
        try {
          const file = await item.handle.getFile()
          times.set(item.key, (await readTakenAt(file)) ?? file.lastModified)
        } catch {
          times.set(item.key, 0)
        }
        done++
      }),
    )
    onProgress(done)
  }
  return times
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
