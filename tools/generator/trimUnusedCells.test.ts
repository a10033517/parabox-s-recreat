import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, World } from '../../src/game/engine/types'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { removeUnusedFillerBoxes, trimUnusedCells } from './trimUnusedCells'
import { GENERATOR_CONFIG } from './generatorConfig'

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

test('bufferRadius 0 reproduces the original bare-corridor behavior', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const moves: Direction[] = ['right', 'right']

  const trimmed = trimUnusedCells(world, moves, 0)

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

test('bufferRadius 1 keeps a one-cell margin around the used path', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const trimmed = trimUnusedCells(world, ['right', 'right'], 1)

  // Path row (y=2): fully kept, including column 4 (one step from column 3).
  for (let x = 0; x < 5; x++) expect(trimmed.boards.root.cells[2][x].type).toBe('floor')
  // Rows immediately above/below the path (y=1, y=3): kept under columns
  // 0-3 (one step from the path), but not column 4 (two steps away).
  for (const y of [1, 3]) {
    for (const x of [0, 1, 2, 3]) expect(trimmed.boards.root.cells[y][x].type).toBe('floor')
    expect(trimmed.boards.root.cells[y][4].type).toBe('wall')
  }
  // Two steps away from the path (y=0, y=4): still walled at radius 1.
  for (const y of [0, 4]) {
    for (let x = 0; x < 5; x++) expect(trimmed.boards.root.cells[y][x].type).toBe('wall')
  }
})

test('a wider bufferRadius keeps strictly more floor than a narrower one', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const moves: Direction[] = ['right', 'right']
  // Two steps from the path (via row 1/3) reaches row 0/4 — radius 2 keeps it.
  const trimmedRadius2 = trimUnusedCells(world, moves, 2)
  expect(trimmedRadius2.boards.root.cells[0][0].type).toBe('floor')
})

test('bufferRadius expansion is blocked by pre-existing walls, not just distance', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  // Wall off (0,1) directly above the path's starting cell — a large
  // bufferRadius should not tunnel through it.
  world.boards.root.cells[1][0] = { type: 'wall' }
  const trimmed = trimUnusedCells(world, ['right', 'right'], 3)
  expect(trimmed.boards.root.cells[1][0].type).toBe('wall')
})

test('the default bufferRadius comes from GENERATOR_CONFIG.trimBufferRadius', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const moves: Direction[] = ['right', 'right']
  const viaDefault = trimUnusedCells(world, moves)
  const viaExplicitConfig = trimUnusedCells(world, moves, GENERATOR_CONFIG.trimBufferRadius)
  expect(viaDefault).toEqual(viaExplicitConfig)
})

test('the requirement cell always stays floor', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const trimmed = trimUnusedCells(world, ['right', 'right'], 0)
  expect(trimmed.boards.root.cells[2][3].requirement).toBe('box')
  expect(trimmed.boards.root.cells[2][3].type).toBe('floor')
})

test('a requirement cell outside the used set is still never walled (defensive guard)', () => {
  const world = makeOpenWorld(5)
  // Requirement cell far from anything the (empty) move list ever touches.
  world.boards.root.cells[4][4] = { type: 'floor', requirement: 'box' }
  const trimmed = trimUnusedCells(world, [], 0)
  expect(trimmed.boards.root.cells[4][4].type).toBe('floor')
})

test('the original world is left untouched (trimUnusedCells returns a clone)', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  trimUnusedCells(world, ['right', 'right'], 0)
  expect(world.boards.root.cells[0][0].type).toBe('floor')
})

test('the exact same move sequence still reaches checkWin true against the trimmed world', () => {
  const world = makeOpenWorld(5)
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const moves: Direction[] = ['right', 'right']
  const trimmed = trimUnusedCells(world, moves, 1)

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
  const trimmed = trimUnusedCells(world, ['right', 'right'], 1)
  expect(() => parseLevel(serializeLevel(trimmed))).not.toThrow()
})

test('trimUnusedCells throws on a move that is invalid for this world', () => {
  const world = makeOpenWorld(5)
  expect(() => trimUnusedCells(world, ['left'], 0)).toThrow(/invalid move/)
})

function makeWorldWithFillers(): World {
  const world = makeOpenWorld(5)
  world.pieces.filler0 = { id: 'filler0', kind: 'normal' }
  world.pieces.filler1 = { id: 'filler1', kind: 'normal' }
  // filler0 sits in the push path (box1 gets pushed right, from x=1 toward
  // x=2/x=3 depending on moves) — placed so a 'right' push displaces it.
  world.locations.filler0 = { board: 'root', x: 3, y: 2 }
  // filler1 sits far away, never touched by a rightward push along row 2.
  world.locations.filler1 = { board: 'root', x: 0, y: 4 }
  return world
}

test('removeUnusedFillerBoxes deletes a filler box that never moves, and keeps one that does', () => {
  const world = makeWorldWithFillers()
  const moves: Direction[] = ['right', 'right']
  const result = removeUnusedFillerBoxes(world, moves, ['filler0', 'filler1'])

  expect(result.pieces.filler0).toBeDefined() // pushed by the second 'right'
  expect(result.locations.filler0).toBeDefined()
  expect(result.pieces.filler1).toBeUndefined() // never touched
  expect(result.locations.filler1).toBeUndefined()
})

test('removeUnusedFillerBoxes does not throw on a filler id missing from the world (defensive guard)', () => {
  const world = makeWorldWithFillers()
  expect(() => removeUnusedFillerBoxes(world, ['right'], ['filler0', 'ghostFiller'])).not.toThrow()
})

test('removeUnusedFillerBoxes returns a clone, leaving the original world untouched', () => {
  const world = makeWorldWithFillers()
  removeUnusedFillerBoxes(world, ['right', 'right'], ['filler0', 'filler1'])
  expect(world.pieces.filler1).toBeDefined()
})

test('removeUnusedFillerBoxes throws on a move that is invalid for this world', () => {
  const world = makeWorldWithFillers()
  expect(() => removeUnusedFillerBoxes(world, ['left'], ['filler0'])).toThrow(/invalid move/)
})

test('trimUnusedCells composed after removeUnusedFillerBoxes still solves identically (checkWin reached)', () => {
  // box1's own push path (row 2) stays completely clear; both filler boxes
  // sit off that row and are never touched by these moves.
  const world = makeOpenWorld(5)
  world.pieces.filler0 = { id: 'filler0', kind: 'normal' }
  world.pieces.filler1 = { id: 'filler1', kind: 'normal' }
  world.locations.filler0 = { board: 'root', x: 2, y: 0 }
  world.locations.filler1 = { board: 'root', x: 0, y: 4 }
  world.boards.root.cells[2][3] = { type: 'floor', requirement: 'box' }
  const moves: Direction[] = ['right', 'right']

  const withoutFillers = removeUnusedFillerBoxes(world, moves, ['filler0', 'filler1'])
  expect(withoutFillers.pieces.filler0).toBeUndefined()
  expect(withoutFillers.pieces.filler1).toBeUndefined()

  const shipped = trimUnusedCells(withoutFillers, moves)
  let current = shipped
  for (const direction of moves) {
    const next = applyMove(current, direction)
    expect(next).not.toBeNull()
    current = next!
  }
  expect(checkWin(current)).toBe(true)
})
