import { useEffect, useRef, useState } from 'react'
import { BoardId, World } from '../game/engine/types'
import { DEFAULT_RENDER_BUDGET, DrawContext, drawBoardRecursive, indexPiecesByBoard } from '../game/render/CanvasRenderer'
import { worldToScreen } from '../game/render/camera'

export interface CellRef {
  x: number
  y: number
}

// The room being edited, drawn with the game's own renderer (boxes show their real recursive
// contents) plus an editing overlay: grid, hovered cell, selected cell.
export function BoardView({
  world,
  boardId,
  hostColor,
  selected,
  readOnly,
  onCellDown,
  onCellEnter,
  onCellDouble,
  onPointerUp,
}: {
  world: World
  boardId: BoardId
  hostColor?: string
  selected?: CellRef
  readOnly?: boolean
  onCellDown: (cell: CellRef, button: number) => void
  onCellEnter: (cell: CellRef) => void
  onCellDouble: (cell: CellRef) => void
  onPointerUp: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 600, h: 600 })
  const [hover, setHover] = useState<CellRef | null>(null)
  const board = world.boards[boardId]

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const side = Math.max(120, Math.min(size.w, size.h))
  const camera = { anchor: 'root' as const, centerX: (board?.size ?? 1) / 2, centerY: (board?.size ?? 1) / 2, pixelsPerRootUnit: side / ((board?.size ?? 1) + 0.6) }
  const viewport = { width: side, height: side }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || board === undefined) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(side * dpr)
    canvas.height = Math.round(side * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0b0b0b'
    ctx.fillRect(0, 0, side, side)
    const dc: DrawContext = {
      ctx, world, camera, viewport, budget: DEFAULT_RENDER_BUDGET,
      piecesByBoard: indexPiecesByBoard(world), cellsDrawnSoFar: { count: 0 },
    }
    try {
      drawBoardRecursive(dc, board, { boardId, originX: 0, originY: 0, scale: 1 }, 0, 0, false, hostColor)
    } catch {
      // A half-edited world can be momentarily inconsistent; the overlay still draws.
    }
    const cell = camera.pixelsPerRootUnit
    const origin = worldToScreen(0, 0, camera, viewport)
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i <= board.size; i++) {
      ctx.moveTo(origin.x + i * cell, origin.y)
      ctx.lineTo(origin.x + i * cell, origin.y + board.size * cell)
      ctx.moveTo(origin.x, origin.y + i * cell)
      ctx.lineTo(origin.x + board.size * cell, origin.y + i * cell)
    }
    ctx.stroke()
    if (hover !== null && !readOnly) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ctx.fillRect(origin.x + hover.x * cell, origin.y + hover.y * cell, cell, cell)
    }
    if (selected !== undefined) {
      ctx.strokeStyle = '#3ddc84'
      ctx.lineWidth = 3
      ctx.strokeRect(origin.x + selected.x * cell + 1.5, origin.y + selected.y * cell + 1.5, cell - 3, cell - 3)
    }
  })

  const cellAt = (e: React.MouseEvent): CellRef | null => {
    if (board === undefined) return null
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left - side / 2) / camera.pixelsPerRootUnit + camera.centerX)
    const y = Math.floor((e.clientY - rect.top - side / 2) / camera.pixelsPerRootUnit + camera.centerY)
    return x >= 0 && y >= 0 && x < board.size && y < board.size ? { x, y } : null
  }

  return (
    <div ref={wrapRef} className="le-board-wrap">
      <canvas
        ref={canvasRef}
        className={`le-board${readOnly ? ' is-readonly' : ''}`}
        style={{ width: side, height: side }}
        onContextMenu={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          const cell = cellAt(e)
          if (cell !== null && !readOnly) onCellDown(cell, e.button)
        }}
        onMouseMove={(e) => {
          const cell = cellAt(e)
          if (cell?.x !== hover?.x || cell?.y !== hover?.y) {
            setHover(cell)
            if (cell !== null && !readOnly) onCellEnter(cell)
          }
        }}
        onMouseLeave={() => setHover(null)}
        onMouseUp={onPointerUp}
        onDoubleClick={(e) => {
          const cell = cellAt(e)
          if (cell !== null) onCellDouble(cell)
        }}
      />
      {hover !== null && <div className="le-board-coord">({hover.x}, {hover.y})</div>}
    </div>
  )
}
