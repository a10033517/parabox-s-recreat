import {
  Board, Direction, PLAYER_ID, PieceId, World,
  inBounds, step, opposite, occupantAt, findContainerFor, cloneWorld,
} from '../../src/game/engine/types'
import { applyMove, getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { canonicalKey } from './canonical'

function isOpenFloor(board: Board, x: number, y: number): boolean {
  return inBounds(board, x, y) && board.cells[y][x].type !== 'wall'
}

function verifyPredecessor(candidate: World, dir: Direction, expected: World): World | null {
  const result = applyMove(candidate, dir)
  if (result === null) return null
  if (canonicalKey(result) !== canonicalKey(expected)) return null
  return candidate
}

export function inversePush(world: World, dir: Direction): World | null {
  const loc = world.locations[PLAYER_ID]
  const board = world.boards[loc.board]

  const behind = step(loc.x, loc.y, opposite(dir))
  if (!isOpenFloor(board, behind.x, behind.y)) return null
  if (occupantAt(world, { board: loc.board, x: behind.x, y: behind.y })) return null

  const chain: PieceId[] = []
  let cursor = step(loc.x, loc.y, dir)
  while (inBounds(board, cursor.x, cursor.y)) {
    const occupant = occupantAt(world, { board: loc.board, x: cursor.x, y: cursor.y })
    if (!occupant) break
    chain.push(occupant)
    cursor = step(cursor.x, cursor.y, dir)
  }
  if (!isOpenFloor(board, cursor.x, cursor.y)) return null
  if (occupantAt(world, { board: loc.board, x: cursor.x, y: cursor.y })) return null

  const candidate = cloneWorld(world)
  candidate.locations[PLAYER_ID] = { board: loc.board, x: behind.x, y: behind.y }
  let px = loc.x
  let py = loc.y
  for (const pieceId of chain) {
    candidate.locations[pieceId] = { board: loc.board, x: px, y: py }
    const forward = step(px, py, dir)
    px = forward.x
    py = forward.y
  }

  return verifyPredecessor(candidate, dir, world)
}

export function inverseEnter(world: World, dir: Direction): World | null {
  const loc = world.locations[PLAYER_ID]
  const board = world.boards[loc.board]
  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null

  const { cell } = getEntryCell(board, dir, HALF)
  if (cell === null || cell.x !== loc.x || cell.y !== loc.y) return null

  const containerLoc = world.locations[containerId]
  const parentBoard = world.boards[containerLoc.board]
  const behind = step(containerLoc.x, containerLoc.y, opposite(dir))
  if (!isOpenFloor(parentBoard, behind.x, behind.y)) return null
  if (occupantAt(world, { board: containerLoc.board, x: behind.x, y: behind.y })) return null

  const candidate = cloneWorld(world)
  candidate.locations[PLAYER_ID] = { board: containerLoc.board, x: behind.x, y: behind.y }

  return verifyPredecessor(candidate, dir, world)
}

export function inverseEat(world: World, dir: Direction): World | null {
  const loc = world.locations[PLAYER_ID]
  const board = world.boards[loc.board]

  const containerPos = step(loc.x, loc.y, dir)
  const containerId = occupantAt(world, { board: loc.board, x: containerPos.x, y: containerPos.y })
  if (!containerId) return null
  const container = world.pieces[containerId]
  if (container.kind !== 'container' || container.boardRef === undefined) return null

  // wallAhead: the cell immediately ahead of the container in the push
  // direction — player -> container -> wall, all three in a row. This is
  // what blocks the container from being pushed further, forcing the eat
  // branch.
  const wallAhead = step(containerPos.x, containerPos.y, dir)
  if (!inBounds(board, wallAhead.x, wallAhead.y)) return null
  if (board.cells[wallAhead.y][wallAhead.x].type !== 'wall') return null

  const interior = world.boards[container.boardRef]
  const { cell: eatenCell } = getEntryCell(interior, opposite(dir), HALF)
  if (eatenCell === null) return null
  const eatenId = occupantAt(world, { board: interior.id, x: eatenCell.x, y: eatenCell.y })
  if (!eatenId) return null

  const behindPlayer = step(loc.x, loc.y, opposite(dir))
  if (!isOpenFloor(board, behindPlayer.x, behindPlayer.y)) return null
  if (occupantAt(world, { board: loc.board, x: behindPlayer.x, y: behindPlayer.y })) return null

  const candidate = cloneWorld(world)
  candidate.locations[PLAYER_ID] = { board: loc.board, x: behindPlayer.x, y: behindPlayer.y }
  candidate.locations[containerId] = { board: loc.board, x: loc.x, y: loc.y }
  candidate.locations[eatenId] = { board: loc.board, x: containerPos.x, y: containerPos.y }

  return verifyPredecessor(candidate, dir, world)
}
