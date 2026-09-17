export type BoardId = string
export type PieceId = string
export type Direction = 'up' | 'down' | 'left' | 'right'

export type CellType = 'floor' | 'wall'
export type Requirement = 'box' | 'player'

export interface Cell {
  type: CellType
  requirement?: Requirement
}

export interface Board {
  id: BoardId
  size: number     // every board is size x size
  cells: Cell[][]  // cells[y][x], cells.length === size, cells[y].length === size
}

export type PieceKind = 'player' | 'normal' | 'container'

export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId // present only when kind === 'container'
}

export interface Location {
  board: BoardId
  x: number
  y: number
}

export interface World {
  boards: Record<BoardId, Board>
  pieces: Record<PieceId, Piece>
  locations: Record<PieceId, Location>
}

export const PLAYER_ID: PieceId = 'player'

export function inBounds(board: Board, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < board.size && y < board.size
}

export function opposite(dir: Direction): Direction {
  switch (dir) {
    case 'up': return 'down'
    case 'down': return 'up'
    case 'left': return 'right'
    case 'right': return 'left'
  }
}

export function step(x: number, y: number, dir: Direction): { x: number; y: number } {
  switch (dir) {
    case 'up': return { x, y: y - 1 }
    case 'down': return { x, y: y + 1 }
    case 'left': return { x: x - 1, y }
    case 'right': return { x: x + 1, y }
  }
}

export function occupantAt(world: World, location: Location): PieceId | undefined {
  for (const [pieceId, loc] of Object.entries(world.locations)) {
    if (loc.board === location.board && loc.x === location.x && loc.y === location.y) {
      return pieceId
    }
  }
  return undefined
}

// When a board is owned by both a self-referencing container (standing on
// the very board it owns) and a separate external container elsewhere, the
// external owner is the semantically meaningful one for climbing out of the
// board — the self-referencing piece's "ownership" is really just the
// self-loop trap, not a real parent to exit into. Prefer the external owner
// deterministically (not by object-key iteration order, which is not a
// semantic property of the level), falling back to the self-referencing
// piece only when it's the sole candidate — this preserves the root
// self-loop trap and every single-owner case unchanged.
export function findContainerFor(world: World, boardId: BoardId): PieceId | undefined {
  let selfRef: PieceId | undefined
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container' || piece.boardRef !== boardId) continue
    if (world.locations[piece.id]?.board === boardId) {
      selfRef ??= piece.id
    } else {
      return piece.id
    }
  }
  return selfRef
}

export function cloneWorld(world: World): World {
  return structuredClone(world)
}

export function moveTo(world: World, pieceId: PieceId, location: Location): World {
  const next = cloneWorld(world)
  next.locations[pieceId] = location
  return next
}

export function removePiece(world: World, pieceId: PieceId): World {
  const next = cloneWorld(world)
  delete next.pieces[pieceId]
  delete next.locations[pieceId]
  return next
}
