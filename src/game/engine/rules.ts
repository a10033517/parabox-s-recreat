import { Fraction, addInt, divideByInt, multiplyByInt, isZero, fractionDivMod, makeFraction, HALF } from './fraction'
import {
  World, Location, Direction, Board, Piece, PieceId,
  inBounds, step, findContainerFor, occupantAt, moveTo, opposite, PLAYER_ID,
} from './types'

export function computeTarget(
  world: World,
  loc: Location,
  dir: Direction,
  relativeCoord: Fraction,
): { location: Location; relativeCoord: Fraction } | null {
  const board = world.boards[loc.board]
  const { x, y } = step(loc.x, loc.y, dir)

  if (inBounds(board, x, y)) {
    return { location: { board: loc.board, x, y }, relativeCoord }
  }

  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null

  const offset = dir === 'up' || dir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)

  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, dir, newRelativeCoord)
}

export function getEntryCell(
  board: Board,
  dir: Direction,
  relativeCoord: Fraction,
): { cell: { x: number; y: number } | null; newRelativeCoord: Fraction } {
  const unit = makeFraction(1, board.size)
  const { offset, remainder } = fractionDivMod(relativeCoord, unit)
  const scaled = multiplyByInt(remainder, board.size)

  const cell = (() => {
    switch (dir) {
      case 'up':    return { x: offset, y: board.size - 1 }
      case 'down':  return { x: offset, y: 0 }
      case 'left':
        return isZero(remainder)
          ? { x: board.size - 1, y: offset - 1 }
          : { x: board.size - 1, y: offset }
      case 'right':
        return isZero(remainder)
          ? { x: 0, y: offset - 1 }
          : { x: 0, y: offset }
    }
  })()

  const newRelativeCoord = isZero(remainder) && (dir === 'left' || dir === 'right')
    ? makeFraction(1, 1)
    : scaled

  if (!inBounds(board, cell.x, cell.y)) {
    return { cell: null, newRelativeCoord }
  }
  return { cell, newRelativeCoord }
}

export function applyMove(world: World, dir: Direction): World | null {
  return tryMovePiece(world, PLAYER_ID, dir, new Map(), new Set())
}

export function tryMovePiece(
  world: World,
  pieceId: PieceId,
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const already = inMotion.get(pieceId)
  if (already !== undefined) {
    return already === dir ? world : null
  }

  const loc = world.locations[pieceId]
  const target = computeTarget(world, loc, dir, HALF)
  if (target === null) return null

  const targetBoard = world.boards[target.location.board]
  if (targetBoard.cells[target.location.y][target.location.x].type === 'wall') return null

  const occupant = occupantAt(world, target.location)
  if (!occupant) return moveTo(world, pieceId, target.location)

  return resolveBlocked(world, pieceId, occupant, target, dir, inMotion, beingEntered)
}

export function tryEnter(
  world: World,
  pieceId: PieceId,
  intoId: PieceId,
  dir: Direction,
  relativeCoord: Fraction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  if (beingEntered.has(intoId)) return null

  const into: Piece = world.pieces[intoId]
  if (into.kind !== 'container') return null

  const board = world.boards[into.boardRef as string]
  const { cell, newRelativeCoord } = getEntryCell(board, dir, relativeCoord)
  if (cell === null) return null
  if (board.cells[cell.y][cell.x].type === 'wall') return null

  const target: Location = { board: board.id, x: cell.x, y: cell.y }
  const nextBeingEntered = new Set(beingEntered).add(intoId)

  const occupant = occupantAt(world, target)
  if (!occupant) return moveTo(world, pieceId, target)

  return resolveBlocked(
    world, pieceId, occupant,
    { location: target, relativeCoord: newRelativeCoord },
    dir, inMotion, nextBeingEntered,
  )
}

export function resolveBlocked(
  world: World,
  pieceId: PieceId,
  occupantId: PieceId,
  target: { location: Location; relativeCoord: Fraction },
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const nextInMotion = new Map(inMotion).set(pieceId, dir)

  const pushed = tryMovePiece(world, occupantId, dir, nextInMotion, new Set())
  if (pushed) return moveTo(pushed, pieceId, target.location)

  const entered = tryEnter(
    world, pieceId, occupantId, dir, target.relativeCoord,
    nextInMotion, beingEntered,
  )
  if (entered) return entered

  const eaten = tryEnter(
    world, occupantId, pieceId, opposite(dir), HALF,
    nextInMotion, new Set(),
  )
  if (eaten) return moveTo(eaten, pieceId, target.location)

  return null
}
