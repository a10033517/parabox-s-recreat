import {
  Board,
  BoardId,
  Cell,
  CellType,
  Piece,
  PieceId,
  PLAYER_ID,
  Requirement,
  World,
  cloneWorld,
  occupantAt,
} from '../game/engine/types'

export function createEmptyBoard(id: BoardId, size: number): Board {
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'floor' as CellType })),
  )
  return { id, size, cells }
}

export function createEmptyWorld(rootSize: number): World {
  const root = createEmptyBoard('root', rootSize)
  return {
    boards: { root },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } },
    locations: { [PLAYER_ID]: { board: 'root', x: rootSize - 1, y: rootSize - 1 } },
  }
}

// Checks if a piece's subtree (including the piece itself and all pieces
// on its owned board, recursively) contains the player piece.
//
// Guarded with a `seen` set even though nothing in this codebase can
// currently create a cyclic containment graph: a future "loop box" feature
// (self-referencing containers) is already planned, and without this guard
// a cycle would make this traversal loop forever.
function subtreeContainsPlayer(world: World, pieceId: PieceId): boolean {
  const stack: PieceId[] = [pieceId]
  const seen = new Set<PieceId>()
  while (stack.length > 0) {
    const id = stack.pop() as PieceId
    if (seen.has(id)) continue
    seen.add(id)
    if (id === PLAYER_ID) return true
    const piece = world.pieces[id]
    // A self-referencing (self-loop) container's own board is not solely
    // "owned" by it — deleting it never touches that board (see
    // deletePieceRecursively's matching guard), so descending into it here
    // would be a stale false positive: it could find the player standing on
    // that same board even though deleting this piece can't remove the
    // player at all.
    const isSelfReferencing = world.locations[id]?.board === piece?.boardRef
    if (piece?.kind === 'container' && piece.boardRef !== undefined && !isSelfReferencing) {
      for (const [otherId, loc] of Object.entries(world.locations)) {
        if (loc.board === piece.boardRef && !seen.has(otherId)) stack.push(otherId)
      }
    }
  }
  return false
}

// Deletes a piece and, if it's a container, recursively deletes its owned
// board and every piece located on that board (and so on down). Without
// this, deleting a container that owns non-empty interiors would leave
// orphaned boards that fail levelSchema.ts's reachability/ownership checks.
export function deletePieceRecursively(world: World, pieceId: PieceId): World {
  const next = cloneWorld(world)
  const stack: PieceId[] = [pieceId]
  while (stack.length > 0) {
    const id = stack.pop() as PieceId
    const piece = next.pieces[id]
    if (!piece) continue
    // A self-referencing (self-loop) container's own board is not solely
    // "owned" by it — that board is the very one it's standing on, which
    // may still be legitimately owned by a separate external container (or,
    // on root, own itself). Deleting a self-loop piece must only delete
    // that one piece, never cascade into the board it also sits inside.
    const isSelfReferencing = next.locations[id]?.board === piece.boardRef
    if (piece.kind === 'container' && piece.boardRef !== undefined && !isSelfReferencing) {
      const boardId = piece.boardRef
      for (const [otherId, loc] of Object.entries(next.locations)) {
        if (loc.board === boardId) stack.push(otherId)
      }
      delete next.boards[boardId]
    }
    delete next.pieces[id]
    delete next.locations[id]
  }
  return next
}

export function setCellType(world: World, boardId: BoardId, x: number, y: number, type: CellType): World {
  const next = cloneWorld(world)
  const cell = next.boards[boardId].cells[y][x]
  cell.type = type
  // A wall cell can never satisfy a requirement (levelSchema.ts's parseLevel
  // rejects a world where one does), so painting a wall over a goal cell must
  // clear any requirement that was there.
  if (type === 'wall') cell.requirement = undefined
  const occupantId = occupantAt(next, { board: boardId, x, y })
  if (occupantId && !subtreeContainsPlayer(next, occupantId)) return deletePieceRecursively(next, occupantId)
  return next
}

export function setRequirement(
  world: World,
  boardId: BoardId,
  x: number,
  y: number,
  requirement: Requirement,
): World {
  const next = cloneWorld(world)
  const cell = next.boards[boardId].cells[y][x]
  cell.requirement = cell.requirement === requirement ? undefined : requirement
  return next
}

export interface EditorIds {
  nextBoxId: number
  nextBoardId: number
}

// Predicts whether placeNormalBox/placeContainerBox would succeed at this
// cell, without actually placing anything. Lets callers (EditorScreen) decide
// whether to advance their id counter *before* calling setWorld, instead of
// either hand-duplicating this same occupant/subtree check or unconditionally
// burning an id on a placement that setWorld's updater will end up rejecting.
export function canPlacePieceAt(world: World, boardId: BoardId, x: number, y: number): boolean {
  const occupantId = occupantAt(world, { board: boardId, x, y })
  return !(occupantId && subtreeContainsPlayer(world, occupantId))
}

function placePiece(world: World, boardId: BoardId, x: number, y: number, piece: Piece): World | null {
  const occupantId = occupantAt(world, { board: boardId, x, y })
  if (occupantId && subtreeContainsPlayer(world, occupantId)) return null
  const next = occupantId ? deletePieceRecursively(world, occupantId) : cloneWorld(world)
  next.pieces[piece.id] = piece
  next.locations[piece.id] = { board: boardId, x, y }
  return next
}

export function placeNormalBox(
  world: World,
  boardId: BoardId,
  x: number,
  y: number,
  ids: EditorIds,
): { world: World; ids: EditorIds } | null {
  const id = `box-${ids.nextBoxId}`
  const placed = placePiece(world, boardId, x, y, { id, kind: 'normal' })
  if (!placed) return null
  return { world: placed, ids: { ...ids, nextBoxId: ids.nextBoxId + 1 } }
}

export function placeContainerBox(
  world: World,
  boardId: BoardId,
  x: number,
  y: number,
  ids: EditorIds,
  interiorSize: number,
): { world: World; ids: EditorIds } | null {
  const id = `box-${ids.nextBoxId}`
  const interiorId = `board-${ids.nextBoardId}`
  const placed = placePiece(world, boardId, x, y, { id, kind: 'container', boardRef: interiorId })
  if (!placed) return null
  placed.boards[interiorId] = createEmptyBoard(interiorId, interiorSize)
  return { world: placed, ids: { nextBoxId: ids.nextBoxId + 1, nextBoardId: ids.nextBoardId + 1 } }
}

export function placeSelfLoopBox(
  world: World,
  boardId: BoardId,
  x: number,
  y: number,
  ids: EditorIds,
): { world: World; ids: EditorIds } | null {
  const id = `box-${ids.nextBoxId}`
  const placed = placePiece(world, boardId, x, y, { id, kind: 'container', boardRef: boardId })
  if (!placed) return null
  return { world: placed, ids: { ...ids, nextBoxId: ids.nextBoxId + 1 } }
}

export function movePlayer(world: World, boardId: BoardId, x: number, y: number): World {
  const occupantId = occupantAt(world, { board: boardId, x, y })
  if (occupantId && subtreeContainsPlayer(world, occupantId)) return world
  const next = occupantId && occupantId !== PLAYER_ID ? deletePieceRecursively(world, occupantId) : cloneWorld(world)
  next.locations[PLAYER_ID] = { board: boardId, x, y }
  return next
}
