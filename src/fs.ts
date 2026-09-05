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
