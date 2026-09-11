import { Direction, opposite } from '../../src/game/engine/types'
import { getEntryCell, checkWin } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { assertValidSeedGroup, createSeedWorld, pickWallDirs } from './seed'
import { GENERATOR_CONFIG, SeedProfile } from './generatorConfig'

function sequenceRng(values: number[]): () => number {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('sequenceRng exhausted')
    return values[i++]
  }
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

// Local mirror of seed.ts's own slot-geometry helpers, used only to compute
// *expected* positions independently of the implementation under test.
const GRID_COLS = 2
const SLOT_SIZE = 5
const SLOT_CENTER_OFFSET = Math.floor(SLOT_SIZE / 2)
function slotCenter(index: number): { x: number; y: number } {
  const row = Math.floor(index / GRID_COLS)
  const col = index % GRID_COLS
  return { x: 1 + col * SLOT_SIZE + SLOT_CENTER_OFFSET, y: 1 + row * SLOT_SIZE + SLOT_CENTER_OFFSET }
}

function wallDeltasAround(x: number, y: number, cells: { type: string }[][]): [number, number][] {
  const deltas: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
  return deltas.filter(([dx, dy]) => cells[y + dy][x + dx].type === 'wall')
}

const directionFromDelta: Record<string, Direction> = {
  '-1,0': 'left', '1,0': 'right', '0,-1': 'up', '0,1': 'down',
}

// A single-box-only variant of a profile, used whenever a test isn't
// exercising multi-box behavior — multiBoxProbability: 0 makes the
// isMultiBox draw always false regardless of the rng value fed to it, so
// callers don't need to reason about that draw's exact threshold.
function singleBoxProfile(overrides: Partial<SeedProfile> = {}): SeedProfile {
  return {
    fourGroupProbability: 0.5,
    largeInteriorProbability: 0.5,
    remoteStartProbability: 0,
    multiBoxProbability: 0,
    fillerBoxCount: 0,
    obstacleBoxProbability: 0,
    ...overrides,
  }
}

// RNG contract per group (multi-box groups spec §5.3, extended by the
// obstacle-box feature): isMultiBox (1 call), wall direction(s) (1 call
// single-box / 2 calls multi-box), interior size (1 call), hasObstacle (1
// call). This sequence forces groupCount=4 (single draw, low value),
// playerSlot=0 (single draw for groupCount>=4), and all 4 groups
// single-box, covering all 4 wall directions and both interior sizes.
const ALL_COMBOS_RNG = () => sequenceRng([
  0.1, 0.0, // groupCount=4, playerSlot=0
  0.5, 0.0, 0.0, 0.5, // group0: isMultiBox=false, wallDir=up, interiorSize=5, hasObstacle=false
  0.5, 0.26, 0.9, 0.5, // group1: isMultiBox=false, wallDir=down, interiorSize=3, hasObstacle=false
  0.5, 0.51, 0.9, 0.5, // group2: isMultiBox=false, wallDir=left, interiorSize=3, hasObstacle=false
  0.5, 0.76, 0.9, 0.5, // group3: isMultiBox=false, wallDir=right, interiorSize=3, hasObstacle=false
])
const ALL_COMBOS_PROFILE = singleBoxProfile()

test('createSeedWorld produces 3 groups when the four-group draw fails', () => {
  const rng = sequenceRng([
    0.9, // groupCount draw >= 0.5 -> 3 groups
    0.9, 0.0, // playerSlot: remote-start check (false), active-slot pick
    0.1, 0.1, 0.1, 0.1, // group0 (single-box, values irrelevant beyond count)
    0.1, 0.1, 0.1, 0.1, // group1
    0.1, 0.1, 0.1, 0.1, // group2
  ])
  const { groups } = createSeedWorld(rng, singleBoxProfile())
  expect(groups.length).toBe(3)
})

