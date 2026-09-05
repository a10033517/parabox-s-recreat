import { World, Cell, PLAYER_ID } from '../../src/game/engine/types'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { SeedGroup } from './seed'
import { GenerationEvent } from './generateLevel'
import { computeTouchedGroups, pruneUntouchedGoals } from './pruneUntouchedGoals'

function makeGroup(i: number, x: number, y: number): SeedGroup {
  return {
    containerId: `goal${i}`,
    boxId: `box${i}`,
    interiorId: `goal${i}Inside`,
    originalPosition: { x, y },
  }
}

function makeSmallBoard(id: string, size: number) {
  return { id, size, cells: Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const }))) }
}

function makeTwoGroupWorld(): World {
  const size = 12
  const cells: Cell[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const })))
  cells[3][3] = { type: 'floor', requirement: 'box' }
  cells[8][8] = { type: 'floor', requirement: 'box' }
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

test('computeTouchedGroups marks a group touched via its containerId', () => {
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const events: GenerationEvent[] = [
    { kind: 'push', direction: 'right', affectedPieceIds: ['player', 'goal1'] },
  ]
  const touched = computeTouchedGroups(events, groups)
  expect(touched.has('goal1')).toBe(true)
  expect(touched.has('goal0')).toBe(false)
})

test('computeTouchedGroups marks a group touched via its boxId alone', () => {
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const events: GenerationEvent[] = [
    { kind: 'eat', direction: 'right', affectedPieceIds: ['box1'] },
  ]
  const touched = computeTouchedGroups(events, groups)
  expect(touched.has('goal1')).toBe(true)
  expect(touched.has('goal0')).toBe(false)
})

test('computeTouchedGroups keeps a group touched even if it moved and later returned to its original position', () => {
  const groups = [makeGroup(0, 3, 3)]
  const events: GenerationEvent[] = [
    { kind: 'push', direction: 'right', affectedPieceIds: ['player', 'goal0'] },
    { kind: 'push', direction: 'left', affectedPieceIds: ['player', 'goal0'] },
  ]
  const touched = computeTouchedGroups(events, groups)
  expect(touched.has('goal0')).toBe(true)
})

test('pruneUntouchedGoals removes an untouched group and keeps a touched one', () => {
  const world = makeTwoGroupWorld()
  world.locations.goal1 = { board: 'root', x: 5, y: 3 } // moved away from (8,8)
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const touched = new Set(['goal1'])

  const result = pruneUntouchedGoals(world, groups, touched)

  expect(result.pieces.goal0).toBeUndefined()
  expect(result.locations.goal0).toBeUndefined()
  expect(result.pieces.box0).toBeUndefined()
  expect(result.locations.box0).toBeUndefined()
  expect(result.boards.goal0Inside).toBeUndefined()
  expect(result.boards.root.cells[3][3].requirement).toBeUndefined()

  expect(result.pieces.goal1).toBeDefined()
  expect(result.locations.goal1).toEqual({ board: 'root', x: 5, y: 3 })
  expect(result.boards.goal1Inside).toBeDefined()
  expect(result.pieces.box1).toBeDefined()
})

test('pruneUntouchedGoals leaves the player untouched', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const result = pruneUntouchedGoals(world, groups, new Set())
  expect(result.pieces[PLAYER_ID]).toBeDefined()
  expect(result.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
})

test('pruneUntouchedGoals removing every group still passes parseLevel', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const result = pruneUntouchedGoals(world, groups, new Set())
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
  expect(() => pruneUntouchedGoals(world, groups, new Set())).toThrow(/refusing to remove group goal0/)
})
