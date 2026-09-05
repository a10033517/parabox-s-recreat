import { Direction, opposite } from '../../src/game/engine/types'
import { getEntryCell, checkWin } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedWorld } from './seed'

function sequenceRng(values: number[]): () => number {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('sequenceRng exhausted')
    return values[i++]
  }
}

// This one sequence is reused across most tests below: it drives
// groupCount to 4, and picks a different wall direction and a different
// interior size for each of the 4 groups (up/3, down/5, left/3, right/5),
// so a single deterministic seed construction exercises every direction
// and both sizes at once.
const ALL_COMBOS_RNG = () => sequenceRng([0.6, 0.0, 0.0, 0.26, 0.6, 0.51, 0.0, 0.76, 0.6])

test('createSeedWorld produces 3 groups when the group-count draw is low', () => {
  const rng = sequenceRng([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
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

test('every group container sits at its originalPosition with a box requirement cell there', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG())
  for (const group of groups) {
    expect(world.locations[group.containerId]).toEqual({
      board: 'root',
      x: group.originalPosition.x,
      y: group.originalPosition.y,
    })
    const cell = world.boards.root.cells[group.originalPosition.y][group.originalPosition.x]
    expect(cell.requirement).toBe('box')
  }
})

test('no two groups (or the player) occupy overlapping coordinates on root', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG())
  const rootCoords: string[] = [`${world.locations.player.x},${world.locations.player.y}`]
  for (const group of groups) {
    rootCoords.push(`${group.originalPosition.x},${group.originalPosition.y}`)
  }
  expect(new Set(rootCoords).size).toBe(rootCoords.length)
})