test('createSeedWorld produces 4 single-box groups covering all 4 wall directions and both interior sizes', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG(), ALL_COMBOS_PROFILE)
  expect(groups.length).toBe(4)

  const root = world.boards.root
  const seenDirections = new Set<Direction>()
  const seenSizes = new Set<number>()

  for (const group of groups) {
    expect(group.boxes.length).toBe(1)
    const { x, y } = group.originalPosition
    const wallDeltas = wallDeltasAround(x, y, root.cells)
    expect(wallDeltas.length).toBe(1)
    const [dx, dy] = wallDeltas[0]
    const wallDir = directionFromDelta[`${dx},${dy}`]
    seenDirections.add(wallDir)

    const interior = world.boards[group.interiorId]
    seenSizes.add(interior.size)
    const { cell: expectedEntry } = getEntryCell(interior, opposite(wallDir), HALF)
    expect(expectedEntry).not.toBeNull()
    const box = group.boxes[0]
    expect(world.locations[box.boxId]).toEqual({
      board: group.interiorId,
      x: expectedEntry!.x,
      y: expectedEntry!.y,
    })
    expect(box.originalPosition).toEqual({ x: expectedEntry!.x, y: expectedEntry!.y })
  }

  expect(seenDirections.size).toBe(4)
  expect(seenSizes).toEqual(new Set([3, 5]))
})

test('the seed world is already solved for every requirement cell', () => {
  const { world } = createSeedWorld(ALL_COMBOS_RNG(), ALL_COMBOS_PROFILE)
  expect(checkWin(world)).toBe(true)
})

test('the seed world is internally consistent', () => {
  const { world } = createSeedWorld(ALL_COMBOS_RNG(), ALL_COMBOS_PROFILE)
  expect(() => parseLevel(serializeLevel(world))).not.toThrow()
})

test('a group container sits at its originalPosition with no requirement there; the requirement lives on each box inside', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG(), ALL_COMBOS_PROFILE)
  for (const group of groups) {
    expect(world.locations[group.containerId]).toEqual({
      board: 'root',
      x: group.originalPosition.x,
      y: group.originalPosition.y,
    })
    const containerCell = world.boards.root.cells[group.originalPosition.y][group.originalPosition.x]
    expect(containerCell.requirement).toBeUndefined()

    const interior = world.boards[group.interiorId]
    for (const box of group.boxes) {
      const boxCell = interior.cells[box.originalPosition.y][box.originalPosition.x]
      expect(boxCell.requirement).toBe('box')
    }
  }
})

test('no two groups (or the player) occupy overlapping coordinates on root', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG(), ALL_COMBOS_PROFILE)
  const root = world.boards.root
  const rootCoords: string[] = [`${world.locations.player.x},${world.locations.player.y}`]
  for (const group of groups) {
    rootCoords.push(`${group.originalPosition.x},${group.originalPosition.y}`)
    const { x, y } = group.originalPosition
    for (const [dx, dy] of wallDeltasAround(x, y, root.cells)) {
      rootCoords.push(`${x + dx},${y + dy}`)
    }
  }
  expect(new Set(rootCoords).size).toBe(rootCoords.length)
})

test('createSeedWorld respects a passed SeedProfile forcing the 4-group / large-interior branch', () => {
  const forcedProfile: SeedProfile = {
    fourGroupProbability: 1, largeInteriorProbability: 1, remoteStartProbability: 0, multiBoxProbability: 0, fillerBoxCount: 0, obstacleBoxProbability: 0,
  }
  const { world, groups } = createSeedWorld(() => 0.99, forcedProfile)
  expect(groups.length).toBe(4)
  for (const group of groups) {
    expect(world.boards[group.interiorId].size).toBe(5)
  }
})

test('createSeedWorld respects a passed SeedProfile forcing the 3-group / small-interior branch', () => {
  const forcedProfile: SeedProfile = {
    fourGroupProbability: 0, largeInteriorProbability: 0, remoteStartProbability: 0, multiBoxProbability: 0, fillerBoxCount: 0, obstacleBoxProbability: 0,
  }
  const { world, groups } = createSeedWorld(() => 0.01, forcedProfile)
  expect(groups.length).toBe(3)
  for (const group of groups) {
    expect(world.boards[group.interiorId].size).toBe(3)
  }
})

