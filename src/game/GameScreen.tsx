import { useEffect, useRef, useState } from 'react'
import { GameState } from './engine/GameState'
import { Direction, PLAYER_ID, World } from './engine/types'
import { renderBoard } from './render/CanvasRenderer'
import { DPad } from '../ui/DPad'
import { SwipeLayer } from '../ui/SwipeLayer'

const CELL_SIZE = 32

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
  const wonRef = useRef(false)

  const handleMove = (direction: Direction) => {
    if (state.move(direction)) setTick((t) => t + 1)
  }

  const handleUndo = () => {
    if (state.undo()) {
      wonRef.current = false
      setTick((t) => t + 1)
    }
  }

  const currentBoardId = state.current.locations[PLAYER_ID].board
  const currentBoard = state.current.boards[currentBoardId]

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderBoard(ctx, currentBoard, state.current, CELL_SIZE)
  }, [state.current, currentBoard])

  useEffect(() => {
    if (state.isWon && !wonRef.current) {
      wonRef.current = true
      onWin()
    }
  }, [state.current, onWin])

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
        <span>步数: {state.moveCount}</span>
        <button onClick={handleUndo}>复位上一步</button>
        <button onClick={onExit}>离开</button>
      </div>
      <SwipeLayer onMove={handleMove}>
        <canvas ref={canvasRef} width={CELL_SIZE * currentBoard.size} height={CELL_SIZE * currentBoard.size} />
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
