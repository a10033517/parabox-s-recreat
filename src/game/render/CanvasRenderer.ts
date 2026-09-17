import { Board, BoardId, PieceId, PieceKind, World, findContainerFor, VOID_BOARD_ID } from '../engine/types'

const FLOOR_COLOR = '#1e293b'
const WALL_COLOR = '#0f172a'
const REQUIREMENT_OVERLAY: Record<'box' | 'player', string> = {
  box: '#334155',
  player: '#4c1d95',
}
const PIECE_COLORS: Record<PieceKind, string> = {
  normal: '#f59e0b',
  container: '#38bdf8',
  player: '#f472b6',
}
// A container that's part of a containment cycle (a self-loop, or a longer
// ring of several containers each owning the next) isn't a distinct
// PieceKind — see worldEdit.ts's placeSelfLoopBox and rules.ts's cycle
// detection. It still needs a visibly different color from an ordinary
// container: pushing it (or anything else) flush against the edge that
// closes the ring resolves to infinite recursion (see sendToVoid in
// types.ts) and sends it to the Void, locked — rendering it identically to
// a harmless container would make that outcome invisible until it happens.
// This is a visual distinction AID, not a uniqueness guarantee: for a ring
// bigger than the palette, or on a hash collision, two members can share a
// color. Every level this codebase ships has at most two cycle members.
const CYCLE_PALETTE = ['#ef4444', '#eab308', '#a855f7', '#14b8a6', '#f97316']
const LOCKED_RING_COLOR = '#e2e8f0' // pale slate/white — reads as "frozen", stays visually distinct from every PIECE_COLORS and CYCLE_PALETTE entry (all of which are saturated hues), unlike the previous yellow-400 which was a near-miss against CYCLE_PALETTE's yellow-500
const INFINITY_MARKER_COLOR = '#0f172a' // dark, readable against LOCKED_RING_COLOR's pale fill

function isCycleMember(pieceId: PieceId, world: World): boolean {
  const piece = world.pieces[pieceId]
  if (piece.kind !== 'container' || piece.boardRef === undefined) return false
  const start = piece.boardRef
  let current: BoardId = start
  const seen = new Set<BoardId>()
  while (!seen.has(current)) {
    seen.add(current)
    const owner = findContainerFor(world, current)
    if (owner === undefined) return false
    const ownerLoc = world.locations[owner]
    if (ownerLoc === undefined) return false
    current = ownerLoc.board
  }
  return current === start
}

function cycleColorFor(pieceId: PieceId): string {
  let hash = 0
  for (const ch of pieceId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return CYCLE_PALETTE[hash % CYCLE_PALETTE.length]
}

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  world: World,
  cellSize: number,
): void {
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      const cell = board.cells[y][x]
      ctx.fillStyle = cell.type === 'wall' ? WALL_COLOR : FLOOR_COLOR
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)

      if (cell.requirement) {
        ctx.fillStyle = REQUIREMENT_OVERLAY[cell.requirement]
        const inset = cellSize / 4
        ctx.fillRect(x * cellSize + inset, y * cellSize + inset, cellSize - inset * 2, cellSize - inset * 2)
      }
    }
  }

  for (const [pieceId, location] of Object.entries(world.locations)) {
    if (location.board !== board.id) continue
    const piece = world.pieces[pieceId]
    // An infinite destination (piece.infiniteFor set) has no cycle membership
    // or kind of its own worth rendering — it's colored as whichever real
    // piece it represents.
    const colorSourceId = piece.infiniteFor ?? pieceId
    const colorSource = piece.infiniteFor !== undefined ? world.pieces[piece.infiniteFor] : piece
    ctx.fillStyle = isCycleMember(colorSourceId, world) ? cycleColorFor(colorSourceId) : PIECE_COLORS[colorSource.kind]
    ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
    // A piece "is locked" exactly when it's standing in the Void (see
    // isInVoid in types.ts) — every piece this loop reaches has already been
    // filtered to location.board === board.id, so board.id === VOID_BOARD_ID
    // here means this particular piece is in the Void too.
    if (board.id === VOID_BOARD_ID) {
      ctx.save()
      ctx.strokeStyle = LOCKED_RING_COLOR
      ctx.lineWidth = Math.max(2, cellSize / 8)
      const inset = ctx.lineWidth / 2
      ctx.strokeRect(
        location.x * cellSize + inset,
        location.y * cellSize + inset,
        cellSize - inset * 2,
        cellSize - inset * 2,
      )
      if (piece.infiniteFor !== undefined) {
        ctx.fillStyle = INFINITY_MARKER_COLOR
        ctx.font = `${Math.floor(cellSize / 2)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('∞', location.x * cellSize + cellSize / 2, location.y * cellSize + cellSize / 2)
      }
      ctx.restore()
    }
  }
}
