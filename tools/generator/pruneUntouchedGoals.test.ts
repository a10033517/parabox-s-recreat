import { World, Cell, PLAYER_ID } from '../../src/game/engine/types'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { SeedGroup } from './seed'
import { getSurvivingGroups, isGroupUntouched, pruneUntouchedGoals } from './pruneUntouchedGoals'

function makeGroup(i: number, x: number, y: number, boxX = 1, boxY = 1): SeedGroup {
  return {
    containerId: `goal${i}`,
    boxId: `box${i}`,
    interiorId: `goal${i}Inside`,
    originalPosition: { x, y },
    boxOriginalPosition: { x: boxX, y: boxY },
  }
}

function makeSmallBoard(id: string, size: number) {
  return { id, size, cells: Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const }))) }
}

function makeTwoGroupWorld(): World {
  const size = 12
  const cells: Cell[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const })))
  return {
    boards: {
      root: { id: 'root', size, cells },
      goal0Inside: makeSmallBoard('goal0Inside', 3),
      goal1Inside: makeSmallBoard('goal1Inside', 3),
    },
    pieces: {
      player: { id: 'player', kind: 'player' },
      goal0: { id: 'goal0', kind: 'container', boardRef: 'goal0Inside' },
      box0: { id: 'box0', kind: 'normal' },
      goal1: { id: 'goal1', kind: 'container', boardRef: 'goal1Inside' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 1 },
      goal0: { board: 'root', x: 3, y: 3 },
      box0: { board: 'goal0Inside', x: 1, y: 1 },
      goal1: { board: 'root', x: 8, y: 8 },
      box1: { board: 'goal1Inside', x: 1, y: 1 },
    },
  }
}

test('isGroupUntouched is true when the box is still at its seed interior position', () => {
  const world = makeTwoGroupWorld()
  const group = makeGroup(0, 3, 3)
  expect(isGroupUntouched(world, group)).toBe(true)
})

test('isGroupUntouched is false once the box has left its seed interior position', () => {
  const world = makeTwoGroupWorld()
  world.locations.box1 = { board: 'root', x: 5, y: 3 } // eaten out to root
  const group = makeGroup(1, 8, 8)
  expect(isGroupUntouched(world, group)).toBe(false)
})

test('isGroupUntouched is false if the box moved within the same interior board', () => {
  const world = makeTwoGroupWorld()
  world.locations.box1 = { board: 'goal1Inside', x: 2, y: 2 }
  const group = makeGroup(1, 8, 8, 1, 1)
  expect(isGroupUntouched(world, group)).toBe(false)
})

test('pruneUntouchedGoals removes an untouched group and keeps a touched one', () => {
  const world = makeTwoGroupWorld()
  world.locations.box1 = { board: 'root', x: 5, y: 3 } // eaten out — group1 touched
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]

  const result = pruneUntouchedGoals(world, groups)

  expect(result.pieces.goal0).toBeUndefined()
  expect(result.locations.goal0).toBeUndefined()
  expect(result.pieces.box0).toBeUndefined()
  expect(result.locations.box0).toBeUndefined()
  expect(result.boards.goal0Inside).toBeUndefined()

  expect(result.pieces.goal1).toBeDefined()
  expect(result.locations.box1).toEqual({ board: 'root', x: 5, y: 3 })
  expect(result.boards.goal1Inside).toBeDefined()
})

test('getSurvivingGroups returns exactly the groups whose pieces/board still exist', () => {
  const world = makeTwoGroupWorld()
  world.locations.box1 = { board: 'root', x: 5, y: 3 }
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const pruned = pruneUntouchedGoals(world, groups)
  const survivors = getSurvivingGroups(pruned, groups)
  expect(survivors.map((g) => g.containerId)).toEqual(['goal1'])
})

test('getSurvivingGroups returns an empty list when every group was pruned', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const pruned = pruneUntouchedGoals(world, groups)
  expect(getSurvivingGroups(pruned, groups)).toEqual([])
})

test('pruneUntouchedGoals leaves the player untouched', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const result = pruneUntouchedGoals(world, groups)
  expect(result.pieces[PLAYER_ID]).toBeDefined()
  expect(result.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
})

test('pruneUntouchedGoals removing every group still passes parseLevel', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const result = pruneUntouchedGoals(world, groups)
  expect(Object.keys(result.pieces)).toEqual([PLAYER_ID])
  expect(() => parseLevel(serializeLevel(result))).not.toThrow()
})

test('removeGroup refuses to delete the player and throws instead', () => {
  const world = makeTwoGroupWorld()
  // Force the player onto group0's interior -- impossible in a real
  // generateLevel walk (see the spec), hand-built here specifically to
  // exercise the defensive check.
  world.locations.player = { board: 'goal0Inside', x: 0, y: 0 }
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  expect(() => pruneUntouchedGoals(world, groups)).toThrow(/refusing to remove group goal0/)
})
