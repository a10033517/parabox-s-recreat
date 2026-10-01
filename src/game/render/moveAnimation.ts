import { BoardId, PieceId, VOID_BOARD_ID, World } from '../engine/types'
import { boardTransformInAnchor } from './recursiveTransform'
import { CellPlacement } from './CanvasRenderer'

// Presentation-only helpers that let every moved piece glide instead of jumping, including a
// piece that changes boards (entering / leaving a box, being eaten) and a piece that flips.

export interface PlacedCell extends CellPlacement {
  mirrorH: boolean // whether the board the piece stands on is drawn mirrored
}

// Where a piece is drawn, in the anchor board's units — the same place drawBoardRecursive puts
// it when drawing from the anchor: climb to the anchor through canonical owners, then walk back
// down, mirroring x inside every fliph owner. Null when the piece's board is not reachable
// from the anchor (e.g. the Void seen from the root anchor).
export function pieceCellInAnchor(world: World, pieceId: PieceId, anchorBoardId: BoardId): PlacedCell | null {
  const loc = world.locations[pieceId]
  if (loc === undefined) return null
  const t = boardTransformInAnchor(world, loc.board, anchorBoardId)
  if (t === null) return null
  const mirror = t.mirrorH === true
  const x = mirror ? world.boards[loc.board].size - 1 - loc.x : loc.x
  return { originX: t.originX + x * t.scale, originY: t.originY + loc.y * t.scale, scale: t.scale, mirrorH: mirror }
}

export interface CrossBoardMove {
  pieceId: PieceId
  from: PlacedCell
  to: PlacedCell
}

// Pieces that changed boards this move, with where they were and where they are now (both in
// the same anchor space). A piece going into or out of the Void is left to the Void transition.
export function crossBoardMoves(pre: World, post: World, anchorBoardId: BoardId): CrossBoardMove[] {
  const moves: CrossBoardMove[] = []
  for (const pieceId of Object.keys(post.locations)) {
    const a = pre.locations[pieceId]
    const b = post.locations[pieceId]
    if (a === undefined || a.board === b.board) continue
    if (a.board === VOID_BOARD_ID || b.board === VOID_BOARD_ID) continue
    const from = pieceCellInAnchor(pre, pieceId, anchorBoardId)
    const to = pieceCellInAnchor(post, pieceId, anchorBoardId)
    if (from !== null && to !== null) moves.push({ pieceId, from, to })
  }
  return moves
}

// Glides the centre in a straight line and the size geometrically (so a 9x shrink reads as a
// steady zoom rather than a sudden collapse at the end).
export function interpolateCell(from: CellPlacement, to: CellPlacement, t: number): CellPlacement {
  const scale = from.scale * Math.pow(to.scale / from.scale, t)
  const cx = from.originX + from.scale / 2 + (to.originX + to.scale / 2 - (from.originX + from.scale / 2)) * t
  const cy = from.originY + from.scale / 2 + (to.originY + to.scale / 2 - (from.originY + from.scale / 2)) * t
  return { originX: cx - scale / 2, originY: cy - scale / 2, scale }
}

// Pieces whose fliph changed this move turn over: horizontal scale -1 -> 0 -> 1. The world
// drawn is already the post-move one, so -1 at t = 0 shows the old (unflipped) orientation.
export function flippedPieces(pre: World, post: World): Set<PieceId> {
  const flipped = new Set<PieceId>()
  for (const [pieceId, piece] of Object.entries(post.pieces)) {
    const before = pre.pieces[pieceId]
    if (before !== undefined && (before.fliph === true) !== (piece.fliph === true)) flipped.add(pieceId)
  }
  return flipped
}

export function flipScaleAt(t: number): number {
  return -Math.cos(Math.PI * Math.max(0, Math.min(1, t)))
}
