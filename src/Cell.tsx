import { memo, useEffect, useRef, useState } from 'react'
import { getCached, requestThumb } from './thumbs'
import type { PhotoItem } from './types'

interface Props {
  item: PhotoItem
  /** Position in the filtered list, not in the window. The grid reads it back
   *  off the DOM to turn a click into a cursor position. */
  index: number
  picked: boolean
  selected: boolean
}

/** Props stay stable so the grid can memoise the window. Clicks and focus are
 *  delegated to the grid container. Being mounted means being on screen, so a
 *  cell asks for its thumbnail as soon as it exists. */
function CellImpl({ item, index, picked, selected }: Props) {
  const [url, setUrl] = useState<string | undefined>(() => getCached(item.key))
  const painted = useRef(url)

  useEffect(() => {
    let stale = false
    const stop = requestThumb(item, (next) => {
      if (stale || next === painted.current) return
      const probe = new Image()
      probe.src = next
      // Pointing an <img> at a src that has not decoded paints one empty frame.
      // Decode first, then swap, so a tile never blinks on the way to sharp.
      const show = () => {
        if (stale) return
        painted.current = next
        setUrl(next)
      }
      probe.decode().then(show, show)
    })
    return () => {
      stale = true
      stop()
    }
  }, [item])

  return (
    <div
      data-index={index}
      role="button"
      tabIndex={-1}
      className={`cell${picked ? ' picked' : ''}${selected ? ' selected' : ''}`}
      aria-pressed={picked}
      aria-label={`${item.name}, ${picked ? 'picked' : 'not picked'}`}
    >
      {url && <img src={url} alt="" draggable={false} />}
      {/* A span, not a button: the cell itself is the control, and a focusable
          element inside another one is invalid. Clicks are delegated anyway. */}
      <span className="cell-pick" aria-hidden="true">
        {picked ? '✓' : '+'}
      </span>
      <span className="cell-name">{item.name}</span>
    </div>
  )
}

export const Cell = memo(CellImpl)
