import { useEffect, useRef, useState } from 'react'
import { createGameState, currentGrid, GameState, isWon, move, undo } from './engine/GameState'
import { renderGrid } from './render/CanvasRenderer'
import { DPad } from '../ui/DPad'
import { SwipeLayer } from '../ui/SwipeLayer'
import { Direction, Grid } from './engine/types'

const CELL_SIZE = 32

export function GameScreen({
  initialGrid,
  onExit,
  onWin,
}: {
  initialGrid: Grid
  onExit: () => void
  onWin: () => void
}) {
  const [state, setState] = useState<GameState>(() => createGameState(initialGrid))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wonRef = useRef(false)

  const handleMove = (direction: Direction) => {
    setState((s) => move(s, direction))
  }

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderGrid(ctx, currentGrid(state), 0, 0, CELL_SIZE)
  }, [state])

  useEffect(() => {
    if (isWon(state) && !wonRef.current) {
      wonRef.current = true
      onWin()
    }
  }, [state, onWin])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      const direction = map[e.key]
      if (direction) handleMove(direction)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="game-screen">
      <div className="hud">
        <span>步数: {state.history.length - 1}</span>
        <button onClick={() => setState((s) => undo(s))}>复位上一步</button>
        <button onClick={onExit}>离开</button>
      </div>
      <SwipeLayer onMove={handleMove}>
        <canvas ref={canvasRef} width={CELL_SIZE * currentGrid(state).width} height={CELL_SIZE * currentGrid(state).height} />
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
