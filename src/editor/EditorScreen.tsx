import { useEffect, useRef, useState } from 'react'
import { BoardId, PieceId, PieceKind, World, occupantAt } from '../game/engine/types'
import { parseLevel, serializeLevel } from '../game/engine/levelSchema'
import { renderBoard } from '../game/render/CanvasRenderer'
import { saveCustomLevel } from '../storage/progress'
import {
  EditorIds,
  canPlacePieceAt,
  createEmptyWorld,
  movePlayer,
  placeContainerBox,
  placeNormalBox,
  placeSelfLoopBox,
  setCellType,
  setRequirement,
} from './worldEdit'

const CELL_SIZE = 32
// A double-click always dispatches `click`, `click`, `dblclick` in that order. To
// tell a genuine single click apart from the first click of a double-click, every
// click's placement is delayed behind a short timer; the double-click handler
// cancels that pending timer before it ever fires, so placeAt runs at most once
// per gesture and never runs at all for a double-click.
const DOUBLE_CLICK_WINDOW_MS = 250
const DEFAULT_ROOT_SIZE = 6
const DEFAULT_INTERIOR_SIZE = 3

type Tool = 'wall' | 'empty' | 'normal-box' | 'container-box' | 'self-loop-box' | 'player' | 'goal-box' | 'goal-player'

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'empty', label: '空地' },
  { tool: 'wall', label: '墙' },
  { tool: 'normal-box', label: '普通箱' },
  { tool: 'container-box', label: '容器箱' },
  { tool: 'self-loop-box', label: '自包箱' },
  { tool: 'goal-box', label: '目标(箱)' },
  { tool: 'goal-player', label: '目标(玩家)' },
  { tool: 'player', label: '玩家起点' },
]

