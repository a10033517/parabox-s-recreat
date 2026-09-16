import { PLAYER_ID } from '../game/engine/types'
import {
  canPlacePieceAt,
  createEmptyBoard,
  createEmptyWorld,
  deletePieceRecursively,
  movePlayer,
  placeContainerBox,
  placeNormalBox,
  setCellType,
  setRequirement,
} from './worldEdit'

test('createEmptyBoard returns an all-floor square board of the given size', () => {
  const board = createEmptyBoard('b', 3)
  expect(board.id).toBe('b')
  expect(board.size).toBe(3)
  expect(board.cells).toHaveLength(3)
  expect(board.cells.every((row) => row.every((cell) => cell.type === 'floor'))).toBe(true)
})

test('createEmptyWorld has exactly one player, placed in the bottom-right corner of root', () => {
  const world = createEmptyWorld(6)
  expect(Object.keys(world.pieces)).toEqual([PLAYER_ID])
  expect(world.locations[PLAYER_ID]).toEqual({ board: 'root', x: 5, y: 5 })
  expect(world.boards.root.size).toBe(6)
})

test("setCellType changes a cell's type without mutating the original world", () => {
  const world = createEmptyWorld(6)
  const next = setCellType(world, 'root', 1, 1, 'wall')
  expect(next.boards.root.cells[1][1].type).toBe('wall')
  expect(world.boards.root.cells[1][1].type).toBe('floor')
})

test('setCellType clears a normal box occupying the cell', () => {
  let world = createEmptyWorld(6)
  const placed = placeNormalBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 })!
  world = placed.world
  const next = setCellType(world, 'root', 1, 1, 'wall')
  expect(next.pieces['box-0']).toBeUndefined()
  expect(next.locations['box-0']).toBeUndefined()
})

test('setCellType never deletes the player', () => {
  const world = createEmptyWorld(6)
  const next = setCellType(world, 'root', 5, 5, 'wall')
  expect(next.pieces[PLAYER_ID]).toBeDefined()
  expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 5, y: 5 })
})

test('setRequirement toggles a requirement on and off', () => {
  const world = createEmptyWorld(6)
  const once = setRequirement(world, 'root', 2, 2, 'box')
  expect(once.boards.root.cells[2][2].requirement).toBe('box')
  const twice = setRequirement(once, 'root', 2, 2, 'box')
  expect(twice.boards.root.cells[2][2].requirement).toBeUndefined()
})

test('setRequirement switches from one requirement straight to the other', () => {
  const world = createEmptyWorld(6)
  const boxGoal = setRequirement(world, 'root', 2, 2, 'box')
  const playerGoal = setRequirement(boxGoal, 'root', 2, 2, 'player')
  expect(playerGoal.boards.root.cells[2][2].requirement).toBe('player')
})

test('placeNormalBox adds a piece and increments the id counter', () => {
  const world = createEmptyWorld(6)
  const result = placeNormalBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 })!
  expect(result.world.pieces['box-0']).toEqual({ id: 'box-0', kind: 'normal' })
  expect(result.world.locations['box-0']).toEqual({ board: 'root', x: 1, y: 1 })
  expect(result.ids).toEqual({ nextBoxId: 1, nextBoardId: 0 })
})

test('placeNormalBox is blocked when the target cell holds the player', () => {
  const world = createEmptyWorld(6)
  const result = placeNormalBox(world, 'root', 5, 5, { nextBoxId: 0, nextBoardId: 0 })
  expect(result).toBeNull()
})

test('placeContainerBox creates a piece and a fresh interior board, and advances both counters', () => {
  const world = createEmptyWorld(6)
  const result = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  expect(result.world.pieces['box-0']).toEqual({ id: 'box-0', kind: 'container', boardRef: 'board-0' })
  expect(result.world.boards['board-0'].size).toBe(3)
  expect(result.ids).toEqual({ nextBoxId: 1, nextBoardId: 1 })
})

test('deletePieceRecursively removes a container, its board, and everything inside it', () => {
  let world = createEmptyWorld(6)
  const outer = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  world = outer.world
  const inner = placeNormalBox(world, 'board-0', 0, 0, outer.ids)!
  world = inner.world

  const next = deletePieceRecursively(world, 'box-0')

  expect(next.pieces['box-0']).toBeUndefined()
  expect(next.pieces['box-1']).toBeUndefined()
  expect(next.boards['board-0']).toBeUndefined()
  expect(Object.keys(next.boards)).toEqual(['root'])
})

