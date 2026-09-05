import { memo, useEffect, useRef, useState } from 'react'
import { getCached, requestThumb } from './thumbs'
import { useInView } from './useInView'
import type { PhotoItem } from './types'

interface Props {
  item: PhotoItem
  picked: boolean
  selected: boolean
}

/** Props stay stable so the grid can memoise thousands of these. Clicks and
 *  focus are delegated to the grid container. */
function CellImpl({ item, picked, selected }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const [url, setUrl] = useState<string | undefined>(() => getCached(item.key))

  useEffect(() => {
    if (!inView || url) return
    return requestThumb(item, setUrl)
  }, [inView, url, item])

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      className={`cell${picked ? ' picked' : ''}${selected ? ' selected' : ''}`}
      aria-pressed={picked}
      aria-label={`${item.name}, ${picked ? 'picked' : 'not picked'}`}
    >
      {url && <img src={url} alt="" className="loaded" draggable={false} />}
      <button type="button" className="cell-pick" tabIndex={-1} aria-hidden="true">
        {picked ? '✓' : '+'}
      </button>
      <span className="cell-name">{item.name}</span>
    </div>
  )
}

export const Cell = memo(CellImpl)
