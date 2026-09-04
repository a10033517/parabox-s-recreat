import {
  Board, Direction, PLAYER_ID, PieceId, World,
  inBounds, step, opposite, occupantAt, cloneWorld,
} from '../../src/game/engine/types'
import { applyMove } from '../../src/game/engine/rules'
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
