import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Cell } from './Cell'
import { TopBar } from './TopBar'
import { ensureReadPermission, pickSourceFolder, scanFolder, supportsFileSystemAccess } from './fs'
import { clearHandle, loadHandle, saveHandle } from './idb'
import type { Filter, PhotoItem } from './types'

const picksKey = (folder: string) => `photopicker:picks:${folder}`
const SIZE_KEY = 'photopicker:cellsize'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const readNumber = (key: string, fallback: number) => Number(localStorage.getItem(key)) || fallback

export default function App() {
  const [folderName, setFolderName] = useState('')
  const [items, setItems] = useState<PhotoItem[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [cellSize, setCellSize] = useState(() => readNumber(SIZE_KEY, 150))
  const [filter, setFilter] = useState<Filter>('all')
  const [cursor, setCursor] = useState(0)
  const [rowHeight, setRowHeight] = useState(0)
  const [scanning, setScanning] = useState<number | null>(null)
  const [resumable, setResumable] = useState<FileSystemDirectoryHandle | null>(null)

  const gridRef = useRef<HTMLDivElement>(null)
  const supported = supportsFileSystemAccess()

  useEffect(() => {
    loadHandle().then((h) => h && setResumable(h)).catch(() => {})
  }, [])

  useEffect(() => localStorage.setItem(SIZE_KEY, String(cellSize)), [cellSize])
  useEffect(() => {
    if (folderName) localStorage.setItem(picksKey(folderName), JSON.stringify([...picked]))
  }, [picked, folderName])

  const openFolder = useCallback(async (handle: FileSystemDirectoryHandle) => {
    if (!(await ensureReadPermission(handle))) return
    setScanning(0)
    setResumable(null)
    try {
      const found = await scanFolder(handle, setScanning)
      const valid = new Set(found.map((f) => f.key))
      const stored: string[] = JSON.parse(localStorage.getItem(picksKey(handle.name)) ?? '[]')
      setItems(found)
      setFolderName(handle.name)
      setPicked(new Set(stored.filter((k) => valid.has(k))))
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

  const view = useMemo(() => {
    if (filter === 'picked') return items.filter((i) => picked.has(i.key))
    if (filter === 'unpicked') return items.filter((i) => !picked.has(i.key))
    return items
  }, [items, filter, picked])

  useEffect(() => {
    setCursor((c) => clamp(c, 0, Math.max(0, view.length - 1)))
  }, [view.length])

  const toggle = useCallback((key: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  const indexOfCell = (target: EventTarget) => {
    const el = (target as Element).closest?.('.cell')
    const children = gridRef.current?.children
    return el && children ? Array.prototype.indexOf.call(children, el) : -1
  }

  const columnCount = () => {
    const grid = gridRef.current
    if (!grid) return 1
    return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
  }

  /** Square tiles need an explicit row height, measured from the resolved column. */
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const measure = () => {
      const first = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean)[0]
      const width = Number.parseFloat(first)
      if (width > 0) setRowHeight(Math.round(width))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [cellSize, items.length])

  /** Keeps the selected thumbnail visible as the cursor moves. */
  useEffect(() => {
    const el = gridRef.current?.children[cursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, view])

  useEffect(() => {
    if (!items.length) return

    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
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
          return move(columnCount())
        case 'ArrowUp':
          return move(-columnCount())
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
  }, [view, cursor, items.length, toggle])

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
              <kbd>click</kbd> pick · <kbd>space</kbd> pick · <kbd>←</kbd> <kbd>→</kbd> move ·{' '}
              <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> filter
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TopBar
        folderName={folderName}
        total={items.length}
        pickedCount={picked.size}
        filter={filter}
        cellSize={cellSize}
        onFilterChange={setFilter}
        onCellSizeChange={setCellSize}
        onChangeFolder={() => {
          clearHandle().catch(() => {})
          chooseFolder()
        }}
      />

      <div className="work">
        <div
          className="grid"
          ref={gridRef}
          style={
            {
              '--cell': `${cellSize}px`,
              ...(rowHeight ? { '--row': `${rowHeight}px` } : {}),
            } as CSSProperties
          }
          onClick={(e) => {
            const i = indexOfCell(e.target)
            if (i < 0) return
            setCursor(i)
            toggle(view[i].key)
          }}
        >
          {view.map((item, i) => (
            <Cell
              key={item.key}
              item={item}
              picked={picked.has(item.key)}
              selected={i === cursor}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
