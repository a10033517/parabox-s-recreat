import { BoardId, PieceId, World, occupantAt } from '../engine/types'
import { CameraTransform, Viewport } from './camera'
import { resolveRecursionTarget } from './CanvasRenderer'
import { BoardTransform } from './recursiveTransform'

export interface HitView {
  world: World
  camera: CameraTransform
  viewport: Viewport
  root: BoardTransform // the board drawn at depth 0 and where (same as drawBoardRecursive's)
}

export interface Hit {
  pieceId: PieceId
  boardId: BoardId // the board the piece stands on
  cellPixels: number // how big the piece is drawn on screen
}

// Every piece under the screen point (sx, sy) — viewport pixels — from the outermost to the
// innermost, following exactly the nesting (and mirroring) drawBoardRecursive draws. A piece
// drawn smaller than minCellPixels is too small to point at and ends the search.
export function hitTestChain(view: HitView, sx: number, sy: number, minCellPixels = 18): Hit[] {
  const { world, camera, viewport } = view
  const ppu = camera.pixelsPerRootUnit
  const wx = (sx - viewport.width / 2) / ppu + camera.centerX
  const wy = (sy - viewport.height / 2) / ppu + camera.centerY
  const chain: Hit[] = []
  let boardId: BoardId = view.root.boardId
  let t: BoardTransform = view.root
  let mirrorH = false
  for (let depth = 0; depth < 16; depth++) {
    const board = world.boards[boardId]
    if (board === undefined) break
    const cellPixels = t.scale * ppu
    if (cellPixels < minCellPixels) break
    const col = Math.floor((wx - t.originX) / t.scale)
    const row = Math.floor((wy - t.originY) / t.scale)
    if (col < 0 || row < 0 || col >= board.size || row >= board.size) break
    const x = mirrorH ? board.size - 1 - col : col
    const pieceId = occupantAt(world, { board: boardId, x, y: row })
    if (pieceId === undefined) break
    chain.push({ pieceId, boardId, cellPixels })
    const target = resolveRecursionTarget(world, world.pieces[pieceId])
    const inner = target !== null ? world.boards[target.boardId] : undefined
    if (target === null || inner === undefined) break
    t = { boardId: inner.id, originX: t.originX + col * t.scale, originY: t.originY + row * t.scale, scale: t.scale / inner.size }
    boardId = inner.id
    mirrorH = mirrorH !== target.mirrorH
  }
  return chain
}

// The box with a room inside that a tap at (sx, sy) means: the innermost one under the finger
// that is still big enough to point at (tapping a small box inside a box picks the outer box).
export function containerAt(view: HitView, sx: number, sy: number): PieceId | null {
  const chain = hitTestChain(view, sx, sy)
  for (let i = chain.length - 1; i >= 0; i--) {
    if (resolveRecursionTarget(view.world, view.world.pieces[chain[i].pieceId]) !== null) return chain[i].pieceId
  }
  return null
}
