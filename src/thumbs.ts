import type { PhotoItem } from './types'

const THUMB_SIZE = 400
const MAX_CACHED = 2600
const POOL_SIZE = Math.min(6, Math.max(2, (navigator.hardwareConcurrency ?? 4) - 2))
/** How many files may be open ahead of the pool. Reading a file is disk IO, so
 *  it happens before a worker is claimed and a worker never waits on it. */
const READ_AHEAD = POOL_SIZE * 2

type Mode = 'quick' | 'full'
type Listener = (url: string) => void

interface Job { item: PhotoItem; mode: Mode; file?: File }
interface Entry { url: string; full: boolean }
type Lanes = Record<Mode, Job[]>

const cache = new Map<string, Entry>()
const listeners = new Map<string, Set<Listener>>()
const active = new Map<string, Job>()
/** LIFO: whatever scrolled into view most recently gets decoded first. Quick
 *  outranks full, so a screenful of camera thumbnails lands in milliseconds and
 *  the real renders sharpen in behind them. Do not switch either to FIFO. */
const unread: Lanes = { quick: [], full: [] }
const opened: Lanes = { quick: [], full: [] }
const workers: Worker[] = []
const idle: Worker[] = []
let reading = 0

const take = (lanes: Lanes) => lanes.quick.pop() ?? lanes.full.pop()
const queued = (lanes: Lanes) => lanes.quick.length + lanes.full.length

/** A job is stale once its tile scrolled away, or once a better render landed. */
const wanted = (job: Job) =>
  active.get(job.item.key) === job &&
  listeners.has(job.item.key) &&
  !cache.get(job.item.key)?.full

function discard(job: Job) {
  if (active.get(job.item.key) === job) active.delete(job.item.key)
}

function publish(id: string, blob: Blob, full: boolean) {
  const previous = cache.get(id)
  const url = URL.createObjectURL(blob)
  cache.set(id, { url, full })
  evictOverflow()
  listeners.get(id)?.forEach((fn) => fn(url))
  // The placeholder may still be on screen. Revoking it now would blank the
  // tile until the sharp one decodes, so give it a moment to swap in.
  if (previous) setTimeout(() => URL.revokeObjectURL(previous.url), 2000)
}

function spawn(): Worker {
  const worker = new Worker(new URL('./thumb.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: string; mode: Mode; blob?: Blob }>) => {
    const { id, mode, blob } = e.data
    const job = active.get(id)
    idle.push(worker)
    if (!job) return drain()
    active.delete(id)

    if (blob) publish(id, blob, mode === 'full')
    if (mode === 'full') {
      listeners.delete(id)
    } else if (listeners.has(id)) {
      // The camera thumbnail is only a placeholder. Queue the real render
      // behind it, reusing the file that is already open.
      const sharpen: Job = { item: job.item, mode: 'full', file: job.file }
      active.set(id, sharpen)
      opened.full.push(sharpen)
    }
    drain()
  }
  workers.push(worker)
  return worker
}

function evictOverflow() {
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    URL.revokeObjectURL(cache.get(oldest.value)!.url)
    cache.delete(oldest.value)
  }
}

function drain() {
  while (idle.length) {
    const job = take(opened)
    if (!job) break
    if (!wanted(job)) {
      discard(job)
      continue
    }
    idle.pop()!.postMessage({ id: job.item.key, file: job.file, size: THUMB_SIZE, mode: job.mode })
  }

  while (reading + queued(opened) < READ_AHEAD) {
    const job = take(unread)
    if (!job) break
    if (!wanted(job)) {
      discard(job)
      continue
    }
    reading++
    job.item.handle.getFile().then(
      (file) => {
        job.file = file
        opened[job.mode].push(job)
        reading--
        drain()
      },
      () => {
        discard(job)
        reading--
        drain()
      },
    )
  }
}

export function getCached(key: string): string | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  // Refresh recency so visible thumbnails survive eviction.
  cache.delete(key)
  cache.set(key, entry)
  return entry.url
}

/** Calls back with the best thumbnail available, then again if a sharper one
 *  arrives. Returns an unsubscribe that also cancels work nobody is waiting on. */
export function requestThumb(item: PhotoItem, onReady: Listener): () => void {
  const entry = cache.get(item.key)
  if (entry) {
    getCached(item.key)
    onReady(entry.url)
    if (entry.full) return () => {}
  }

  let set = listeners.get(item.key)
  if (!set) listeners.set(item.key, (set = new Set()))
  set.add(onReady)

  if (!active.has(item.key)) {
    const job: Job = { item, mode: entry ? 'full' : 'quick' }
    active.set(item.key, job)
    unread[job.mode].push(job)
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
