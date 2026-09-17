import { Board, PieceKind, World } from '../engine/types'

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
// A self-loop box isn't a distinct PieceKind (it's an ordinary 'container'
// whose boardRef happens to equal the board it's standing on) — see
// worldEdit.ts's placeSelfLoopBox and rules.ts's cycle detection. It still
// needs a visibly different color from a normal container: it's a genuine
// trap (push it flush against an edge and anything exiting through that
// edge, including the player, falls into unresolvable infinite regress and
// is removed from the world), and rendering it identically to a harmless
// container would make that invisible until it kills you.
const SELF_LOOP_COLOR = '#a855f7'

function isSelfLoopBox(pieceId: string, world: World): boolean {
  const piece = world.pieces[pieceId]
  return (
    piece.kind === 'container' &&
    piece.boardRef !== undefined &&
    world.locations[pieceId]?.board === piece.boardRef
  )
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
    ctx.fillStyle = isSelfLoopBox(pieceId, world) ? SELF_LOOP_COLOR : PIECE_COLORS[piece.kind]
    ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
  }
}