test('movePlayer relocates the player and clears whatever piece was there, recursively', () => {
  let world = createEmptyWorld(6)
  const outer = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  world = outer.world
  const inner = placeNormalBox(world, 'board-0', 0, 0, outer.ids)!
  world = inner.world

  const next = movePlayer(world, 'root', 1, 1)

  expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
  expect(next.pieces['box-0']).toBeUndefined()
  expect(next.pieces['box-1']).toBeUndefined()
  expect(next.boards['board-0']).toBeUndefined()
})

test('setCellType preserves a container whose interior contains the player', () => {
  let world = createEmptyWorld(6)
  const outer = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  world = outer.world
  // Move player inside the container
  world = movePlayer(world, 'board-0', 0, 0)

  // Try to delete the container by changing the cell type
  const next = setCellType(world, 'root', 1, 1, 'wall')

  // Player and container should both survive
  expect(next.pieces[PLAYER_ID]).toBeDefined()
  expect(next.locations[PLAYER_ID]).toEqual({ board: 'board-0', x: 0, y: 0 })
  expect(next.pieces['box-0']).toBeDefined()
  expect(next.boards['board-0']).toBeDefined()
})

test('movePlayer onto a container is a no-op when the player is already inside it', () => {
  let world = createEmptyWorld(6)
  const outer = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  world = outer.world
  // Move player inside the container
  world = movePlayer(world, 'board-0', 0, 0)

  const originalLocation = world.locations[PLAYER_ID]

  // Try to move player onto the container
  const next = movePlayer(world, 'root', 1, 1)

  // Player location should be unchanged (no-op)
  expect(next.locations[PLAYER_ID]).toEqual(originalLocation)
})

test('placeNormalBox is blocked when the target cell contains a container with the player inside', () => {
  let world = createEmptyWorld(6)
  const outer = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  world = outer.world
  // Move player inside the container
  world = movePlayer(world, 'board-0', 0, 0)

  // Try to place a box at the container location
  const result = placeNormalBox(world, 'root', 1, 1, { nextBoxId: 1, nextBoardId: 1 })

  // Placement should be blocked
  expect(result).toBeNull()
})

test('setCellType clears a requirement when painting a wall over a goal cell', () => {
  const world = createEmptyWorld(6)
  const withGoal = setRequirement(world, 'root', 2, 2, 'box')
  expect(withGoal.boards.root.cells[2][2].requirement).toBe('box')

  const walled = setCellType(withGoal, 'root', 2, 2, 'wall')
  expect(walled.boards.root.cells[2][2].requirement).toBeUndefined()
  expect(walled.boards.root.cells[2][2].type).toBe('wall')
})

test('setCellType to floor leaves an existing requirement untouched', () => {
  const world = createEmptyWorld(6)
  const withGoal = setRequirement(world, 'root', 2, 2, 'player')
  const stillFloor = setCellType(withGoal, 'root', 2, 2, 'floor')
  expect(stillFloor.boards.root.cells[2][2].requirement).toBe('player')
})

test('canPlacePieceAt is true for an empty cell', () => {
  const world = createEmptyWorld(6)
  expect(canPlacePieceAt(world, 'root', 1, 1)).toBe(true)
})

test('canPlacePieceAt is true for a cell holding an occupant whose subtree does not contain the player', () => {
  let world = createEmptyWorld(6)
  const placed = placeNormalBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 })!
  world = placed.world
  expect(canPlacePieceAt(world, 'root', 1, 1)).toBe(true)
})

test('canPlacePieceAt is false for the cell the player occupies', () => {
  const world = createEmptyWorld(6)
  expect(canPlacePieceAt(world, 'root', 5, 5)).toBe(false)
})

test('canPlacePieceAt is false for a container whose subtree contains the player', () => {
  let world = createEmptyWorld(6)
  const outer = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  world = outer.world
  world = movePlayer(world, 'board-0', 0, 0)
  expect(canPlacePieceAt(world, 'root', 1, 1)).toBe(false)
})