test('player-start position is derived correctly for every active slot and never collides with group geometry', () => {
  for (let slot = 0; slot < 4; slot++) {
    const rng = sequenceRng([
      0.1, slot / 4 + 0.01, // groupCount=4, playerSlot=slot
      0.5, 0.0, 0.5, 0.5, // group0: isMultiBox=false, wallDir=up, interiorSize/hasObstacle fillers
      0.5, 0.26, 0.5, 0.5, // group1: wallDir=down
      0.5, 0.51, 0.5, 0.5, // group2: wallDir=left
      0.5, 0.76, 0.5, 0.5, // group3: wallDir=right
    ])
    const { world, groups } = createSeedWorld(rng, singleBoxProfile())
    const expected = slotCenter(slot)
    expect(world.locations.player).toEqual({ board: 'root', x: expected.x - 1, y: expected.y - 1 })

    const root = world.boards.root
    for (const group of groups) {
      expect(root.cells[world.locations.player.y][world.locations.player.x].type).toBe('floor')
      expect(`${world.locations.player.x},${world.locations.player.y}`)
        .not.toBe(`${group.originalPosition.x},${group.originalPosition.y}`)
    }
  }
})

test('a remote player start (inactive slot) lands on plain floor and never collides with any group', () => {
  const remoteProfile: SeedProfile = {
    fourGroupProbability: 0, largeInteriorProbability: 0.5, remoteStartProbability: 1, multiBoxProbability: 0, fillerBoxCount: 0, obstacleBoxProbability: 0,
  }
  const rng = sequenceRng([
    0.9, // groupCount=3
    0.0, 0.0, // playerSlot: remote-start check (true), inactive-slot pick -> slot 3
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
  ])
  const { world, groups } = createSeedWorld(rng, remoteProfile)
  expect(groups.length).toBe(3)
  const expected = slotCenter(3)
  expect(world.locations.player).toEqual({ board: 'root', x: expected.x - 1, y: expected.y - 1 })
  expect(world.boards.root.cells[world.locations.player.y][world.locations.player.x].type).toBe('floor')
})

test('a two-box group has two distinct walls and two distinct requirement cells on its interior', () => {
  const multiBoxProfile: SeedProfile = {
    fourGroupProbability: 0, largeInteriorProbability: 0.5, remoteStartProbability: 0, multiBoxProbability: 1, fillerBoxCount: 0, obstacleBoxProbability: 0,
  }
  const rng = sequenceRng([
    0.9, // groupCount=3 (fourGroupProbability=0, draw irrelevant)
    0.9, 0.1, // playerSlot: remote-check false (remoteStartProbability=0), pick
    // group0: isMultiBox=true (multiBoxProbability=1, draw irrelevant),
    // wallDir first=0(up), offset draw -> offset=1 -> second=1(down),
    // interiorSize filler, hasObstacle filler (obstacleBoxProbability=0)
    0.5, 0.0, 0.1, 0.9, 0.5,
    // group1, group2: same shape, values irrelevant to this test
    0.5, 0.0, 0.1, 0.9, 0.5,
    0.5, 0.0, 0.1, 0.9, 0.5,
  ])
  const { world, groups } = createSeedWorld(rng, multiBoxProfile)

  const group0 = groups[0]
  expect(group0.boxes.length).toBe(2)

  const root = world.boards.root
  const wallDeltas = wallDeltasAround(group0.originalPosition.x, group0.originalPosition.y, root.cells)
  expect(wallDeltas.length).toBe(2)
  const wallDirs = wallDeltas.map(([dx, dy]) => directionFromDelta[`${dx},${dy}`])
  expect(new Set(wallDirs)).toEqual(new Set<Direction>(['up', 'down']))

  const interior = world.boards[group0.interiorId]
  const entryCells = wallDirs.map((dir) => getEntryCell(interior, opposite(dir), HALF).cell!)
  expect(entryCells[0]).not.toEqual(entryCells[1])
  for (const cell of entryCells) {
    expect(interior.cells[cell.y][cell.x].requirement).toBe('box')
  }

  // Every box sits at one of the two entry cells, and box ids are unique.
  const boxIds = new Set(group0.boxes.map((box) => box.boxId))
  expect(boxIds.size).toBe(2)
  for (const box of group0.boxes) {
    const loc = world.locations[box.boxId]
    expect(loc.board).toBe(group0.interiorId)
    const matchesSomeEntry = entryCells.some((c) => c.x === loc.x && c.y === loc.y)
    expect(matchesSomeEntry).toBe(true)
  }
})

