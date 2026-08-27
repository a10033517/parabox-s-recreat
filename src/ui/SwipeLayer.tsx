import { useRef, ReactNode } from 'react'
import { Direction } from '../game/engine/types'

const SWIPE_THRESHOLD = 24

export function SwipeLayer({ onMove, children }: { onMove: (direction: Direction) => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null)

  return (
    <div
      data-testid="swipe-layer"
      onTouchStart={(e) => {
        const t = e.touches[0]
        start.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        if (!start.current) return
        const t = e.changedTouches[0] ?? e.touches[0]
        const dx = t.clientX - start.current.x
        const dy = t.clientY - start.current.y
        start.current = null
        if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return
        if (Math.abs(dx) > Math.abs(dy)) {
          onMove(dx > 0 ? 'right' : 'left')
        } else {
          onMove(dy > 0 ? 'down' : 'up')
        }
      }}
    >
      {children}
    </div>
  )
}
