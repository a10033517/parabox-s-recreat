import { Direction, opposite } from '../../src/game/engine/types'
import { getEntryCell, checkWin } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedWorld } from './seed'
import { GENERATOR_CONFIG, SeedProfile } from './generatorConfig'

function sequenceRng(values: number[]): () => number {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('sequenceRng exhausted')
    return values[i++]
  }
}

// Local mirror of seed.ts's own slot-geometry helpers, used only to compute
// *expected* positions independently of the implementation under test.
const GRID_COLS = 2
const SLOT_SIZE = 5
function slotCenter(index: number): { x: number; y: number } {
  const row = Math.floor(index / GRID_COLS)
  const col = index % GRID_COLS
  return { x: 1 + col * SLOT_SIZE + 2, y: 1 + row * SLOT_SIZE + 2 }
}

// This one sequence is reused across most tests below. Call order per
// createSeedWorld: groupCount draw, playerSlot draw(s), then per group
// (wallDir, interiorSize). groupCount>=4 skips the remote-start check (one
// rng call) that a groupCount<4 draw would otherwise consume.
// 0.1 < 0.5 -> groupCount=4; 0.0 -> playerSlot=0; then per-group wallDir
// covering up/down/left/right and interiorSize covering both 5 and 3.
const ALL_COMBOS_RNG = () => sequenceRng([0.1, 0.0, 0.0, 0.0, 0.26, 0.9, 0.51, 0.9, 0.76, 0.9])

test('createSeedWorld produces 3 groups when the four-group draw fails', () => {
  // 0.9 >= 0.5 -> groupCount=3. playerSlot (groupCount<4) consumes a
  // remote-start check (0.9 >= remoteStartProbability=0, so it falls
  // through) then the active-slot pick. Remaining group draws are filler.
  const rng = sequenceRng([0.9, 0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
  const { groups } = createSeedWorld(rng)
  expect(groups.length).toBe(3)
})

test('createSeedWorld produces 4 groups covering all 4 wall directions and both interior sizes', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG())
  expect(groups.length).toBe(4)

  const root = world.boards.root
  const directionFromDelta: Record<string, Direction> = {
    '-1,0': 'left', '1,0': 'right', '0,-1': 'up', '0,1': 'down',
  }
  const seenDirections = new Set<Direction>()
  const seenSizes = new Set<number>()

  for (const group of groups) {
    const { x, y } = group.originalPosition
    const deltas: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    const wallDeltas = deltas.filter(([dx, dy]) => root.cells[y + dy][x + dx].type === 'wall')
    expect(wallDeltas.length).toBe(1)
    const [dx, dy] = wallDeltas[0]
    const wallDir = directionFromDelta[`${dx},${dy}`]
    seenDirections.add(wallDir)

    const interior = world.boards[group.interiorId]
    seenSizes.add(interior.size)
    const { cell: expectedEntry } = getEntryCell(interior, opposite(wallDir), HALF)
    expect(expectedEntry).not.toBeNull()
    expect(world.locations[group.boxId]).toEqual({
      board: group.interiorId,
      x: expectedEntry!.x,
      y: expectedEntry!.y,
    })
    expect(group.boxOriginalPosition).toEqual({ x: expectedEntry!.x, y: expectedEntry!.y })
  }

  expect(seenDirections.size).toBe(4)
  expect(seenSizes).toEqual(new Set([3, 5]))
})

test('the seed world is already solved for every requirement cell', () => {
  const { world } = createSeedWorld(ALL_COMBOS_RNG())
  expect(checkWin(world)).toBe(true)
})

test('the seed world is internally consistent', () => {
  const { world } = createSeedWorld(ALL_COMBOS_RNG())
  expect(() => parseLevel(serializeLevel(world))).not.toThrow()
})

