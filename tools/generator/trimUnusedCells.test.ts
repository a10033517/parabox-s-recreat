import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, World } from '../../src/game/engine/types'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { trimUnusedCells } from './trimUnusedCells'

function makeOpenWorld(size: number): World {
  return {
    boards: {
      root: {
        id: 'root',
        size,
        cells: Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const }))),
      },
    },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 2 }, box1: { board: 'root', x: 1, y: 2 } },
  }
}

test('trimUnusedCells walls off floor cells never occupied during the replayed solution', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const moves: Direction[] = ['right', 'right']

  const trimmed = trimUnusedCells(world, moves)

  // Row 2, columns 0-3 were occupied by some piece at some point.
  for (const x of [0, 1, 2, 3]) {
    expect(trimmed.boards.root.cells[2][x].type).toBe('floor')
  }
  // Row 2, column 4 was never occupied.
  expect(trimmed.boards.root.cells[2][4].type).toBe('wall')
  // Every other row was never touched at all.
  for (const y of [0, 1, 3, 4]) {
    for (let x = 0; x < 5; x++) {
      expect(trimmed.boards.root.cells[y][x].type).toBe('wall')
    }
  }
})

test('the requirement cell always stays floor', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const trimmed = trimUnusedCells(world, ['right', 'right'])
  expect(trimmed.boards.root.cells[2][3].requirement).toBe('box')
  expect(trimmed.boards.root.cells[2][3].type).toBe('floor')
})

test('a requirement cell outside the used set is still never walled (defensive guard)', () => {
  const world = makeOpenWorld(5)
  // Requirement cell far from anything the (empty) move list ever touches.
  world.boards.root.cells[4][4] = { type: 'floor', requirement: 'box' }
  const trimmed = trimUnusedCells(world, [])
  expect(trimmed.boards.root.cells[4][4].type).toBe('floor')
})

test('the original world is left untouched (trimUnusedCells returns a clone)', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  trimUnusedCells(world, ['right', 'right'])
  expect(world.boards.root.cells[0][0].type).toBe('floor')
})

test('the exact same move sequence still reaches checkWin true against the trimmed world', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const moves: Direction[] = ['right', 'right']
  const trimmed = trimUnusedCells(world, moves)

  expect(checkWin(trimmed)).toBe(false)
  let current = trimmed
  for (const direction of moves) {
    const next = applyMove(current, direction)
    expect(next).not.toBeNull()
    current = next!
  }
  expect(checkWin(current)).toBe(true)
})

test('trimmed world still round-trips through parseLevel/serializeLevel', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const trimmed = trimUnusedCells(world, ['right', 'right'])
  expect(() => parseLevel(serializeLevel(trimmed))).not.toThrow()
})

test('trimUnusedCells throws on a move that is invalid for this world', () => {
  const world = makeOpenWorld(5)
  expect(() => trimUnusedCells(world, ['left'])).toThrow(/invalid move/)
})
