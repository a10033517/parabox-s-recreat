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
  locked?: boolean    // runtime-only; true only after sendToVoid — see below
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

export function findContainerFor(world: World, boardId: BoardId): PieceId | undefined {
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind === 'container' && piece.boardRef === boardId) return piece.id
  }
  return undefined
}

export function cloneWorld(world: World): World {
  return structuredClone(world)
}

export function moveTo(world: World, pieceId: PieceId, location: Location): World {
  const next = cloneWorld(world)
  next.locations[pieceId] = location
  return next
}

export const VOID_BOARD_ID: BoardId = 'void'

function makeVoidBoard(): Board {
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      type: (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 'wall' : 'floor') as CellType,
    })),
  )
  return { id: VOID_BOARD_ID, size, cells }
}

// Fixed search order for a free interior cell in the Void: center first (the
// natural first landing spot), then the remaining 8 interior cells in a fixed,
// deterministic order. Deterministic so tests can predict exactly where any
// given piece lands without needing to special-case "first vs. second piece."
const VOID_CELL_ORDER: Array<{ x: number; y: number }> = [
  { x: 2, y: 2 },
  { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
  { x: 1, y: 2 },                 { x: 3, y: 2 },
  { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
]

// A piece that resolves to infinite recursion is relocated into the shared Void
// board instead of being deleted from the world — this function replaces the
// now-deleted `removePiece`, and is called from `removePiece`'s one former call
// site in rules.ts. It's marked `locked`, which resolveBlocked reads to
// keep it pushable but never enterable/mergeable again. Rejects (returns null, no
// mutation) an unknown pieceId, an already-locked piece (a piece is only ever sent
// to the Void once), or a full Void — the caller always gets back either the
// original world untouched, or a new world with exactly one piece relocated and
// locked.
export function sendToVoid(world: World, pieceId: PieceId): World | null {
  const piece = world.pieces[pieceId]
  if (piece === undefined || piece.locked) return null

  const next = cloneWorld(world)
  if (next.boards[VOID_BOARD_ID] === undefined) {
    next.boards[VOID_BOARD_ID] = makeVoidBoard()
  }
  const cell = VOID_CELL_ORDER.find(
    ({ x, y }) => occupantAt(next, { board: VOID_BOARD_ID, x, y }) === undefined,
  )
  if (cell === undefined) return null

  next.locations[pieceId] = { board: VOID_BOARD_ID, x: cell.x, y: cell.y }
  next.pieces[pieceId] = { ...next.pieces[pieceId], locked: true }
  return next
}
