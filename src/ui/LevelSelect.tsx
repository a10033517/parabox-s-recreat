import { LevelMeta } from '../levels'

export function LevelSelect({
  levels,
  completedIds,
  onSelect,
  onBack,
}: {
  levels: LevelMeta[]
  completedIds: string[]
  onSelect: (level: LevelMeta) => void
  onBack: () => void
}) {
  return (
    <div className="level-select">
      <button onClick={onBack}>返回</button>
      <ul>
        {levels.map((level) => (
          <li key={level.id}>
            <button onClick={() => onSelect(level)}>
              {level.name}
              {completedIds.includes(level.id) ? ' ✓' : ''}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
