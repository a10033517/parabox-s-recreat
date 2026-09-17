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
  boardRef?: BoardId    // present only when kind === 'container'
  infiniteFor?: PieceId // present only on an infinite destination — see sendToVoid
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

// A plain 5x5 floor board, same as any other board — its boundary is just the
// array edge (nothing can be pushed further out, exactly like every other
// board in this engine), not an explicit ring of wall cells. That keeps all
// 25 cells usable instead of only an interior subset.
function makeVoidBoard(): Board {
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'floor' as CellType })),
  )
  return { id: VOID_BOARD_ID, size, cells }
}

// Fixed search order for a free cell in the Void: center first (the natural
// first landing spot), then the ring of 8 cells one step out, then the outer
// ring of 16 cells forming the board's own perimeter — covering all 25
// cells. Deterministic so tests can predict exactly where any given piece
// lands without needing to special-case which arrival number it is.
const VOID_CELL_ORDER: Array<{ x: number; y: number }> = [
  { x: 2, y: 2 },
  { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
  { x: 1, y: 2 },                 { x: 3, y: 2 },
  { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
  { x: 0, y: 1 },                                                 { x: 4, y: 1 },
  { x: 0, y: 2 },                                                 { x: 4, y: 2 },
  { x: 0, y: 3 },                                                 { x: 4, y: 3 },
  { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
]

// A piece "is locked" exactly when it's physically standing in the Void —
// this is a derived fact, not a separately-tracked flag, so it can never
// drift out of sync: anything that ends up on VOID_BOARD_ID through ANY path
// (sendToVoid below, or e.g. walking out of a container that itself got
// voided) is locked, with no risk of a missed flag assignment. resolveBlocked
// reads this to keep a locked piece pushable but never enterable/mergeable
// again; CanvasRenderer reads it to draw the locked ring.
export function isInVoid(world: World, pieceId: PieceId): boolean {
  return world.locations[pieceId]?.board === VOID_BOARD_ID
}

function infiniteDestinationIdFor(ownerId: PieceId): PieceId {
  return `void-infinite:${ownerId}`
}

// A valid destination for ownerId is either the real ownerId piece itself, if
// it's already sitting in the Void (once the real piece is there, later
// arrivals through the same cycle use it directly, no separate placeholder),
// or any piece — synthesized by sendToVoid below, or hand-authored in a level
// — whose infiniteFor names ownerId.
function findInfiniteDestination(world: World, ownerId: PieceId): PieceId | undefined {
  if (isInVoid(world, ownerId)) return ownerId
  for (const [pieceId, piece] of Object.entries(world.pieces)) {
    if (piece.infiniteFor === ownerId && world.locations[pieceId] !== undefined) return pieceId
  }
  return undefined
}

const VOID_EXIT_OFFSETS: Array<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
]

// A genuinely adjacent free cell to a destination, bounds-checked against the
// Void's own 5x5 extent — unlike reusing the board-wide placement search
// (VOID_CELL_ORDER), whose later entries are not necessarily adjacent to its
// earlier ones.
function findVoidExitCell(world: World, destination: { x: number; y: number }): { x: number; y: number } | undefined {
  for (const { dx, dy } of VOID_EXIT_OFFSETS) {
    const x = destination.x + dx
    const y = destination.y + dy
    if (x < 0 || y < 0 || x >= 5 || y >= 5) continue
    if (occupantAt(world, { board: VOID_BOARD_ID, x, y }) === undefined) return { x, y }
  }
  return undefined
}

// A piece that resolves to infinite recursion is relocated into the shared Void
// board, adjacent to the "infinite destination" representing whichever
// container owns the board the cycle actually broke on (ownerId — see
// computeTarget in rules.ts). If a valid destination for ownerId already
// exists (see findInfiniteDestination), it's reused; otherwise one is
// synthesized at the board-wide placement search's next free cell. Rejects
// (returns null, no mutation) an unknown pieceId, a piece already in the Void,
// a full Void (no cell for a new destination), or a destination with no free
// adjacent cell to exit into.
export function sendToVoid(world: World, pieceId: PieceId, ownerId: PieceId): World | null {
  if (world.pieces[pieceId] === undefined || isInVoid(world, pieceId)) return null

  const next = cloneWorld(world)
  if (next.boards[VOID_BOARD_ID] === undefined) {
    next.boards[VOID_BOARD_ID] = makeVoidBoard()
  }

  const existingDestinationId = findInfiniteDestination(next, ownerId)
  let destinationLoc: Location
  if (existingDestinationId !== undefined) {
    destinationLoc = next.locations[existingDestinationId]
  } else {
    const destinationCell = VOID_CELL_ORDER.find(
      ({ x, y }) => occupantAt(next, { board: VOID_BOARD_ID, x, y }) === undefined,
    )
    if (destinationCell === undefined) return null
    const destinationId = infiniteDestinationIdFor(ownerId)
    next.pieces[destinationId] = { id: destinationId, kind: 'normal', infiniteFor: ownerId }
    next.locations[destinationId] = { board: VOID_BOARD_ID, x: destinationCell.x, y: destinationCell.y }
    destinationLoc = next.locations[destinationId]
  }

  const exitCell = findVoidExitCell(next, destinationLoc)
  if (exitCell === undefined) return null

  next.locations[pieceId] = { board: VOID_BOARD_ID, x: exitCell.x, y: exitCell.y }
  return next
}