export function EditorScreen({ onBack }: { onBack: () => void }) {
  const [world, setWorld] = useState<World>(() => createEmptyWorld(DEFAULT_ROOT_SIZE))
  // Path of container piece ids entered via double-click; the active board is
  // derived from the last entry's boardRef (or 'root' if empty), so there is
  // only one source of truth for "where am I" instead of tracking board ids
  // separately from the pieces that own them.
  const [path, setPath] = useState<PieceId[]>([])
  const [tool, setTool] = useState<Tool>('wall')
  const [levelName, setLevelName] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const idsRef = useRef<EditorIds>({ nextBoxId: 0, nextBoardId: 0 })
  const pendingPlaceRef = useRef<{ x: number; y: number; timer: number } | null>(null)

  // Deletion only ever walks downward from the current board, so path should
  // never reference a piece the user has been removed out from under — but if
  // that invariant is ever violated, falling back to 'root' fails contained
  // instead of white-screening the whole app (there's no error boundary here).
  const activeBoardId: BoardId =
    path.length === 0 ? 'root' : ((world.pieces[path[path.length - 1]]?.boardRef as BoardId) ?? 'root')
  const activeBoard = world.boards[activeBoardId]

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderBoard(ctx, activeBoard, world, CELL_SIZE)
  }, [world, activeBoard])

  useEffect(() => {
    return () => {
      if (pendingPlaceRef.current) window.clearTimeout(pendingPlaceRef.current.timer)
    }
  }, [])

  const placeAt = (x: number, y: number) => {
    if (tool === 'wall' || tool === 'empty') {
      setWorld((w) => setCellType(w, activeBoardId, x, y, tool === 'wall' ? 'wall' : 'floor'))
      return
    }
    if (tool === 'goal-box' || tool === 'goal-player') {
      setWorld((w) => {
        if (w.boards[activeBoardId].cells[y][x].type === 'wall') return w
        return setRequirement(w, activeBoardId, x, y, tool === 'goal-box' ? 'box' : 'player')
      })
      return
    }
    if (tool === 'player') {
      setWorld((w) => movePlayer(w, activeBoardId, x, y))
      return
    }
    if (tool === 'self-loop-box') {
      const existingId = occupantAt(world, { board: activeBoardId, x, y })
      if (existingId && world.pieces[existingId].kind === 'container') return
      if (!canPlacePieceAt(world, activeBoardId, x, y)) return
      const oldIds = idsRef.current
      setWorld((w) => {
        const result = placeSelfLoopBox(w, activeBoardId, x, y, oldIds)
        if (!result) return w
        idsRef.current = result.ids
        return result.world
      })
      return
    }
    // normal-box / container-box: re-placing the same kind on a cell that
    // already holds it is a no-op, so a double-click's first click can't
    // destroy-and-recreate a box right before the double-click handler
    // enters it.
    const desiredKind: PieceKind = tool === 'container-box' ? 'container' : 'normal'
    const existingId = occupantAt(world, { board: activeBoardId, x, y })
    if (existingId && world.pieces[existingId].kind === desiredKind) return
    // Predict whether the placement will be blocked (target cell's subtree
    // contains the player) before touching idsRef.current at all, so a
    // blocked placement never burns an id.
    if (!canPlacePieceAt(world, activeBoardId, x, y)) return

    // Capture the ids to use in a plain variable (not read back from
    // idsRef.current inside the updater) to avoid React 18 StrictMode
    // double-invoking the updater and burning two ids per click: calling
    // placeNormalBox/placeContainerBox twice with the same `oldIds` is
    // idempotent and yields the same result.ids both times.
    const oldIds = idsRef.current

    setWorld((w) => {
      // worldEdit.ts owns id-allocation arithmetic; idsRef.current is always
      // set from a placement function's own returned ids, never hand-computed
      // here, so there is exactly one place that knows how ids increment.
      const result =
        tool === 'container-box'
          ? placeContainerBox(w, activeBoardId, x, y, oldIds, DEFAULT_INTERIOR_SIZE)
          : placeNormalBox(w, activeBoardId, x, y, oldIds)
      if (!result) return w
      idsRef.current = result.ids
      return result.world
    })
  }

  const cellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.floor((e.clientX - rect.left) / CELL_SIZE),
      y: Math.floor((e.clientY - rect.top) / CELL_SIZE),
    }
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = cellFromEvent(e)
    if (x < 0 || y < 0 || x >= activeBoard.size || y >= activeBoard.size) return
    const pending = pendingPlaceRef.current
    if (pending) {
      window.clearTimeout(pending.timer)
      if (pending.x !== x || pending.y !== y) placeAt(pending.x, pending.y)
    }
    pendingPlaceRef.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        pendingPlaceRef.current = null
        placeAt(x, y)
      }, DOUBLE_CLICK_WINDOW_MS),
    }
  }

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (pendingPlaceRef.current) {
      window.clearTimeout(pendingPlaceRef.current.timer)
      pendingPlaceRef.current = null
    }
    const { x, y } = cellFromEvent(e)
    const pieceId = occupantAt(world, { board: activeBoardId, x, y })
    const piece = pieceId ? world.pieces[pieceId] : undefined
    if (piece?.kind === 'container' && piece.boardRef !== undefined) {
      setPath((p) => [...p, piece.id])
    }
  }

  const breadcrumb = ['外层', ...path]

  const handleSave = () => {
    if (!levelName) return
    try {
      const serialized = serializeLevel(world)
      parseLevel(serialized) // defensive: catch an invalid world before it's persisted
      saveCustomLevel(levelName, JSON.stringify(serialized))
      setSaveError(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(serializeLevel(world))], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${levelName || 'level'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="editor-screen">
      <button onClick={onBack}>返回</button>
      <div className="breadcrumb">
        {breadcrumb.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              if (pendingPlaceRef.current) {
                window.clearTimeout(pendingPlaceRef.current.timer)
                pendingPlaceRef.current = null
              }
              setPath(path.slice(0, i))
            }}
          >
            {breadcrumb.slice(0, i + 1).join(' > ')}
          </button>
        ))}
      </div>
      <div className="tool-palette">
        {TOOLS.map(({ tool: t, label }) => (
          <button key={t} aria-label={label} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {label}
          </button>
        ))}
      </div>
      <canvas
        data-testid="editor-canvas"
        ref={canvasRef}
        width={CELL_SIZE * activeBoard.size}
        height={CELL_SIZE * activeBoard.size}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
      />
      <label>
        关卡名称
        <input aria-label="关卡名称" value={levelName} onChange={(e) => setLevelName(e.target.value)} />
      </label>
      <button onClick={handleSave}>储存</button>
      {saveError && <p role="alert">{saveError}</p>}
      <button onClick={handleExport}>汇出 JSON</button>
      <div style={{ display: 'none' }}>
        {activeBoard.cells.map((row, y) =>
          row.map((cell, x) => (
            <span key={`type-${x}-${y}`} data-testid={`cell-type-${x}-${y}`}>
              {cell.type}
            </span>
          )),
        )}
        {activeBoard.cells.map((row, y) =>
          row.map((cell, x) => (
            <span key={`req-${x}-${y}`} data-testid={`cell-requirement-${x}-${y}`}>
              {cell.requirement ?? 'none'}
            </span>
          )),
        )}
        {Object.entries(world.locations)
          .filter(([, loc]) => loc.board === activeBoardId)
          .map(([pieceId, loc]) => (
            <span key={`piece-${pieceId}`} data-testid={`box-at-${loc.x}-${loc.y}`}>
              {world.pieces[pieceId].kind}
            </span>
          ))}
        {Object.entries(world.locations)
          .filter(([, loc]) => loc.board === activeBoardId)
          .map(([pieceId, loc]) => (
            <span key={`piece-id-${pieceId}`} data-testid={`box-id-at-${loc.x}-${loc.y}`}>
              {pieceId}
            </span>
          ))}
        <span data-testid="board-ids">{Object.keys(world.boards).sort().join(',')}</span>
        <span data-testid="piece-ids">{Object.keys(world.pieces).sort().join(',')}</span>
      </div>
    </div>
  )
}
