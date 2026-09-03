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
    ctx.fillStyle = PIECE_COLORS[piece.kind]
    ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
  }
}