test('box ids are globally unique across all groups, single- and multi-box mixed', () => {
  const { world: _world, groups } = createSeedWorld(ALL_COMBOS_RNG(), ALL_COMBOS_PROFILE)
  void _world
  const allIds = groups.flatMap((g) => g.boxes.map((b) => b.boxId))
  expect(new Set(allIds).size).toBe(allIds.length)
})

test('assertValidSeedGroup accepts 1 or 2 boxes and rejects 0, 3+, or duplicate ids', () => {
  const base = { containerId: 'goal0', interiorId: 'goal0Inside', originalPosition: { x: 3, y: 3 } }
  expect(() => assertValidSeedGroup({ ...base, boxes: [{ boxId: 'box0', originalPosition: { x: 0, y: 0 } }] }))
    .not.toThrow()
  expect(() => assertValidSeedGroup({
    ...base,
    boxes: [{ boxId: 'box0_0', originalPosition: { x: 0, y: 0 } }, { boxId: 'box0_1', originalPosition: { x: 1, y: 1 } }],
  })).not.toThrow()
  expect(() => assertValidSeedGroup({ ...base, boxes: [] })).toThrow(/Invalid box count/)
  expect(() => assertValidSeedGroup({
    ...base,
    boxes: [
      { boxId: 'box0_0', originalPosition: { x: 0, y: 0 } },
      { boxId: 'box0_1', originalPosition: { x: 1, y: 1 } },
      { boxId: 'box0_2', originalPosition: { x: 2, y: 2 } },
    ],
  })).toThrow(/Invalid box count/)
  expect(() => assertValidSeedGroup({
    ...base,
    boxes: [
      { boxId: 'box0_0', originalPosition: { x: 0, y: 0 } },
      { boxId: 'box0_0', originalPosition: { x: 1, y: 1 } },
    ],
  })).toThrow(/Duplicate box id/)
})

test('pickWallDirs(rng, 1) consumes exactly one rng() call and returns the direction at that index', () => {
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const rng = sequenceRng([i / DIRECTIONS.length + 0.01])
    expect(pickWallDirs(rng, 1)).toEqual([DIRECTIONS[i]])
  }
})

test('pickWallDirs(rng, 2) is exhaustively distinct and consumes exactly two rng() calls for every first/offset combination', () => {
  for (let firstIdx = 0; firstIdx < DIRECTIONS.length; firstIdx++) {
    for (let offsetIdx = 0; offsetIdx < DIRECTIONS.length - 1; offsetIdx++) {
      const rng = sequenceRng([firstIdx / DIRECTIONS.length + 0.01, offsetIdx / (DIRECTIONS.length - 1) + 0.01])
      const [first, second] = pickWallDirs(rng, 2)
      expect(first).toBe(DIRECTIONS[firstIdx])
      expect(second).not.toBe(first)
      expect(DIRECTIONS).toContain(second)
    }
  }
})

test('createSeedWorld places exactly fillerBoxCount plain boxes, each on a distinct safe corner', () => {
  const profile = singleBoxProfile({ fillerBoxCount: 3 })
  const { world, fillerBoxIds } = createSeedWorld(ALL_COMBOS_RNG(), profile)

  expect(fillerBoxIds).toEqual(['filler0', 'filler1', 'filler2'])
  const positions = new Set<string>()
  for (const id of fillerBoxIds) {
    expect(world.pieces[id]).toEqual({ id, kind: 'normal' })
    const loc = world.locations[id]
    expect(loc.board).toBe('root')
    expect(world.boards.root.cells[loc.y][loc.x].type).toBe('floor')
    expect(world.boards.root.cells[loc.y][loc.x].requirement).toBeUndefined()
    positions.add(`${loc.x},${loc.y}`)
  }
  expect(positions.size).toBe(3)
})

