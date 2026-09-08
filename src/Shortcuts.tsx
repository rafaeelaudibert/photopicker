import { KEYS, MOUSE } from './shortcut-list'

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <span className="label">Shortcuts</span>
          <button type="button" className="info-edit" onClick={onClose}>
            Close <kbd className="kbd">Esc</kbd>
          </button>
        </header>

        <div className="sheet-cols">
          <section>
            <span className="label">Keyboard</span>
            <dl className="sheet-list">
              {KEYS.map((s) => (
                <div key={s.label} className="sheet-row">
                  <dt className="sheet-keys">
                    {s.keys.map((k) => (
                      <kbd key={k} className="kbd">
                        {k}
                      </kbd>
                    ))}
                  </dt>
                  <dd>{s.label}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <span className="label">Mouse</span>
            <dl className="sheet-list">
              {MOUSE.map((s) => (
                <div key={s.action} className="sheet-row">
                  <dt className="sheet-action">{s.action}</dt>
                  <dd>{s.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
