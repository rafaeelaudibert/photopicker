export interface PhotoItem {
  /** Path relative to the source folder. Stable identity across sessions. */
  key: string
  /** File name including extension. */
  name: string
  /** Relative parent folder, empty string when the photo sits at the root. */
  dirPath: string
  handle: FileSystemFileHandle
}

export type Filter = 'all' | 'picked' | 'unpicked'
