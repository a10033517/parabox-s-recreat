import { findContainerFor, inBounds } from '../../src/game/engine/types'
import { RandomGeneratorConfig, randomGenerate } from './randomGenerator'

function baseConfig(overrides: Partial<RandomGeneratorConfig> = {}): RandomGeneratorConfig {
  return {
    widthRange: [8, 8],
    heightRange: [8, 8],
    wallDensityRange: [0, 0],
    boxCountRange: [3, 3],
    containerProbability: 0,
    crossBoardGoalProbability: 0,
    interiorSizeRange: [3, 3],
    maxNestingDepth: 2,
    ...overrides,
  }
}

test('board size uses max(width, height), each drawn independently from its own range', () => {
  const config = baseConfig({ widthRange: [4, 4], heightRange: [7, 7], boxCountRange: [0, 0] })
  const result = randomGenerate(config, () => 0)
  expect(result).not.toBeNull()
  expect(result!.world.boards.root.size).toBe(7)
})

test('returns null when wallDensity 1 leaves no floor cells at all', () => {
  const config = baseConfig({ wallDensityRange: [1, 1], boxCountRange: [0, 0], containerProbability: 0 })
  expect(randomGenerate(config, Math.random)).toBeNull()
})

test('containerProbability 0 never creates a container piece', () => {
  const config = baseConfig({ containerProbability: 0 })
  const result = randomGenerate(config, Math.random)
  expect(result).not.toBeNull()
  const containers = Object.values(result!.world.pieces).filter((p) => p.kind === 'container')
  expect(containers).toHaveLength(0)
  expect(Object.keys(result!.world.boards)).toEqual(['root'])
})

test('crossBoardGoalProbability 0 places every goal on some box\'s own home board', () => {
  const config = baseConfig({ containerProbability: 0.5, crossBoardGoalProbability: 0, interiorSizeRange: [4, 4] })
  const result = randomGenerate(config, Math.random)
  expect(result).not.toBeNull()
  const { world } = result!
  const boxes = Object.values(world.pieces).filter((p) => p.kind === 'normal')
  const homeBoards = new Set(boxes.map((b) => world.locations[b.id].board))
  let totalGoals = 0
  let homeBoardGoals = 0
  for (const [boardId, board] of Object.entries(world.boards)) {
    const goalsHere = board.cells.flat().filter((c) => c.requirement === 'box').length
    totalGoals += goalsHere
    if (homeBoards.has(boardId)) homeBoardGoals += goalsHere
  }
  expect(totalGoals).toBe(homeBoardGoals)
})

test('every generated container is blocked on at least one side (enterable)', () => {
  // containerProbability 1 with boxCountRange [4,4] can legitimately try to
  // nest two containers into the same tiny (interiorSize 3 => 1 floor
  // cell) interior — randomGenerate correctly returns null in that case
  // (see its own unoccupiedFloorCells guard), same as any other generation
  // failure the real pipeline discards and retries. Retry here too, rather
  // than asserting the first Math.random() draw always succeeds.
  const config = baseConfig({ boxCountRange: [4, 4], containerProbability: 1, crossBoardGoalProbability: 0.5, interiorSizeRange: [3, 5] })
  let result: ReturnType<typeof randomGenerate> = null
  for (let attempt = 0; attempt < 50 && result === null; attempt++) {
    result = randomGenerate(config, Math.random)
  }
  expect(result).not.toBeNull()
  const { world } = result!
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container') continue
    const loc = world.locations[piece.id]
    const board = world.boards[loc.board]
    const neighbors: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]]
    const blocked = neighbors.some(([dx, dy]) => {
      const nx = loc.x + dx, ny = loc.y + dy
      return !inBounds(board, nx, ny) || board.cells[ny][nx].type === 'wall'
    })
    expect(blocked).toBe(true)
  }
})

test('maxNestingDepth caps how many levels of container nesting are created', () => {
  // interiorSize 4 (not 3): a 3x3 interior has only 1 floor cell, already
  // spent on the box itself, leaving no room for a same-board goal now
  // that goals must avoid every occupied cell (see unoccupiedFloorCells) —
  // and crossBoardGoalProbability's default can still route a goal to a
  // DIFFERENT tiny same-sized interior that's equally full, not
  // necessarily to spacious root. A 4x4 interior (4 floor cells) leaves
  // room either way.
  const config = baseConfig({ boxCountRange: [6, 6], containerProbability: 1, interiorSizeRange: [4, 4], maxNestingDepth: 1 })
  const result = randomGenerate(config, Math.random)
  expect(result).not.toBeNull()
  const { world } = result!
  function depthOf(boardId: string): number {
    let depth = 0
    let current = boardId
    while (current !== 'root') {
      const owner = findContainerFor(world, current)
      if (owner === undefined) break
      current = world.locations[owner].board
      depth++
    }
    return depth
  }
  for (const boardId of Object.keys(world.boards)) {
    expect(depthOf(boardId)).toBeLessThanOrEqual(config.maxNestingDepth)
  }
})

test('no box ever spawns already sitting on its own goal cell', () => {
  // Regression test: goal placement used to draw independently from the
  // box's own spawn cell, so a box could land on a floor cell that also
  // becomes its own goal — trivially satisfied from the start, never
  // needing to move at all. Caught by hand-verifying a shipped level
  // whose container turned out to be pure decoration for exactly this
  // reason (the box living inside it started already on its goal). Runs
  // across many seeds since this is a placement-order interaction, not a
  // single fixed geometry.
  const config = baseConfig({ containerProbability: 0.5, crossBoardGoalProbability: 0.3, boxCountRange: [1, 4], interiorSizeRange: [3, 5] })
  for (let i = 0; i < 100; i++) {
    const result = randomGenerate(config, Math.random)
    if (result === null) continue
    const { world } = result
    for (const piece of Object.values(world.pieces)) {
      if (piece.kind !== 'normal') continue
      const loc = world.locations[piece.id]
      const cell = world.boards[loc.board].cells[loc.y][loc.x]
      expect(cell.requirement).not.toBe('box')
    }
  }
})

test('the player piece exists on a floor cell of the root board', () => {
  const config = baseConfig()
  const result = randomGenerate(config, Math.random)
  expect(result).not.toBeNull()
  const { world } = result!
  const loc = world.locations.player
  expect(loc.board).toBe('root')
  expect(world.boards.root.cells[loc.y][loc.x].type).toBe('floor')
})
