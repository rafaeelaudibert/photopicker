import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_FIELDS, FIELDS, formatBytes, readExif, type FieldId } from './exif'
import type { PhotoItem } from './types'

interface Props {
  item: PhotoItem | undefined
  position: number
  total: number
  picked: boolean
  showInfo: boolean
  fields: FieldId[]
  onFieldsChange: (fields: FieldId[]) => void
  onToggle: () => void
}

/** The working frame: full resolution, EXIF underneath, no chrome on the image itself. */
export function Preview(p: Props) {
  const { item } = p
  const [url, setUrl] = useState<string>()
  const [file, setFile] = useState<File>()
  const [exif, setExif] = useState<Partial<Record<FieldId, string>>>({})
  const [dimensions, setDimensions] = useState<string>()
  const [actualSize, setActualSize] = useState(false)
  const [editingFields, setEditingFields] = useState(false)

  useEffect(() => {
    if (!item) return
    let stale = false
    let objectUrl: string | undefined
    setActualSize(false)
    setDimensions(undefined)
    setExif({})

    item.handle.getFile().then((f) => {
      if (stale) return
      objectUrl = URL.createObjectURL(f)
      setFile(f)
      setUrl(objectUrl)
      readExif(f).then((data) => !stale && setExif(data))
    })

    return () => {
      stale = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(undefined)
    }
  }, [item])

  const values = useMemo<Partial<Record<FieldId, string>>>(
    () => ({
      ...exif,
      dimensions,
      size: file ? formatBytes(file.size) : undefined,
      path: item?.key,
    }),
    [exif, dimensions, file, item],
  )

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

  const shown = FIELDS.filter((f) => p.fields.includes(f.id) && values[f.id])

  return (
    <section className="preview">
      <div
        className={`preview-stage${actualSize ? ' actual' : ''}`}
        onClick={() => setActualSize((v) => !v)}
        title={actualSize ? 'Click to fit' : 'Click for actual size'}
      >
        {url && (
          <img
            src={url}
            alt={item.name}
            draggable={false}
            onLoad={(e) =>
              setDimensions(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)
            }
          />
        )}
      </div>

      <footer className="preview-bar">
        <button
          type="button"
          className={`btn btn-pick${p.picked ? ' on' : ''}`}
          onClick={p.onToggle}
        >
          {p.picked ? 'Picked' : 'Pick'}
        </button>
        <span className="preview-name" title={item.key}>
          {item.name}
        </span>
        <span className="preview-pos">
          {p.position} / {p.total}
        </span>
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
                  <dd>{values[f.id]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <span className="info-empty">No EXIF recorded in this file.</span>
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
