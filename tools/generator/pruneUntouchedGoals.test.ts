import { World, Cell, PLAYER_ID } from '../../src/game/engine/types'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { SeedGroup } from './seed'
import { getSurvivingGroups, isGroupUntouched, pruneUntouchedGoals } from './pruneUntouchedGoals'

function makeSingleBoxGroup(i: number, x: number, y: number, boxX = 1, boxY = 1): SeedGroup {
  return {
    containerId: `goal${i}`,
    interiorId: `goal${i}Inside`,
    originalPosition: { x, y },
    boxes: [{ boxId: `box${i}`, originalPosition: { x: boxX, y: boxY } }],
  }
}

function makeTwoBoxGroup(i: number, x: number, y: number): SeedGroup {
  return {
    containerId: `goal${i}`,
    interiorId: `goal${i}Inside`,
    originalPosition: { x, y },
    boxes: [
      { boxId: `box${i}_0`, originalPosition: { x: 0, y: 1 } },
      { boxId: `box${i}_1`, originalPosition: { x: 2, y: 1 } },
    ],
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

function makeTwoBoxGroupWorld(): World {
  const size = 12
  const cells: Cell[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const })))
  return {
    boards: {
      root: { id: 'root', size, cells },
      goal0Inside: makeSmallBoard('goal0Inside', 3),
    },
    pieces: {
      player: { id: 'player', kind: 'player' },
      goal0: { id: 'goal0', kind: 'container', boardRef: 'goal0Inside' },
      box0_0: { id: 'box0_0', kind: 'normal' },
      box0_1: { id: 'box0_1', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 1 },
      goal0: { board: 'root', x: 3, y: 3 },
      box0_0: { board: 'goal0Inside', x: 0, y: 1 },
      box0_1: { board: 'goal0Inside', x: 2, y: 1 },
    },
  }
}

test('isGroupUntouched is true when the box is still at its seed interior position', () => {
  const world = makeTwoGroupWorld()
  const group = makeSingleBoxGroup(0, 3, 3)
  expect(isGroupUntouched(world, group)).toBe(true)
})

test('isGroupUntouched is false once the box has left its seed interior position', () => {
  const world = makeTwoGroupWorld()
  world.locations.box1 = { board: 'root', x: 5, y: 3 } // eaten out to root
  const group = makeSingleBoxGroup(1, 8, 8)
  expect(isGroupUntouched(world, group)).toBe(false)
})

test('isGroupUntouched is false if the box moved within the same interior board', () => {
  const world = makeTwoGroupWorld()
  world.locations.box1 = { board: 'goal1Inside', x: 2, y: 2 }
  const group = makeSingleBoxGroup(1, 8, 8, 1, 1)
  expect(isGroupUntouched(world, group)).toBe(false)
})

test('isGroupUntouched treats a missing box location as not untouched (defensive)', () => {
  const world = makeTwoGroupWorld()
  delete world.locations.box1
  const group = makeSingleBoxGroup(1, 8, 8)
  expect(isGroupUntouched(world, group)).toBe(false)
})

test('a two-box group is untouched only when BOTH boxes are still at their seed positions', () => {
  const world = makeTwoBoxGroupWorld()
  const group = makeTwoBoxGroup(0, 3, 3)
  expect(isGroupUntouched(world, group)).toBe(true)

  // Move only the first box out.
  const oneMoved = makeTwoBoxGroupWorld()
  oneMoved.locations.box0_0 = { board: 'root', x: 5, y: 5 }
  expect(isGroupUntouched(oneMoved, group)).toBe(false)

  // Move only the second box out.
  const otherMoved = makeTwoBoxGroupWorld()
  otherMoved.locations.box0_1 = { board: 'root', x: 6, y: 6 }
  expect(isGroupUntouched(otherMoved, group)).toBe(false)
})

