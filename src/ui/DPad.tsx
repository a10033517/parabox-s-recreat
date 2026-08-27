import { Direction } from '../game/engine/types'

export function DPad({ onMove }: { onMove: (direction: Direction) => void }) {
  return (
    <div className="dpad">
      <button aria-label="上" onClick={() => onMove('up')}>▲</button>
      <div className="dpad-row">
        <button aria-label="左" onClick={() => onMove('left')}>◀</button>
        <button aria-label="下" onClick={() => onMove('down')}>▼</button>
        <button aria-label="右" onClick={() => onMove('right')}>▶</button>
      </div>
    </div>
  )
}