test('filler box positions never collide with any group container/wall cell or the player start', () => {
  const profile = singleBoxProfile({ fillerBoxCount: 3 })
  const { world, groups, fillerBoxIds } = createSeedWorld(ALL_COMBOS_RNG(), profile)

  const occupied = new Set<string>([`${world.locations.player.x},${world.locations.player.y}`])
  for (const group of groups) {
    occupied.add(`${group.originalPosition.x},${group.originalPosition.y}`)
    for (const [dx, dy] of wallDeltasAround(group.originalPosition.x, group.originalPosition.y, world.boards.root.cells)) {
      occupied.add(`${group.originalPosition.x + dx},${group.originalPosition.y + dy}`)
    }
  }
  for (const id of fillerBoxIds) {
    const loc = world.locations[id]
    expect(occupied.has(`${loc.x},${loc.y}`)).toBe(false)
  }
})

test('fillerBoxCount 0 places no filler boxes', () => {
  const profile = singleBoxProfile({ fillerBoxCount: 0 })
  const { fillerBoxIds } = createSeedWorld(ALL_COMBOS_RNG(), profile)
  expect(fillerBoxIds).toEqual([])
})

test('an obstacle box sits exactly on the approach cell (opposite the wall direction), blocking it', () => {
  const profile = singleBoxProfile({ obstacleBoxProbability: 1 })
  const { world, groups, fillerBoxIds } = createSeedWorld(ALL_COMBOS_RNG(), profile)

  for (const group of groups) {
    const wallDeltas = wallDeltasAround(group.originalPosition.x, group.originalPosition.y, world.boards.root.cells)
    expect(wallDeltas.length).toBe(1)
    const [dx, dy] = wallDeltas[0]
    // The approach cell is the opposite side from the wall.
    const approachX = group.originalPosition.x - dx
    const approachY = group.originalPosition.y - dy

    const obstacleId = `obstacle${groups.indexOf(group)}`
    expect(fillerBoxIds).toContain(obstacleId)
    expect(world.locations[obstacleId]).toEqual({ board: 'root', x: approachX, y: approachY })
    expect(world.pieces[obstacleId]).toEqual({ id: obstacleId, kind: 'normal' })
  }
})

test('obstacleBoxProbability 0 places no obstacle boxes', () => {
  const profile = singleBoxProfile({ obstacleBoxProbability: 0 })
  const { fillerBoxIds } = createSeedWorld(ALL_COMBOS_RNG(), profile)
  expect(fillerBoxIds.filter((id) => id.startsWith('obstacle'))).toEqual([])
})

test('obstacle boxes never collide with the player-candidate cell or corner fillers', () => {
  const profile = singleBoxProfile({ obstacleBoxProbability: 1, fillerBoxCount: 4 })
  const { world, fillerBoxIds } = createSeedWorld(ALL_COMBOS_RNG(), profile)
  const positions = fillerBoxIds.map((id) => `${world.locations[id].x},${world.locations[id].y}`)
  expect(new Set(positions).size).toBe(positions.length) // all distinct
  expect(positions).not.toContain(`${world.locations.player.x},${world.locations.player.y}`)
})

test('the default GENERATOR_CONFIG.seedProfile is the implicit default', () => {
  // Generous filler: worst case is groupCount=4 (1 call) + playerSlot
  // (1 call) + 4 groups all multi-box (4 calls each) = 18 calls. Extra
  // unused values are harmless since both calls consume the same prefix.
  const values = [0.4, ...Array(30).fill(0.5)]
  const withDefaultProfile = createSeedWorld(sequenceRng(values))
  const withExplicitProfile = createSeedWorld(sequenceRng(values), GENERATOR_CONFIG.seedProfile)
  expect(withDefaultProfile.groups.length).toBe(withExplicitProfile.groups.length)
})
