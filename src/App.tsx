import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Cell } from './Cell'
import { Preview } from './Preview'
import { Shortcuts } from './Shortcuts'
import { TopBar } from './TopBar'
import { DEFAULT_FIELDS, type FieldId } from './exif'
import {
  copyToFolder,
  ensureReadPermission,
  pickDestFolder,
  pickSourceFolder,
  scanFolder,
  supportsFileSystemAccess,
} from './fs'
import { clearHandle, loadHandle, saveHandle } from './idb'
import type { Filter, PhotoItem } from './types'

const picksKey = (folder: string) => `photopicker:picks:${folder}`
const TARGET_KEY = 'photopicker:target'
const SIZE_KEY = 'photopicker:cellsize'
const WIDTH_KEY = 'photopicker:gridwidth'
const FIELDS_KEY = 'photopicker:fields'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const readNumber = (key: string, fallback: number) => Number(localStorage.getItem(key)) || fallback

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
  const [cursor, setCursor] = useState(0)
  const [rowHeight, setRowHeight] = useState(0)
  const [showInfo, setShowInfo] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [scanning, setScanning] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ label: string; text: string } | null>(null)
  const [resumable, setResumable] = useState<FileSystemDirectoryHandle | null>(null)

  const gridRef = useRef<HTMLDivElement>(null)
  const supported = supportsFileSystemAccess()

  useEffect(() => {
    loadHandle().then((h) => h && setResumable(h)).catch(() => {})
  }, [])

  useEffect(() => localStorage.setItem(TARGET_KEY, String(target)), [target])
  useEffect(() => localStorage.setItem(SIZE_KEY, String(cellSize)), [cellSize])
  useEffect(() => localStorage.setItem(WIDTH_KEY, String(gridWidth)), [gridWidth])
  useEffect(() => localStorage.setItem(FIELDS_KEY, JSON.stringify(fields)), [fields])

  useEffect(() => {
    if (folderName) localStorage.setItem(picksKey(folderName), JSON.stringify([...picked]))
  }, [picked, folderName])

  useEffect(() => {
    if (!toast || busy) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast, busy])

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
          return move(fullscreen ? 1 : columnCount())
        case 'ArrowUp':
          return move(fullscreen ? -1 : -columnCount())
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
  }, [view, cursor, fullscreen, showShortcuts, items.length, toggle])

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const onMove = (ev: PointerEvent) =>
      setGridWidth(clamp(window.innerWidth - ev.clientX, 200, window.innerWidth - 360))
    const stop = () => {
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

  return (
    <div className={`app${fullscreen ? ' fullscreen' : ''}`}>
      <TopBar
        folderName={folderName}
        total={items.length}
        pickedCount={picked.size}
        target={target}
        filter={filter}
        cellSize={cellSize}
        busy={busy}
        onTargetChange={setTarget}
        onFilterChange={setFilter}
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
          className="grid"
          ref={gridRef}
          style={
            {
              '--cell': `${cellSize}px`,
              ...(rowHeight ? { '--row': `${rowHeight}px` } : {}),
              width: gridWidth,
            } as CSSProperties
          }
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
