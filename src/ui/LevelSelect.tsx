import { useEffect, useRef } from 'react'
import { LevelMeta } from '../levels'
import { drawWorldPreview } from './worldPreview'

export interface LevelSection {
  title: string
  levels: LevelMeta[]
}

function LevelThumbnail({ level }: { level: LevelMeta }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvasRef.current) drawWorldPreview(canvasRef.current, level.world)
  }, [level])
  return <canvas ref={canvasRef} className="level-thumb" aria-hidden="true" />
}

export function LevelSelect({
  levels,
  sections,
  completedIds,
  onSelect,
  onBack,
  onImport,
  onDelete,
}: {
  levels: LevelMeta[]
  // Optional grouping; without it every level is shown in one list.
  sections?: LevelSection[]
  completedIds: string[]
  onSelect: (level: LevelMeta) => void
  onBack: () => void
  onImport?: () => void
  // Levels that can be removed (the player's own imported / custom ones) get a delete button.
  onDelete?: { canDelete: (level: LevelMeta) => boolean; remove: (level: LevelMeta) => void }
}) {
  const groups = sections ?? [{ title: '', levels }]
  const done = levels.filter((l) => completedIds.includes(l.id)).length
  return (
    <div className="level-select">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack}>
          <span aria-hidden="true">‹</span>
          <span className="sr-only">返回</span>
        </button>
        <div className="topbar-title">
          <div className="topbar-name">选择关卡</div>
          <div className="topbar-sub">已完成 {done} / {levels.length}</div>
        </div>
        {onImport !== undefined ? (
          <button className="icon-btn import-btn" onClick={onImport} title="汇入关卡">
            <span aria-hidden="true">＋</span>
            <span className="sr-only">汇入关卡</span>
          </button>
        ) : (
          <div className="topbar-spacer" />
        )}
      </header>
      {groups.filter((g) => g.levels.length > 0).map((group) => (
        <section key={group.title} className="level-section">
          {group.title !== '' && <h2 className="level-section-title">{group.title}</h2>}
          <ul className="level-grid">
            {group.levels.map((level, i) => {
              const complete = completedIds.includes(level.id)
              return (
                <li key={level.id} className="level-tile-wrap">
                  {onDelete?.canDelete(level) && (
                    <button className="level-tile-delete" aria-label={`删除 ${level.name}`} onClick={() => onDelete.remove(level)}>✕</button>
                  )}
                  <button className={`level-tile${complete ? ' is-complete' : ''}`} onClick={() => onSelect(level)}>
                    <LevelThumbnail level={level} />
                    <span className="level-tile-index">{i + 1}</span>
                    <span className="level-tile-name">
                      {level.name}
                      {complete ? ' ✓' : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
