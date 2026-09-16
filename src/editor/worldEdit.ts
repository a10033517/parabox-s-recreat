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
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
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
  next.boards[boardId].cells[y][x].type = type
  const occupantId = occupantAt(next, { board: boardId, x, y })
  if (occupantId && occupantId !== PLAYER_ID) return deletePieceRecursively(next, occupantId)
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

function placePiece(world: World, boardId: BoardId, x: number, y: number, piece: Piece): World | null {
  const occupantId = occupantAt(world, { board: boardId, x, y })
  if (occupantId === PLAYER_ID) return null
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

export function movePlayer(world: World, boardId: BoardId, x: number, y: number): World {
  const occupantId = occupantAt(world, { board: boardId, x, y })
  const next = occupantId && occupantId !== PLAYER_ID ? deletePieceRecursively(world, occupantId) : cloneWorld(world)
  next.locations[PLAYER_ID] = { board: boardId, x, y }
  return next
}
