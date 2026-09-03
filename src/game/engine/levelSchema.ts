import { World, Board, Piece, Location, PLAYER_ID, inBounds } from './types'

export function serializeLevel(world: World): unknown {
  return structuredClone(world)
}

export function parseLevel(data: unknown): World {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Level data must be an object')
  }
  const raw = data as { boards?: unknown; pieces?: unknown; locations?: unknown }

  if (typeof raw.boards !== 'object' || raw.boards === null) {
    throw new Error('Level data is missing a "boards" object')
  }
  if (typeof raw.pieces !== 'object' || raw.pieces === null) {
    throw new Error('Level data is missing a "pieces" object')
  }
  if (typeof raw.locations !== 'object' || raw.locations === null) {
    throw new Error('Level data is missing a "locations" object')
  }

  const boards = raw.boards as Record<string, Board>
  const pieces = raw.pieces as Record<string, Piece>
  const locations = raw.locations as Record<string, Location>

  for (const [boardId, board] of Object.entries(boards)) {
    if (board.id !== boardId) {
      throw new Error(`Board "${boardId}" has a mismatched id "${board.id}"`)
    }
    if (board.cells.length !== board.size || board.cells.some((row) => row.length !== board.size)) {
      throw new Error(`Board "${boardId}" must be square: cells do not match its declared size`)
    }
  }

  const playerIds = Object.values(pieces).filter((p) => p.kind === 'player')
  if (playerIds.length !== 1) {
    throw new Error(`Level must have exactly one player piece, found ${playerIds.length}`)
  }
  if (pieces[PLAYER_ID] === undefined || pieces[PLAYER_ID].kind !== 'player') {
    throw new Error(`The player piece must be keyed by id "${PLAYER_ID}"`)
  }

  for (const [pieceId, piece] of Object.entries(pieces)) {
    if (piece.id !== pieceId) {
      throw new Error(`Piece "${pieceId}" has a mismatched id "${piece.id}"`)
    }
    if (piece.kind === 'container') {
      if (piece.boardRef === undefined || boards[piece.boardRef] === undefined) {
        throw new Error(`Container piece "${pieceId}" has a boardRef that does not exist`)
      }
    }
  }

  // Board ownership: every board must be referenced by exactly one
  // container, except a single root board referenced by none.
  const ownerCount: Record<string, number> = Object.fromEntries(
    Object.keys(boards).map((boardId) => [boardId, 0]),
  )
  for (const piece of Object.values(pieces)) {
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
      ownerCount[piece.boardRef] = (ownerCount[piece.boardRef] ?? 0) + 1
    }
  }
  const orphanBoards = Object.entries(ownerCount).filter(([, count]) => count === 0)
  if (orphanBoards.length !== 1) {
    throw new Error(
      `Level must have exactly one board with no owner (the root); found ${orphanBoards.length}`,
    )
  }
  const overOwnedBoards = Object.entries(ownerCount).filter(([, count]) => count > 1)
  if (overOwnedBoards.length > 0) {
    const [boardId] = overOwnedBoards[0]
    throw new Error(`Board "${boardId}" has more than one owner (container referencing it)`)
  }

  for (const [pieceId] of Object.entries(pieces)) {
    if (locations[pieceId] === undefined) {
      throw new Error(`Piece "${pieceId}" has no matching location`)
    }
  }
  const seenCells = new Set<string>()
  for (const [pieceId, loc] of Object.entries(locations)) {
    if (pieces[pieceId] === undefined) {
      throw new Error(`Location "${pieceId}" has no matching piece`)
    }
    const board = boards[loc.board]
    if (board === undefined) {
      throw new Error(`Location for "${pieceId}" references board "${loc.board}", which does not exist`)
    }
    if (!inBounds(board, loc.x, loc.y)) {
      throw new Error(`Location for "${pieceId}" is out of bounds for board "${loc.board}"`)
    }
    const cellKey = `${loc.board}:${loc.x}:${loc.y}`
    if (seenCells.has(cellKey)) {
      throw new Error(`More than one piece would occupy (${loc.board}, ${loc.x}, ${loc.y})`)
    }
    seenCells.add(cellKey)
  }

  return { boards, pieces, locations }
}
