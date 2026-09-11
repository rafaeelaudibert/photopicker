import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Cell } from './Cell'
import { Preview } from './Preview'
import { Shortcuts } from './Shortcuts'
import { TopBar } from './TopBar'
import { DEFAULT_FIELDS, type FieldId } from './exif'
import { clearFrames, prefetchFrames } from './frames'
import {
  compareNames,
  copyToFolder,
  ensureReadPermission,
  pickDestFolder,
  pickSourceFolder,
  readTakenTimes,
  scanFolder,
  supportsFileSystemAccess,
} from './fs'
import { clearHandle, loadHandle, saveHandle } from './idb'
import { resetThumbs } from './thumbs'
import type { Filter, PhotoItem, Sort } from './types'

const picksKey = (folder: string) => `photopicker:picks:${folder}`
const TARGET_KEY = 'photopicker:target'
const SIZE_KEY = 'photopicker:cellsize'
const WIDTH_KEY = 'photopicker:gridwidth'
const SORT_KEY = 'photopicker:sort'
const FIELDS_KEY = 'photopicker:fields'

/** Must match .grid in styles.css: the row window is arithmetic, not measurement. */
const GRID_GAP = 8
const GRID_PAD = 10
/** Rows kept rendered above and below the viewport, so a flick lands on tiles. */
const OVERSCAN = 3

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Only windowed cells are in the DOM, so a tile carries its own index. */
const indexOfCell = (target: EventTarget) => {
  const el = (target as Element).closest?.('.cell') as HTMLElement | null
  return el?.dataset.index ? Number(el.dataset.index) : -1
}
const readNumber = (key: string, fallback: number) => Number(localStorage.getItem(key)) || fallback
const readSort = (): Sort => (localStorage.getItem(SORT_KEY) === 'taken' ? 'taken' : 'name')

/** Writing to localStorage is synchronous and lands on whatever the browser is
 *  in the middle of, which for picks is a keystroke and for the divider is a
 *  drag frame. None of it is urgent, so it waits for an idle moment. */
const pending = new Map<string, { id: number; value: string }>()
function persist(key: string, value: string) {
  const queued = pending.get(key)
  if (queued) cancelIdleCallback(queued.id)
  const id = requestIdleCallback(
    () => {
      pending.delete(key)
      localStorage.setItem(key, value)
    },
    { timeout: 2000 },
  )
  pending.set(key, { id, value })
}

/** A tab can be closed inside the idle window. Losing a session of picks would
 *  be a poor trade for the milliseconds saved. */
window.addEventListener('pagehide', () => {
  for (const [key, { id, value }] of pending) {
    cancelIdleCallback(id)
    localStorage.setItem(key, value)
  }
  pending.clear()
})

function readFields(): FieldId[] {
  try {
    const stored = JSON.parse(localStorage.getItem(FIELDS_KEY) ?? 'null')
    if (Array.isArray(stored)) return stored as FieldId[]
  } catch {
    /* fall through to defaults */
  }
  return [...DEFAULT_FIELDS]
}

