import type { PhotoItem } from './types'

/** The photo on screen plus the two either side of it. Each entry holds a
 *  decoded full resolution frame, which is tens of megabytes on a 24MP file, so
 *  this stays deliberately small. It is exactly the working set the cursor
 *  needs and no more. */
const MAX_FRAMES = 5

export interface Frame {
  url: string
  width: number
  height: number
  file: File
}

interface Ready {
  url: string
  /** Held so Chrome keeps the decoded bitmap. Dropping it would leave the
   *  prefetch worth no more than the file read. */
  image: HTMLImageElement
  frame: Frame
}

interface Entry {
  ready?: Ready
  promise: Promise<Ready>
}

const entries = new Map<string, Entry>()

async function load(item: PhotoItem): Promise<Ready> {
  const file = await item.handle.getFile()
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.src = url
  // Decoding here rather than letting the <img> do it is the whole point: a
  // frame is ready to paint the instant it is handed over, so the stage never
  // goes blank between one photo and the next.
  await image.decode()
  return {
    url,
    image,
    frame: { url, width: image.naturalWidth, height: image.naturalHeight, file },
  }
}

function drop(key: string) {
  const entry = entries.get(key)
  if (!entry) return
  entries.delete(key)
  entry.promise.then(
    (ready) => URL.revokeObjectURL(ready.url),
    () => {},
  )
}

function open(item: PhotoItem): Entry {
  const cached = entries.get(item.key)
  if (cached) {
    // Refresh recency so the photo being looked at is never the one evicted.
    entries.delete(item.key)
    entries.set(item.key, cached)
    return cached
  }

  const entry: Entry = { promise: load(item) }
  entry.promise.then(
    (ready) => {
      entry.ready = ready
    },
    () => {},
  )
  entries.set(item.key, entry)
  while (entries.size > MAX_FRAMES) {
    const oldest = entries.keys().next()
    if (oldest.done) break
    drop(oldest.value)
  }
  return entry
}

/** The frame if it is decoded and ready to paint right now, otherwise nothing. */
export function peekFrame(key: string): Frame | undefined {
  const entry = entries.get(key)
  if (!entry?.ready) return undefined
  entries.delete(key)
  entries.set(key, entry)
  return entry.ready.frame
}

export const loadFrame = (item: PhotoItem): Promise<Frame> =>
  open(item).promise.then((ready) => ready.frame)

/** Warms the photos either side of the cursor. Pass them furthest first: the
 *  nearest should be the last to be evicted. */
export function prefetchFrames(items: PhotoItem[]) {
  for (const item of items) open(item)
}

/** Drops everything from the previous folder. */
export function clearFrames() {
  for (const key of [...entries.keys()]) drop(key)
}
