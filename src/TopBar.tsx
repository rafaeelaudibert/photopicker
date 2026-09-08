import { KEY } from './shortcut-list'
import type { Filter } from './types'

interface Props {
  folderName: string
  total: number
  pickedCount: number
  target: number
  filter: Filter
  cellSize: number
  busy: boolean
  onTargetChange: (n: number) => void
  onFilterChange: (f: Filter) => void
  onCellSizeChange: (n: number) => void
  onChangeFolder: () => void
  onExport: () => void
  onShowShortcuts: () => void
}

export function TopBar(p: Props) {
  const over = p.pickedCount > p.target
  const fill = p.target > 0 ? Math.min(100, (p.pickedCount / p.target) * 100) : 0

  const tabs: { id: Filter; text: string; count: number; key: string }[] = [
    { id: 'all', text: 'All', count: p.total, key: KEY.all },
    { id: 'picked', text: 'Picked', count: p.pickedCount, key: KEY.picked },
    { id: 'unpicked', text: 'Unpicked', count: p.total - p.pickedCount, key: KEY.unpicked },
  ]

  return (
    <header className="bar">
      <button
        type="button"
        className="bar-folder"
        onClick={p.onChangeFolder}
        title={`${p.folderName}: click to open a different folder`}
      >
        {p.folderName}
      </button>

      <div className="filters" role="group" aria-label="Filter photos">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="filter"
            aria-pressed={p.filter === t.id}
            onClick={() => p.onFilterChange(t.id)}
          >
            <kbd className="kbd">{t.key}</kbd>
            {t.text}
            <span className="filter-count">{t.count}</span>
          </button>
        ))}
      </div>

      <input
        className="zoom"
        type="range"
        min={110}
        max={400}
        step={10}
        value={p.cellSize}
        onChange={(e) => p.onCellSizeChange(Number(e.target.value))}
        aria-label="Thumbnail size"
      />

      <div className="quota">
        <div className={`counter${over ? ' over' : ''}`}>
          <span className="counter-picked">{String(p.pickedCount).padStart(3, '0')}</span>
          <span className="counter-slash">/</span>
          <input
            className="counter-target"
            type="number"
            min={1}
            value={p.target}
            onChange={(e) => p.onTargetChange(Math.max(1, Number(e.target.value) || 1))}
            aria-label="Target number of photos"
          />
        </div>
        <div className="gauge">
          <div className={`gauge-fill${over ? ' over' : ''}`} style={{ width: `${fill}%` }} />
        </div>
        {over && <div className="over-note">{p.pickedCount - p.target} over</div>}
      </div>

      <button
        type="button"
        className="btn btn-primary"
        onClick={p.onExport}
        disabled={p.pickedCount === 0 || p.busy}
      >
        Copy {p.pickedCount}
      </button>

      <button
        type="button"
        className="btn btn-help"
        onClick={p.onShowShortcuts}
        aria-label="Show shortcuts"
        title="Shortcuts"
      >
        {KEY.help}
      </button>
    </header>
  )
}
