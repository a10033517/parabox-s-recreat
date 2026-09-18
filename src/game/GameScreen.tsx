import { useEffect, useRef, useState } from 'react'
import { GameState } from './engine/GameState'
import { Direction, World } from './engine/types'
import { DrawContext, DEFAULT_RENDER_BUDGET, drawBoardRecursive, indexPiecesByBoard } from './render/CanvasRenderer'
import { CameraTransform, Viewport, cameraForPlayer } from './render/camera'
import { resolveAnchorBoardId } from './render/recursiveTransform'
import { DPad } from '../ui/DPad'
import { SwipeLayer } from '../ui/SwipeLayer'

export function GameScreen({
  initialWorld,
  onExit,
  onWin,
}: {
  initialWorld: World
  onExit: () => void
  onWin: () => void
}) {
  const stateRef = useRef<GameState>()
  if (!stateRef.current) stateRef.current = new GameState(initialWorld)
  const state = stateRef.current

  const [, setTick] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wonRef = useRef(false)
  const viewportRef = useRef<Viewport>({ width: 320, height: 320 })

  const handleMove = (direction: Direction) => {
    if (state.move(direction)) setTick((t) => t + 1)
  }

  const handleUndo = () => {
    if (state.undo()) {
      wonRef.current = false
      setTick((t) => t + 1)
    }
  }

  useEffect(() => {
    if (state.isWon && !wonRef.current) {
      wonRef.current = true
      onWin()
    }
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateViewport = () => {
      viewportRef.current = { width: el.clientWidth || 320, height: el.clientHeight || 320 }
    }
    updateViewport()
    // jsdom (this project's test environment) does not implement ResizeObserver at all —
    // the initial size captured above still applies; a real browser gets live resizing.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateViewport)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      const direction = map[e.key]
      if (direction) handleMove(direction)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let rafId: number

    const frame = () => {
      const viewport = viewportRef.current
      const dpr = window.devicePixelRatio || 1
      const targetWidth = Math.round(viewport.width * dpr)
      const targetHeight = Math.round(viewport.height * dpr)
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewport.width, viewport.height)

      const world = state.current
      const camera: CameraTransform = cameraForPlayer(world, { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels })
      const anchorBoardId = resolveAnchorBoardId(world, camera.anchor)
      if (anchorBoardId !== null && world.boards[anchorBoardId] !== undefined) {
        const dc: DrawContext = {
          ctx,
          world,
          camera,
          viewport,
          budget: DEFAULT_RENDER_BUDGET,
          piecesByBoard: indexPiecesByBoard(world),
          cellsDrawnSoFar: { count: 0 },
        }
        drawBoardRecursive(dc, world.boards[anchorBoardId], { boardId: anchorBoardId, originX: 0, originY: 0, scale: 1 }, 0, 0, false)
      }
      rafId = requestAnimationFrame(frame)
    }
    // Draw synchronously once up front — requestAnimationFrame always defers to the
    // next paint, so without this the canvas would sit at the browser's default
    // 300x150 size (and show nothing) for one visible frame after every mount.
    frame()
    return () => cancelAnimationFrame(rafId)
  }, [state])

  return (
    <div className="game-screen">
      <div className="hud">
        <span>步数: {state.moveCount}</span>
        <button onClick={handleUndo}>复位上一步</button>
        <button onClick={onExit}>离开</button>
      </div>
      <SwipeLayer onMove={handleMove}>
        <div ref={containerRef} className="game-viewport">
          <canvas ref={canvasRef} />
        </div>
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
