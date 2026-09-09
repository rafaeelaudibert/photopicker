import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_FIELDS, FIELDS, formatBytes, readExif, type FieldId } from './exif'
import { loadFrame, peekFrame, type Frame } from './frames'
import { KEY } from './shortcut-list'
import { getCached } from './thumbs'
import type { PhotoItem } from './types'

/** How long the cursor has to sit still before the full frame is fetched. At
 *  key repeat speed every photo passed would otherwise cost a file read and a
 *  full decode, all of them thrown away before they finished. */
const SETTLE_MS = 90

interface Props {
  item: PhotoItem | undefined
  position: number
  total: number
  picked: boolean
  showInfo: boolean
  fullscreen: boolean
  fields: FieldId[]
  onFieldsChange: (fields: FieldId[]) => void
  onToggleInfo: () => void
  onToggleFullscreen: () => void
  onToggle: () => void
}

/** The working frame: full resolution, EXIF underneath, no chrome on the image itself. */
export function Preview(p: Props) {
  const { item } = p
  const [src, setSrc] = useState<string>()
  const [frame, setFrame] = useState<Frame>()
  const [exif, setExif] = useState<{ key: string; data: Partial<Record<FieldId, string>> }>({
    key: '',
    data: {},
  })
  const [rows, setRows] = useState<FieldId[]>([])
  const [actualSize, setActualSize] = useState(false)
  const [editingFields, setEditingFields] = useState(false)

  useEffect(() => {
    if (!item) {
      setSrc(undefined)
      setFrame(undefined)
      return
    }
    let stale = false
    setActualSize(false)

    const ready = peekFrame(item.key)
    if (ready) {
      setSrc(ready.url)
      setFrame(ready)
    } else {
      // Paint the grid thumbnail at once. It is soft, but it is this photo, so
      // the stage is never blank while the real frame is on its way.
      setSrc(getCached(item.key))
      setFrame(undefined)
    }

    const settle = setTimeout(
      () => {
        loadFrame(item).then((next) => {
          if (stale) return
          setSrc(next.url)
          setFrame(next)
          readExif(next.file).then((data) => !stale && setExif({ key: item.key, data }))
        }, () => {})
      },
      ready ? 0 : SETTLE_MS,
    )

    return () => {
      stale = true
      clearTimeout(settle)
    }
  }, [item])

  const showing = !!item && !!frame && frame.url === src
  const settled = showing && exif.key === item.key

  const values = useMemo<Partial<Record<FieldId, string>>>(
    () => ({
      ...(item && exif.key === item.key ? exif.data : {}),
      dimensions: showing ? `${frame.width} × ${frame.height}` : undefined,
      size: showing ? formatBytes(frame.file.size) : undefined,
      path: item?.key,
    }),
    [exif, frame, showing, item],
  )

  /** Which rows the strip lays out. Only refreshed once the photo has fully
   *  arrived, so navigating blanks the values in place rather than collapsing
   *  the strip and shifting the frame above it. */
  useEffect(() => {
    if (!settled) return
    const next = FIELDS.filter((f) => p.fields.includes(f.id) && values[f.id]).map((f) => f.id)
    setRows((prev) =>
      prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next,
    )
  }, [settled, values, p.fields])

  const toggleField = (id: FieldId) =>
    p.onFieldsChange(
      p.fields.includes(id)
        ? p.fields.filter((f) => f !== id)
        : FIELDS.map((f) => f.id).filter((f) => f === id || p.fields.includes(f)),
    )

  if (!item) {
    return (
      <section className="preview">
        <div className="preview-stage preview-blank">Nothing to show in this filter.</div>
      </section>
    )
  }

  const shown = FIELDS.filter((f) => rows.includes(f.id))

  return (
    <section className="preview">
      <div
        className={`preview-stage${actualSize ? ' actual' : ''}`}
        onClick={() => setActualSize((v) => !v)}
        title={actualSize ? 'Click to fit' : 'Click for actual size'}
      >
        {src && <img src={src} alt={item.name} draggable={false} />}
        {!showing && <div className="stage-note">Loading full size</div>}
      </div>

      <footer className="preview-bar">
        <button
          type="button"
          className={`btn btn-pick${p.picked ? ' on' : ''}`}
          onClick={p.onToggle}
        >
          {p.picked ? 'Picked' : 'Pick'}
          <kbd className="kbd">{KEY.pick}</kbd>
        </button>
        <span className="preview-name" title={item.key}>
          {item.name}
        </span>
        <span className="preview-pos">
          {p.position} / {p.total}
        </span>
        <button
          type="button"
          className="btn"
          aria-pressed={p.showInfo}
          onClick={p.onToggleInfo}
        >
          Info
          <kbd className="kbd">{KEY.info}</kbd>
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={p.fullscreen}
          onClick={p.onToggleFullscreen}
        >
          {p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          <kbd className="kbd">{KEY.fullscreen}</kbd>
        </button>
      </footer>

      {p.showInfo && (
        <div className="info">
          {editingFields ? (
            <div className="info-fields">
              {FIELDS.map((f) => (
                <label key={f.id} className="info-check">
                  <input
                    type="checkbox"
                    checked={p.fields.includes(f.id)}
                    onChange={() => toggleField(f.id)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          ) : shown.length ? (
            <dl className="info-rows">
              {shown.map((f) => (
                <div key={f.id} className="info-row">
                  <dt className="label">{f.label}</dt>
                  <dd>{values[f.id] ?? ''}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <span className="info-empty">
              {settled ? 'No EXIF recorded in this file.' : ''}
            </span>
          )}

          <button type="button" className="info-edit" onClick={() => setEditingFields((v) => !v)}>
            {editingFields ? 'Done' : 'Fields'}
          </button>
          {editingFields && (
            <button
              type="button"
              className="info-edit"
              onClick={() => p.onFieldsChange([...DEFAULT_FIELDS])}
            >
              Reset
            </button>
          )}
        </div>
      )}
    </section>
  )
}
