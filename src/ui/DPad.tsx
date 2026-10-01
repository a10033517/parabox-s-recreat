import { Direction } from '../game/engine/types'

// A cross-shaped pad: up / left / right / down around an empty centre.
export function DPad({ onMove }: { onMove: (direction: Direction) => void }) {
  return (
    <div className="dpad">
      <button className="dpad-btn dpad-up" aria-label="上" onClick={() => onMove('up')}>▲</button>
      <div className="dpad-row">
        <button className="dpad-btn dpad-left" aria-label="左" onClick={() => onMove('left')}>◀</button>
        <button className="dpad-btn dpad-down" aria-label="下" onClick={() => onMove('down')}>▼</button>
        <button className="dpad-btn dpad-right" aria-label="右" onClick={() => onMove('right')}>▶</button>
      </div>
    </div>
  )
}
