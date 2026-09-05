import type { Filter } from './types'

interface Props {
  folderName: string
  total: number
  pickedCount: number
  filter: Filter
  cellSize: number
  onFilterChange: (f: Filter) => void
  onCellSizeChange: (n: number) => void
  onChangeFolder: () => void
}

export function TopBar(p: Props) {
  const tabs: { id: Filter; text: string; count: number }[] = [
    { id: 'all', text: 'All', count: p.total },
    { id: 'picked', text: 'Picked', count: p.pickedCount },
    { id: 'unpicked', text: 'Unpicked', count: p.total - p.pickedCount },
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
    </header>
  )
}
