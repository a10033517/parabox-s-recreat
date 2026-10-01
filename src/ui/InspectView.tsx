import { useEffect, useRef, useState } from 'react'
import { BoardId, PieceId, World, findContainerFor } from '../game/engine/types'
import { DEFAULT_RENDER_BUDGET, DrawContext, PIECE_COLORS, drawBoardRecursive, indexPiecesByBoard, isCloneInstance, resolveRecursionTarget } from '../game/render/CanvasRenderer'
import { CameraTransform } from '../game/render/camera'
import { hitTestChain } from '../game/render/hitTest'
import { BoardTransform } from '../game/render/recursiveTransform'

const KIND_NAME = { player: '玩家', normal: '实心箱', container: '箱子' } as const

// What a box is, in words: the properties that change how it behaves.
function traits(world: World, pieceId: PieceId): string[] {
  const p = world.pieces[pieceId]
  const out: string[] = []
  const target = resolveRecursionTarget(world, p)
  if (target !== null && world.locations[pieceId]?.board === target.boardId) out.push('自包箱(房间就是它所在的地方)')
  if (isCloneInstance(world, p)) out.push('分身(和别的箱子通往同一个房间)')
  if (target !== null && findContainerFor(world, target.boardId) === pieceId && Object.values(world.pieces).filter((q) => q.boardRef === target.boardId).length > 1) out.push('本体(离开房间时从这个箱子出去)')
  if (p.fliph) out.push('翻转(内部左右相反,穿过会被翻转)')
  if (p.infExit) out.push(`${'∞'.repeat((p.infExitNum ?? 0) + 1)} 箱(只能出不能进)`)
  if (p.infEnter) out.push(`ε 入口(第 ${p.infEnterNum ?? 0} 层)`)
  if (p.possessable) out.push('可附身')
  if (p.kind === 'player') out.push('玩家本身')
  return out
}

function contents(world: World, boardId: BoardId): string[] {
  const board = world.boards[boardId]
  let walls = 0
  let boxGoals = 0
  let playerGoals = 0
  for (const row of board.cells) {
    for (const c of row) {
      if (c.type === 'wall') walls++
      if (c.requirement === 'box') boxGoals++
      if (c.requirement === 'player') playerGoals++
    }
  }
  const here = Object.values(world.pieces).filter((p) => world.locations[p.id]?.board === boardId)
  const out = [`${board.size}×${board.size} 的房间`]
  const count = (n: number, what: string) => { if (n > 0) out.push(`${n} 个${what}`) }
  count(here.filter((p) => p.kind === 'container').length, '有内部的箱子')
  count(here.filter((p) => p.kind === 'normal' && !p.wall).length, '实心箱')
  count(here.filter((p) => p.wall).length, '墙方块')
  if (here.some((p) => p.kind === 'player')) out.push('玩家在这里')
  count(boxGoals, '箱子目标')
  count(playerGoals, '玩家目标')
  count(walls, '墙')
  return out
}

// Where drawing starts so the box's room sits at the identity transform with the room the box
// stands in drawn around it — the same view as walking into the box (resolveDrawRoot), but
// through this exact box (a clone shows its own surroundings, not the original's).
function ringAround(world: World, pieceId: PieceId, roomSize: number): BoardTransform {
  const loc = world.locations[pieceId]
  if (loc === undefined || world.boards[loc.board] === undefined) return { boardId: '' as BoardId, originX: 0, originY: 0, scale: 1 }
  return { boardId: loc.board, originX: -loc.x * roomSize, originY: -loc.y * roomSize, scale: roomSize }
}

