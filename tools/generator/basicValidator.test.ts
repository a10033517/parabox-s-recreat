import { Board, Cell, PLAYER_ID, World } from '../../src/game/engine/types'
import { basicValidate, CORE_ONLY_POLICY } from './basicValidator'

function emptyBoard(id: string, size: number): Board {
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x): Cell => {
      const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1
      return { type: isBorder ? 'wall' : 'floor' }
    }),
  )
  return { id, size, cells }
}

function baseWorld(): World {
  const root = emptyBoard('root', 5)
  return {
    boards: { root },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 2, y: 2 } },
  }
}

test('accepts a minimal valid world', () => {
  expect(basicValidate(baseWorld(), 2)).toEqual({ valid: true })
})

test('rejects two pieces overlapping', () => {
  const world = baseWorld()
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.locations.box1 = { board: 'root', x: 2, y: 2 }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a piece starting on a wall cell', () => {
  const world = baseWorld()
  world.locations[PLAYER_ID] = { board: 'root', x: 0, y: 0 }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a world with no player piece', () => {
  const world = baseWorld()
  delete world.pieces[PLAYER_ID]
  delete world.locations[PLAYER_ID]
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a goal count that does not match the box count', () => {
  const world = baseWorld()
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.locations.box1 = { board: 'root', x: 1, y: 1 }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a board whose floor is split into two disconnected regions', () => {
  const root = emptyBoard('root', 5)
  for (let y = 0; y < 5; y++) root.cells[y][2] = { type: 'wall' }
  const world: World = {
    boards: { root },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 1, y: 1 } },
  }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a container whose interior board has no owner (orphan)', () => {
  const world = baseWorld()
  world.boards.inside = emptyBoard('inside', 3)
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a board referenced by more than one container', () => {
  const world = baseWorld()
  world.boards.inside = emptyBoard('inside', 3)
  world.boards.root.cells[1][1] = { type: 'wall' }
  world.boards.root.cells[1][3] = { type: 'wall' }
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside' }
  world.locations.container1 = { board: 'root', x: 1, y: 2 }
  world.pieces.container2 = { id: 'container2', kind: 'container', boardRef: 'inside' }
  world.locations.container2 = { board: 'root', x: 3, y: 2 }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects nesting depth beyond the configured maximum', () => {
  const world = baseWorld()
  const inside1 = emptyBoard('inside1', 3)
  const inside2 = emptyBoard('inside2', 3)
  world.boards.inside1 = inside1
  world.boards.inside2 = inside2
  world.boards.root.cells[1][1] = { type: 'wall' } // blocks container1's "up" side
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside1' }
  world.locations.container1 = { board: 'root', x: 1, y: 2 }
  // A fresh 3x3 board's only floor cell is its center (1,1) — bordered on
  // all 4 sides by wall, so it's automatically blockable without any
  // extra wall placement.
  world.pieces.container2 = { id: 'container2', kind: 'container', boardRef: 'inside2' }
  world.locations.container2 = { board: 'inside1', x: 1, y: 1 }
  // inside2 is 2 hops from root (root -> inside1 -> inside2): rejected at
  // maxNestingDepth 1, accepted at 2.
  expect(basicValidate(world, 1).valid).toBe(false)
  expect(basicValidate(world, 2).valid).toBe(true)
})

test('rejects a container with open floor on all 4 sides (never enterable)', () => {
  const world = baseWorld()
  world.boards.inside = emptyBoard('inside', 3)
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside' }
  world.locations.container1 = { board: 'root', x: 2, y: 2 }
  world.locations[PLAYER_ID] = { board: 'root', x: 1, y: 1 }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('CORE_ONLY_POLICY accepts disconnected floor and unbalanced goals (generation heuristics, not rules)', () => {
  const world = baseWorld()
  world.boards.root.cells[2][1] = { type: 'wall' }
  world.boards.root.cells[2][3] = { type: 'wall' }
  world.boards.root.cells[1][2] = { type: 'wall' }
  world.boards.root.cells[3][2] = { type: 'wall' }
  world.boards.root.cells[1][1] = { type: 'floor', requirement: 'box' }
  expect(basicValidate(world, 2).valid).toBe(false)
  expect(basicValidate(world, 2, CORE_ONLY_POLICY)).toEqual({ valid: true })
})

test('CORE_ONLY_POLICY accepts an open-sided container and a shared interior', () => {
  const world = baseWorld()
  world.boards.inner = emptyBoard('inner', 3)
  world.pieces.c1 = { id: 'c1', kind: 'container', boardRef: 'inner' }
  world.pieces.c2 = { id: 'c2', kind: 'container', boardRef: 'inner' }
  world.locations.c1 = { board: 'root', x: 2, y: 1 }
  world.locations.c2 = { board: 'root', x: 1, y: 2 }
  expect(basicValidate(world, 2).valid).toBe(false)
  expect(basicValidate(world, 2, CORE_ONLY_POLICY)).toEqual({ valid: true })
})
