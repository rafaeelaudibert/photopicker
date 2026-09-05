import type { PhotoItem } from './types'

const THUMB_SIZE = 520
const MAX_CACHED = 2600
const POOL_SIZE = Math.min(6, Math.max(2, (navigator.hardwareConcurrency ?? 4) - 2))

type Listener = (url: string) => void

const cache = new Map<string, string>()
const listeners = new Map<string, Set<Listener>>()
const inFlight = new Set<string>()
/** LIFO: whatever scrolled into view most recently gets decoded first. */
const queue: PhotoItem[] = []
const workers: Worker[] = []
const idle: Worker[] = []

function spawn(): Worker {
  const worker = new Worker(new URL('./thumb.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: string; blob?: Blob; error?: string }>) => {
    const { id, blob } = e.data
    inFlight.delete(id)
    if (blob) {
      const url = URL.createObjectURL(blob)
      cache.set(id, url)
      evictOverflow()
      listeners.get(id)?.forEach((fn) => fn(url))
      listeners.delete(id)
    }
    idle.push(worker)
    drain()
  }
  workers.push(worker)
  return worker
}

function evictOverflow() {
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    URL.revokeObjectURL(cache.get(oldest.value)!)
    cache.delete(oldest.value)
  }
}

function drain() {
  while (idle.length && queue.length) {
    const item = queue.pop()!
    if (cache.has(item.key) || !listeners.has(item.key)) {
      inFlight.delete(item.key)
      continue
    }
    const worker = idle.pop()!
    item.handle
      .getFile()
      .then((file) => worker.postMessage({ id: item.key, file, size: THUMB_SIZE }))
      .catch(() => {
        inFlight.delete(item.key)
        idle.push(worker)
      })
  }
}

export function getCached(key: string): string | undefined {
  const url = cache.get(key)
  if (url) {
    // Refresh recency so visible thumbnails survive eviction.
    cache.delete(key)
    cache.set(key, url)
  }
  return url
}

export function requestThumb(item: PhotoItem, onReady: Listener): () => void {
  const cached = getCached(item.key)
  if (cached) {
    onReady(cached)
    return () => {}
  }

  let set = listeners.get(item.key)
  if (!set) listeners.set(item.key, (set = new Set()))
  set.add(onReady)

  if (!inFlight.has(item.key)) {
    inFlight.add(item.key)
    queue.push(item)
    if (workers.length < POOL_SIZE) idle.push(spawn())
    drain()
  }

  return () => {
    const current = listeners.get(item.key)
    if (!current) return
    current.delete(onReady)
    if (current.size === 0) listeners.delete(item.key)
  }
}
