import { useEffect, useRef } from 'react'
import { World } from '../game/engine/types'
import { drawWorldPreview } from './worldPreview'

// A 5x5 room that contains itself at its centre: zooming into the centre by 5x shows the same
// picture again, so a steady zoom loops forever — the game's idea in one image.
function heroWorld(): World {
  const size = 5
  const cells = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({ type: (x === 0 || y === 0 || x === size - 1 || y === size - 1) && !(x === 2 && y === 0) ? ('wall' as const) : ('floor' as const) })),
  )
  cells[3][1] = { type: 'floor' }
  return {
    boards: { hero: { id: 'hero', size, cells, color: '#3d9bff' } },
    pieces: {
      loop: { id: 'loop', kind: 'container', boardRef: 'hero' },
      player: { id: 'player', kind: 'player', color: '#c4006f' },
      box: { id: 'box', kind: 'normal', color: '#ffb236' },
    },
    locations: {
      loop: { board: 'hero', x: 2, y: 2 },
      player: { board: 'hero', x: 1, y: 3 },
      box: { board: 'hero', x: 3, y: 1 },
    },
  }
}

const ZOOM_PERIOD_MS = 6000

export function MenuScreen({
  onStart,
  onEditor,
  completed,
  total,
}: {
  onStart: () => void
  onEditor: () => void
  completed?: number
  total?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const world = heroWorld()
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let rafId = 0
    const start = performance.now()
    const frame = () => {
      // The loop cell (2,2) holds the whole room at 1/5 scale, and the room's centre (2.5, 2.5)
      // is the fixed point of that map: zooming x5 about it lands exactly on the start frame.
      const phase = reduceMotion ? 0 : ((performance.now() - start) % ZOOM_PERIOD_MS) / ZOOM_PERIOD_MS
      drawWorldPreview(canvas, world, { zoom: Math.pow(5, phase), cx: 2.5, cy: 2.5, margin: 0.6 })
      if (!reduceMotion) rafId = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <div className="menu-screen">
      <div className="menu-hero">
        <canvas ref={canvasRef} className="menu-hero-canvas" aria-hidden="true" />
      </div>
      <h1 className="menu-title">Parabox Tribute</h1>
      <p className="menu-subtitle">递归推箱子解谜</p>
      {total !== undefined && total > 0 && (
        <div className="menu-progress" aria-label={`已完成 ${completed ?? 0} / ${total} 关`}>
          <div className="menu-progress-bar">
            <div className="menu-progress-fill" style={{ width: `${Math.round(((completed ?? 0) / total) * 100)}%` }} />
          </div>
          <span>{completed ?? 0} / {total}</span>
        </div>
      )}
      <div className="menu-actions">
        <button className="btn-primary" onClick={onStart}>开始游戏</button>
        <button className="btn-secondary" onClick={onEditor}>关卡编辑器</button>
      </div>
    </div>
  )
}
