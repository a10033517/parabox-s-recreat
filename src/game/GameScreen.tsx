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
  // A lost move removes the player from `locations` entirely (see
  // rules.ts's checkLose), so there is no longer a board to read the
  // player's position from. Remember the last board the player actually
  // stood on so rendering can keep showing it (now without the player
  // drawn on it) instead of crashing on a missing location.
  const lastBoardIdRef = useRef(initialWorld.locations[PLAYER_ID].board)

  const handleMove = (direction: Direction) => {
    if (state.move(direction)) setTick((t) => t + 1)
  }

  const handleUndo = () => {
    if (state.undo()) {
      wonRef.current = false
      setTick((t) => t + 1)
    }
  }

  const playerLocation = state.current.locations[PLAYER_ID]
  if (playerLocation) lastBoardIdRef.current = playerLocation.board
  const currentBoardId = lastBoardIdRef.current
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
      {state.isLost && (
        <div className="lose-notice" data-testid="lose-notice">
          <p>玩家迷失在无限递归中</p>
          <button onClick={handleUndo}>复位上一步</button>
        </div>
      )}
      <SwipeLayer onMove={handleMove}>
        <canvas ref={canvasRef} width={CELL_SIZE * currentBoard.size} height={CELL_SIZE * currentBoard.size} />
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