// Look inside a box: its room drawn as the whole view, read-only; tap a box inside to go deeper.
export function InspectView({ world, pieceId, onClose }: { world: World; pieceId: PieceId; onClose: () => void }) {
  const [path, setPath] = useState<PieceId[]>([pieceId])
  const current = path[path.length - 1]
  const target = resolveRecursionTarget(world, world.pieces[current])
  const boardId = target?.boardId
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<{ camera: CameraTransform; viewport: { width: number; height: number }; root: BoardTransform } | null>(null)
  const [side, setSide] = useState(320)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setSide(Math.max(160, Math.min(el.clientWidth, el.clientHeight)))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || boardId === undefined) return
    const board = world.boards[boardId]
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(side * dpr)
    canvas.height = Math.round(side * dpr)
    // Framed like the game frames the box the player is in: the box plus a margin of the room
    // around it. A box standing nowhere (no location) is drawn alone.
    const placed = world.locations[current] !== undefined && world.boards[world.locations[current]!.board] !== undefined
    const margin = placed ? DEFAULT_RENDER_BUDGET.marginCells * board.size : 0.2
    const camera: CameraTransform = { anchor: 'root', centerX: board.size / 2, centerY: board.size / 2, pixelsPerRootUnit: side / (board.size + 2 * margin) }
    const viewport = { width: side, height: side }
    const root: BoardTransform = placed ? ringAround(world, current, board.size) : { boardId, originX: 0, originY: 0, scale: 1 }
    viewRef.current = { camera, viewport, root }
    const piece = world.pieces[current]
    const host = piece.color ?? board.color ?? (piece.kind === 'player' ? PIECE_COLORS.player : PIECE_COLORS.container)
    try {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0b0b0b'
      ctx.fillRect(0, 0, side, side)
      const dc: DrawContext = { ctx, world, camera, viewport, budget: DEFAULT_RENDER_BUDGET, piecesByBoard: indexPiecesByBoard(world), cellsDrawnSoFar: { count: 0 } }
      if (placed) drawBoardRecursive(dc, world.boards[root.boardId], root, 0, 0, false)
      else drawBoardRecursive(dc, board, root, 0, 0, target?.mirrorH ?? false, host)
    } catch {
      // a canvas without the full 2D API (tests) just stays blank
    }
  }, [world, boardId, current, side, target?.mirrorH])

  const tap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const view = viewRef.current
    if (view === null || boardId === undefined) return
    const rect = e.currentTarget.getBoundingClientRect()
    // Only boxes inside the one being looked at; the room around it is just context.
    const chain = hitTestChain({ world, ...view }, e.clientX - rect.left, e.clientY - rect.top)
    const start = view.root.scale === 1 ? 0 : chain.findIndex((h) => h.pieceId === current) + 1
    if (start === 0 && view.root.scale !== 1) return
    for (let i = chain.length - 1; i >= start; i--) {
      const id = chain[i].pieceId
      if (resolveRecursionTarget(world, world.pieces[id]) !== null) {
        setPath((p) => [...p, id])
        return
      }
    }
  }

  const name = (id: PieceId, i: number) => (i === 0 ? '这个箱子' : `内层 ${i}`) + (world.pieces[id].kind === 'player' ? '(玩家)' : '')

  return (
    <div className="inspect" role="dialog" aria-label="查看箱子内部">
      <header className="topbar">
        <button className="icon-btn" onClick={() => (path.length > 1 ? setPath((p) => p.slice(0, -1)) : onClose())}>
          <span aria-hidden="true">‹</span>
          <span className="sr-only">返回</span>
        </button>
        <div className="topbar-title">
          <div className="topbar-name">查看箱子内部</div>
          <div className="topbar-sub">游戏暂停中,只能看不能动</div>
        </div>
        <button className="icon-btn" onClick={onClose}>
          <span aria-hidden="true">✕</span>
          <span className="sr-only">关闭</span>
        </button>
      </header>
      <nav className="inspect-crumbs">
        {path.map((id, i) => (
          <button key={`${id}-${i}`} className={i === path.length - 1 ? 'is-current' : ''} onClick={() => setPath(path.slice(0, i + 1))}>{name(id, i)}</button>
        ))}
      </nav>
      <div ref={wrapRef} className="inspect-stage">
        <canvas ref={canvasRef} className="inspect-canvas" style={{ width: side, height: side }} onClick={tap} />
      </div>
      <div className="inspect-info">
        <div className="inspect-kind">{KIND_NAME[world.pieces[current].kind]}</div>
        <div className="inspect-tags">
          {traits(world, current).map((t) => <span key={t} className="inspect-tag">{t}</span>)}
        </div>
        {boardId !== undefined && <div className="inspect-contents">{contents(world, boardId).join(' · ')}</div>}
        <div className="inspect-hint">点里面有内部的箱子可以继续往内看</div>
      </div>
    </div>
  )
}