test('a group container sits at its originalPosition with no requirement there; the requirement lives on the box inside', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG())
  for (const group of groups) {
    expect(world.locations[group.containerId]).toEqual({
      board: 'root',
      x: group.originalPosition.x,
      y: group.originalPosition.y,
    })
    const containerCell = world.boards.root.cells[group.originalPosition.y][group.originalPosition.x]
    expect(containerCell.requirement).toBeUndefined()

    const interior = world.boards[group.interiorId]
    const boxCell = interior.cells[group.boxOriginalPosition.y][group.boxOriginalPosition.x]
    expect(boxCell.requirement).toBe('box')
  }
})

test('no two groups (or the player) occupy overlapping coordinates on root', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG())
  const root = world.boards.root
  const rootCoords: string[] = [`${world.locations.player.x},${world.locations.player.y}`]
  for (const group of groups) {
    rootCoords.push(`${group.originalPosition.x},${group.originalPosition.y}`)
    const { x, y } = group.originalPosition
    const deltas: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    const [dx, dy] = deltas.find(([ddx, ddy]) => root.cells[y + ddy][x + ddx].type === 'wall')!
    rootCoords.push(`${x + dx},${y + dy}`)
  }
  expect(new Set(rootCoords).size).toBe(rootCoords.length)
})

test('createSeedWorld respects a passed SeedProfile forcing the 4-group / large-interior branch', () => {
  // fourGroupProbability=1 and largeInteriorProbability=1 mean any rng
  // value in [0,1) takes the "true" branch every time.
  const forcedProfile: SeedProfile = { fourGroupProbability: 1, largeInteriorProbability: 1, remoteStartProbability: 0 }
  const { world, groups } = createSeedWorld(() => 0.99, forcedProfile)
  expect(groups.length).toBe(4)
  for (const group of groups) {
    expect(world.boards[group.interiorId].size).toBe(5)
  }
})

test('createSeedWorld respects a passed SeedProfile forcing the 3-group / small-interior branch', () => {
  const forcedProfile: SeedProfile = { fourGroupProbability: 0, largeInteriorProbability: 0, remoteStartProbability: 0 }
  const { world, groups } = createSeedWorld(() => 0.01, forcedProfile)
  expect(groups.length).toBe(3)
  for (const group of groups) {
    expect(world.boards[group.interiorId].size).toBe(3)
  }
})

test('the default GENERATOR_CONFIG.seedProfile is the implicit default', () => {
  const values = [0.4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
  const withDefaultProfile = createSeedWorld(sequenceRng(values))
  const withExplicitProfile = createSeedWorld(sequenceRng(values), GENERATOR_CONFIG.seedProfile)
  expect(withDefaultProfile.groups.length).toBe(withExplicitProfile.groups.length)
})

test('player-start position is derived correctly for every active slot and never collides with group geometry', () => {
  // groupCount=4 forces playerSlot in [0,4) via a single rng draw; sweep all
  // 4 possible slot picks.
  for (let slot = 0; slot < 4; slot++) {
    const rng = sequenceRng([0.1, slot / 4 + 0.01, 0.0, 0.5, 0.26, 0.5, 0.51, 0.5, 0.76, 0.5])
    const { world, groups } = createSeedWorld(rng)
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
  // groupCount=3 (rng>=0.5), remote-start forced by rng < remoteStartProbability.
  const remoteProfile: SeedProfile = { fourGroupProbability: 0, largeInteriorProbability: 0.5, remoteStartProbability: 1 }
  const rng = sequenceRng([0.9, 0.0, 0.0, 0.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
  const { world, groups } = createSeedWorld(rng, remoteProfile)
  expect(groups.length).toBe(3)
  // Remote start must land in slot 3 (the only inactive slot when groupCount=3).
  const expected = slotCenter(3)
  expect(world.locations.player).toEqual({ board: 'root', x: expected.x - 1, y: expected.y - 1 })
  expect(world.boards.root.cells[world.locations.player.y][world.locations.player.x].type).toBe('floor')
})