test('pruneUntouchedGoals removes an untouched group and keeps a touched one', () => {
  const world = makeTwoGroupWorld()
  world.locations.box1 = { board: 'root', x: 5, y: 3 } // eaten out — group1 touched
  const groups = [makeSingleBoxGroup(0, 3, 3), makeSingleBoxGroup(1, 8, 8)]

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

test('pruneUntouchedGoals keeps a two-box group intact when only one box moved, including the untouched box', () => {
  const world = makeTwoBoxGroupWorld()
  world.locations.box0_0 = { board: 'root', x: 5, y: 5 } // only box0_0 displaced
  const group = makeTwoBoxGroup(0, 3, 3)

  const result = pruneUntouchedGoals(world, [group])

  expect(result.pieces.goal0).toBeDefined()
  expect(result.boards.goal0Inside).toBeDefined()
  expect(result.locations.box0_0).toEqual({ board: 'root', x: 5, y: 5 })
  // The untouched box stays exactly where it was — its requirement is
  // already satisfied, and it is not deleted just because its sibling
  // moved.
  expect(result.locations.box0_1).toEqual({ board: 'goal0Inside', x: 2, y: 1 })
})

test('pruneUntouchedGoals removes a two-box group only when NEITHER box moved', () => {
  const world = makeTwoBoxGroupWorld()
  const group = makeTwoBoxGroup(0, 3, 3)

  const result = pruneUntouchedGoals(world, [group])

  expect(result.pieces.goal0).toBeUndefined()
  expect(result.boards.goal0Inside).toBeUndefined()
  expect(result.pieces.box0_0).toBeUndefined()
  expect(result.pieces.box0_1).toBeUndefined()
  expect(result.locations.box0_0).toBeUndefined()
  expect(result.locations.box0_1).toBeUndefined()
})

test('getSurvivingGroups returns exactly the groups whose pieces/board still exist', () => {
  const world = makeTwoGroupWorld()
  world.locations.box1 = { board: 'root', x: 5, y: 3 }
  const groups = [makeSingleBoxGroup(0, 3, 3), makeSingleBoxGroup(1, 8, 8)]
  const pruned = pruneUntouchedGoals(world, groups)
  const survivors = getSurvivingGroups(pruned, groups)
  expect(survivors.map((g) => g.containerId)).toEqual(['goal1'])
})

test('getSurvivingGroups requires EVERY box of a multi-box group to exist, not just one', () => {
  const world = makeTwoBoxGroupWorld()
  const group = makeTwoBoxGroup(0, 3, 3)
  // Simulate a partially-deleted group (shouldn't happen via real pruning,
  // but getSurvivingGroups must not treat this as surviving).
  delete world.pieces.box0_1
  expect(getSurvivingGroups(world, [group])).toEqual([])
})

test('getSurvivingGroups returns an empty list when every group was pruned', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeSingleBoxGroup(0, 3, 3), makeSingleBoxGroup(1, 8, 8)]
  const pruned = pruneUntouchedGoals(world, groups)
  expect(getSurvivingGroups(pruned, groups)).toEqual([])
})

test('pruneUntouchedGoals leaves the player untouched', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeSingleBoxGroup(0, 3, 3), makeSingleBoxGroup(1, 8, 8)]
  const result = pruneUntouchedGoals(world, groups)
  expect(result.pieces[PLAYER_ID]).toBeDefined()
  expect(result.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
})

test('pruneUntouchedGoals removing every group still passes parseLevel', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeSingleBoxGroup(0, 3, 3), makeSingleBoxGroup(1, 8, 8)]
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
  const groups = [makeSingleBoxGroup(0, 3, 3), makeSingleBoxGroup(1, 8, 8)]
  expect(() => pruneUntouchedGoals(world, groups)).toThrow(/refusing to remove group goal0/)
})

test('removeGroup refuses to delete the player even for a two-box group whose interior the player is inside', () => {
  const world = makeTwoBoxGroupWorld()
  world.locations.player = { board: 'goal0Inside', x: 1, y: 1 }
  const group = makeTwoBoxGroup(0, 3, 3)
  expect(() => pruneUntouchedGoals(world, [group])).toThrow(/refusing to remove group goal0/)
})
