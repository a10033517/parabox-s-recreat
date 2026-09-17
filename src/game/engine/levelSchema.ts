import { World, Board, Piece, Location, PLAYER_ID, inBounds } from './types'

const VALID_PIECE_KINDS = new Set(['player', 'normal', 'container'])
const VALID_CELL_TYPES = new Set(['floor', 'wall'])
const VALID_REQUIREMENTS = new Set(['box', 'player'])

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
    for (const row of board.cells) {
      for (const cell of row) {
        if (!VALID_CELL_TYPES.has(cell.type)) {
          throw new Error(`Board "${boardId}" has a cell with an invalid type "${cell.type}"`)
        }
        if (cell.requirement !== undefined) {
          if (!VALID_REQUIREMENTS.has(cell.requirement)) {
            throw new Error(`Board "${boardId}" has a cell with an invalid requirement "${cell.requirement}"`)
          }
          if (cell.type === 'wall') {
            throw new Error(`Board "${boardId}" has a requirement on a wall cell, which can never be satisfied`)
          }
        }
      }
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
    if (!VALID_PIECE_KINDS.has(piece.kind)) {
      throw new Error(`Piece "${pieceId}" has an invalid kind "${piece.kind}"`)
    }
    if (piece.kind === 'container') {
      if (piece.boardRef === undefined || boards[piece.boardRef] === undefined) {
        throw new Error(`Container piece "${pieceId}" has a boardRef that does not exist`)
      }
    } else if (piece.boardRef !== undefined) {
      throw new Error(`Piece "${pieceId}" has kind "${piece.kind}" but also has a boardRef, which only container pieces may have`)
    }
  }

  // Board ownership: every board must be referenced by at most one
  // container, and at most one board may have zero owners. Root isn't
  // structurally special — it's whichever board has no owner (a normal
  // tree), or, when every board has exactly one owner (a cycle exists),
  // whichever board the player starts on (see startBoardId below).
  const ownerCount: Record<string, number> = Object.fromEntries(
    Object.keys(boards).map((boardId) => [boardId, 0]),
  )
  for (const piece of Object.values(pieces)) {
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
      ownerCount[piece.boardRef] = (ownerCount[piece.boardRef] ?? 0) + 1
    }
  }
  const orphanBoards = Object.entries(ownerCount).filter(([, count]) => count === 0)
  if (orphanBoards.length > 1) {
    throw new Error(
      `Level must have at most one board with no owner; found ${orphanBoards.length}`,
    )
  }
  const overOwnedBoards = Object.entries(ownerCount).filter(([, count]) => count > 1)
  if (overOwnedBoards.length > 0) {
    const [boardId] = overOwnedBoards[0]
    throw new Error(`Board "${boardId}" has more than one owner (container referencing it)`)
  }

  let startBoardId: string
  if (orphanBoards.length === 1) {
    startBoardId = orphanBoards[0][0]
  } else {
    // orphanBoards.length === 0: the level is one connected cycle (or a
    // cycle with tree branches). There is no ownerless board to anchor on,
    // so the player's own starting board is the only board that can serve
    // as the reachability seed. Validate it explicitly here, before using
    // it — don't let the later per-piece location checks be the only thing
    // standing between an invalid player location and a confusing
    // reachability error.
    const playerLocation = locations[PLAYER_ID]
    if (playerLocation === undefined) {
      throw new Error(
        'Cannot determine a starting board for reachability: no board is ownerless, and the player has no location',
      )
    }
    if (boards[playerLocation.board] === undefined) {
      throw new Error(
        `Cannot determine a starting board for reachability: the player's board "${playerLocation.board}" does not exist`,
      )
    }
    startBoardId = playerLocation.board
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

  // Reachability: every board must be reachable from startBoardId by
  // following container pieces down into their interiors, starting from
  // whatever board each container is physically located on. The ownership
  // counts checked above (at most one owner per board, at most one board
  // with zero) are necessary but not sufficient — a cycle disconnected
  // from startBoardId, or a tree mixed with an unconnected cycle
  // elsewhere, can satisfy those local counts while never actually
  // connecting back to where play starts. This same walk also correctly
  // traverses INTO a cycle that includes startBoardId itself: each step
  // just follows one more owned board, and a ring closes back onto a board
  // already in `reached`, which the `!reached.has(...)` guard below
  // already treats as a no-op rather than an infinite loop.
  const reached = new Set<string>([startBoardId])
  const queue: string[] = [startBoardId]
  while (queue.length > 0) {
    const currentBoardId = queue.shift() as string
    for (const piece of Object.values(pieces)) {
      if (
        piece.kind === 'container' &&
        piece.boardRef !== undefined &&
        locations[piece.id].board === currentBoardId &&
        !reached.has(piece.boardRef)
      ) {
        reached.add(piece.boardRef)
        queue.push(piece.boardRef)
      }
    }
  }
  const unreachable = Object.keys(boards).filter((boardId) => !reached.has(boardId))
  if (unreachable.length > 0) {
    throw new Error(
      `Board(s) not reachable from the starting board: ${unreachable.join(', ')} (cyclic or disconnected containment graph)`,
    )
  }

  return { boards, pieces, locations }
}