export default function App() {
  const [folderName, setFolderName] = useState('')
  const [items, setItems] = useState<PhotoItem[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState(() => readNumber(TARGET_KEY, 100))
  const [cellSize, setCellSize] = useState(() => readNumber(SIZE_KEY, 150))
  const [gridWidth, setGridWidth] = useState(() => readNumber(WIDTH_KEY, 460))
  const [fields, setFields] = useState<FieldId[]>(readFields)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>(readSort)
  const [takenAt, setTakenAt] = useState<Map<string, number>>(new Map())
  const [dating, setDating] = useState<number | null>(null)
  const [cursor, setCursor] = useState(0)
  const [layout, setLayout] = useState({ cols: 1, row: 0, height: 0, first: 0, last: 0 })
  const [showInfo, setShowInfo] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [scanning, setScanning] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ label: string; text: string; sticky?: boolean } | null>(null)
  const [resumable, setResumable] = useState<FileSystemDirectoryHandle | null>(null)

  const paneRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  /** The photo the cursor is on, so re-ordering the list can put it back. */
  const selectedKey = useRef<string | undefined>(undefined)
  const keepKey = useRef<string | undefined>(undefined)
  const supported = supportsFileSystemAccess()

  useEffect(() => {
    loadHandle().then((h) => h && setResumable(h)).catch(() => {})
  }, [])

  useEffect(() => persist(TARGET_KEY, String(target)), [target])
  useEffect(() => persist(SIZE_KEY, String(cellSize)), [cellSize])
  useEffect(() => persist(WIDTH_KEY, String(gridWidth)), [gridWidth])
  useEffect(() => persist(SORT_KEY, sort), [sort])
  useEffect(() => persist(FIELDS_KEY, JSON.stringify(fields)), [fields])

  useEffect(() => {
    if (folderName) persist(picksKey(folderName), JSON.stringify([...picked]))
  }, [picked, folderName])

  useEffect(() => {
    if (!toast || busy || toast.sticky) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast, busy])

  const openFolder = useCallback(async (handle: FileSystemDirectoryHandle) => {
    if (!(await ensureReadPermission(handle))) return
    setScanning(0)
    setResumable(null)
    // Nothing from the last folder is worth keeping, and a path that exists in
    // both would otherwise show the old folder's photo.
    resetThumbs()
    clearFrames()
    try {
      const found = await scanFolder(handle, setScanning)
      const valid = new Set(found.map((f) => f.key))
      const stored: string[] = JSON.parse(localStorage.getItem(picksKey(handle.name)) ?? '[]')
      setItems(found)
      setFolderName(handle.name)
      setPicked(new Set(stored.filter((k) => valid.has(k))))
      setTakenAt(new Map())
      setFilter('all')
      setCursor(0)
      await saveHandle(handle).catch(() => {})
    } finally {
      setScanning(null)
    }
  }, [])

  const chooseFolder = useCallback(async () => {
    try {
      await openFolder(await pickSourceFolder())
    } catch {
      /* the picker was dismissed */
    }
  }, [openFolder])

  /** Ordering before filtering, so that with no filter on the list handed to
   *  the grid keeps its identity across a pick and nothing re-renders. */
  const ordered = useMemo(() => {
    if (sort === 'name' || !takenAt.size) return items
    return [...items].sort(
      (a, b) => (takenAt.get(a.key) ?? 0) - (takenAt.get(b.key) ?? 0) || compareNames(a, b),
    )
  }, [items, sort, takenAt])

  const view = useMemo(() => {
    if (filter === 'picked') return ordered.filter((i) => picked.has(i.key))
    if (filter === 'unpicked') return ordered.filter((i) => !picked.has(i.key))
    return ordered
  }, [ordered, filter, picked])

  selectedKey.current = view[cursor]?.key

  /** Capture times cost a read per photo, so they are only fetched when the
   *  user asks for that order, and once per folder. */
  useEffect(() => {
    if (sort !== 'taken' || !items.length || takenAt.size) return
    const run = new AbortController()
    setDating(0)
    readTakenTimes(items, setDating, run.signal)
      .then((times) => {
        if (run.signal.aborted) return
        keepKey.current = selectedKey.current
        setTakenAt(times)
      })
      .finally(() => !run.signal.aborted && setDating(null))
    // Switching back to name order mid-read abandons it, so the progress it was
    // reporting has to go with it.
    return () => {
      run.abort()
      setDating(null)
    }
  }, [sort, items, takenAt])

  useEffect(() => {
    if (dating === null) return setToast((t) => (t?.sticky ? null : t))
    setToast({ label: 'Reading dates', text: `${dating} of ${items.length}`, sticky: true })
  }, [dating, items.length])

  /** Re-ordering moves every photo, and the cursor is an index. Without this
   *  changing the order would select whatever landed at the old position. */
  const changeSort = useCallback((next: Sort) => {
    keepKey.current = selectedKey.current
    setSort(next)
  }, [])

  useEffect(() => {
    const key = keepKey.current
    if (key === undefined) return
    keepKey.current = undefined
    const found = view.findIndex((i) => i.key === key)
    if (found >= 0) setCursor(found)
  }, [view])

  useEffect(() => {
    setCursor((c) => clamp(c, 0, Math.max(0, view.length - 1)))
  }, [view.length])

  /** Decodes the photos either side of the cursor while the user looks at this
   *  one, so stepping through a shoot does not wait on a read and a decode each
   *  time. Held off long enough that the photo on screen gets the disk first. */
  useEffect(() => {
    if (!view.length) return
    const timer = setTimeout(() => {
      const around = [view[cursor - 2], view[cursor + 2], view[cursor - 1], view[cursor + 1]]
      prefetchFrames(around.filter((i): i is PhotoItem => !!i))
    }, 220)
    return () => clearTimeout(timer)
  }, [view, cursor])

  const toggle = useCallback((key: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  /** Square tiles need an explicit row height, measured from the resolved
   *  column. Reading it here rather than per keystroke keeps getComputedStyle,
   *  which forces layout, off the arrow keys and the scroll handler. */
  useEffect(() => {
    const pane = paneRef.current
    const grid = gridRef.current
    if (!pane || !grid) return
    const measure = () => {
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean)
      const row = Math.round(Number.parseFloat(columns[0]))
      const cols = columns.length || 1
      const height = pane.clientHeight
      if (!(row > 0)) return
      setLayout((prev) =>
        prev.row === row && prev.cols === cols && prev.height === height
          ? prev
          : { ...prev, row, cols, height },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [cellSize, items.length])

  const rowCount = Math.ceil(view.length / layout.cols)

  /** Picks the band of rows worth rendering. Bails when the band has not moved,
   *  so scrolling within a row costs nothing. */
  const windowRows = useCallback(() => {
    const pane = paneRef.current
    if (!pane || !layout.row || !layout.height) return
    const step = layout.row + GRID_GAP
    const top = pane.scrollTop - GRID_PAD
    const first = Math.max(0, Math.floor(top / step) - OVERSCAN)
    const last = Math.max(
      first,
      Math.min(rowCount - 1, Math.floor((top + layout.height) / step) + OVERSCAN),
    )
    setLayout((prev) => (prev.first === first && prev.last === last ? prev : { ...prev, first, last }))
  }, [layout.row, layout.height, rowCount])

  useEffect(() => {
    windowRows()
    const pane = paneRef.current
    if (!pane) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        windowRows()
      })
    }
    pane.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      pane.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [windowRows])

  /** Keeps the selected thumbnail visible as the cursor moves. Computed from the
   *  row geometry rather than scrollIntoView, which forces a synchronous layout
   *  and would fire on every pick while a filter is on. */
  useEffect(() => {
    const pane = paneRef.current
    if (!pane || !layout.row) return
    const step = layout.row + GRID_GAP
    const top = GRID_PAD + Math.floor(cursor / layout.cols) * step
    if (top - GRID_PAD < pane.scrollTop) pane.scrollTop = top - GRID_PAD
    else if (top + layout.row + GRID_PAD > pane.scrollTop + layout.height)
      pane.scrollTop = top + layout.row + GRID_PAD - layout.height
  }, [cursor, view, layout.row, layout.cols, layout.height])

  useEffect(() => {
    if (!items.length) return

    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?') {
        e.preventDefault()
        return setShowShortcuts((v) => !v)
      }
      if (showShortcuts) {
        if (e.key === 'Escape') setShowShortcuts(false)
        return
      }

      const last = view.length - 1
      const move = (delta: number) => {
        e.preventDefault()
        setCursor((c) => clamp(c + delta, 0, last))
      }

      switch (e.key) {
        case 'ArrowRight':
          return move(1)
        case 'ArrowLeft':
          return move(-1)
        case 'ArrowDown':
          return move(fullscreen ? 1 : layout.cols)
        case 'ArrowUp':
          return move(fullscreen ? -1 : -layout.cols)
        case 'Home':
          return move(-Infinity)
        case 'End':
          return move(Infinity)
        case ' ':
        case 'p':
        case 'P':
          e.preventDefault()
          if (view[cursor]) toggle(view[cursor].key)
          return
        case 'Enter':
        case 'f':
        case 'F':
          e.preventDefault()
          return setFullscreen((v) => !v)
        case 'Escape':
          return setFullscreen(false)
        case 'i':
        case 'I':
          return setShowInfo((v) => !v)
        case 's':
        case 'S':
          return changeSort(sort === 'name' ? 'taken' : 'name')
        case '1':
          return setFilter('all')
        case '2':
          return setFilter('picked')
        case '3':
          return setFilter('unpicked')
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, cursor, fullscreen, showShortcuts, items.length, toggle, layout.cols, sort, changeSort])

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    let width = gridWidth
    let frame = 0
    // Pointer moves arrive faster than frames. Coalescing them means one relayout
    // of the grid per frame rather than one per event.
    const onMove = (ev: PointerEvent) => {
      width = clamp(window.innerWidth - ev.clientX, 200, window.innerWidth - 360)
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setGridWidth(width)
      })
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      setGridWidth(width)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
  }

  const exportPicks = useCallback(async () => {
    const chosen = items.filter((i) => picked.has(i.key))
    if (!chosen.length) return
    let dest: FileSystemDirectoryHandle
    try {
      dest = await pickDestFolder()
    } catch {
      return
    }
    setBusy(true)
    setToast({ label: 'Copying', text: `0 of ${chosen.length}` })
    try {
      await copyToFolder(dest, chosen, (done, total) =>
        setToast({ label: 'Copying', text: `${done} of ${total}` }),
      )
      setToast({ label: 'Done', text: `${chosen.length} photos copied to ${dest.name}` })
    } catch (err) {
      setToast({ label: 'Copy failed', text: String(err) })
    } finally {
      setBusy(false)
    }
  }, [items, picked])

  if (!supported) {
    return (
      <div className="app">
        <div className="center">
          <div className="intro">
            <h1>Open this in Chrome</h1>
            <p>
              Photopicker writes your selects straight into a folder on this Mac using the File
              System Access API. Safari and Firefox do not support it yet.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="app">
        <div className="center">
          <div className="intro">
            <h1>Photopicker</h1>
            <p>
              Open a folder of photos, mark the ones worth printing, and copy them out. Everything
              stays on this Mac. No uploads, no network.
            </p>
            <div className="intro-actions">
              <button type="button" className="btn btn-primary" onClick={chooseFolder}>
                {scanning === null ? 'Open folder' : `Reading ${scanning} photos`}
              </button>
              {resumable && scanning === null && (
                <button type="button" className="btn" onClick={() => openFolder(resumable)}>
                  Resume {resumable.name}
                </button>
              )}
            </div>
            <div className="hint">
              <kbd>click</kbd> select · <kbd>double-click</kbd> pick · <kbd>space</kbd> pick ·{' '}
              <kbd>←</kbd> <kbd>→</kbd> move
              <br />
              Press <kbd>?</kbd> at any time for the full list.
            </div>
          </div>
        </div>
      </div>
    )
  }

  const current = view[cursor]

  // Rows outside the window become padding rather than elements. Cells stay
  // direct children of the grid, so auto-placement and the measured row height
  // keep working exactly as they did with the whole list in the DOM.
  const first = Math.min(layout.first, Math.max(0, rowCount - 1))
  const last = Math.min(layout.last, rowCount - 1)
  const step = layout.row + GRID_GAP
  const windowed = view.slice(first * layout.cols, (last + 1) * layout.cols)

  return (
    <div className={`app${fullscreen ? ' fullscreen' : ''}`}>
      <TopBar
        folderName={folderName}
        total={items.length}
        pickedCount={picked.size}
        target={target}
        filter={filter}
        sort={sort}
        dating={dating}
        cellSize={cellSize}
        busy={busy}
        onTargetChange={setTarget}
        onFilterChange={setFilter}
        onSortChange={changeSort}
        onCellSizeChange={setCellSize}
        onChangeFolder={() => {
          clearHandle().catch(() => {})
          chooseFolder()
        }}
        onExport={exportPicks}
        onShowShortcuts={() => setShowShortcuts(true)}
      />

      <div className="work">
        <Preview
          item={current}
          position={cursor + 1}
          total={view.length}
          picked={!!current && picked.has(current.key)}
          showInfo={showInfo}
          fullscreen={fullscreen}
          fields={fields}
          onFieldsChange={setFields}
          onToggleInfo={() => setShowInfo((v) => !v)}
          onToggleFullscreen={() => setFullscreen((v) => !v)}
          onToggle={() => current && toggle(current.key)}
        />

        <div
          className="divider"
          onPointerDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the photo list"
        />

        <div
          className="grid-pane"
          ref={paneRef}
          style={{ width: gridWidth }}
          onClick={(e) => {
            const i = indexOfCell(e.target)
            if (i < 0) return
            setCursor(i)
            if ((e.target as Element).closest('.cell-pick')) toggle(view[i].key)
          }}
          onDoubleClick={(e) => {
            const i = indexOfCell(e.target)
            if (i >= 0 && !(e.target as Element).closest('.cell-pick')) toggle(view[i].key)
          }}
        >
          <div
            className="grid"
            ref={gridRef}
            style={
              {
                '--cell': `${cellSize}px`,
                ...(layout.row ? { '--row': `${layout.row}px` } : {}),
                paddingTop: GRID_PAD + first * step,
                paddingBottom: GRID_PAD + Math.max(0, rowCount - 1 - last) * step,
              } as CSSProperties
            }
          >
            {windowed.map((item, i) => {
              const index = first * layout.cols + i
              return (
                <Cell
                  key={item.key}
                  item={item}
                  index={index}
                  picked={picked.has(item.key)}
                  selected={index === cursor}
                />
              )
            })}
          </div>
        </div>
      </div>

      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}

      {toast && (
        <div className="toast" role="status">
          <span className="label">{toast.label}</span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}
