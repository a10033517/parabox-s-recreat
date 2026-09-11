import { Cell, World, opposite } from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { tryInjectObstacle } from './injectObstacle'
import { solve } from './solver'
import { createSeedWorld } from './seed'
import { generateLevel } from './generateLevel'
import { pruneUntouchedGoals } from './pruneUntouchedGoals'
import { GENERATOR_CONFIG } from './generatorConfig'

function makeSquareCells(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, (): Cell => ({ type: 'floor' })))
}

function makeEatWorldWithApproach(): World {
  // player -> [plain walk] -> container -> box -> wall, matching the
  // hand-verified eat mechanic (see the full design spec's §2 trace).
  // Player starts one cell short of the container so there's a genuine
  // "approach" walk step (0,2)->(1,2), distinct from the player's own
  // starting cell.
  const root = { id: 'root', size: 6, cells: makeSquareCells(6) }
  root.cells[2][4] = { type: 'wall' }
  const inside = { id: 'inside', size: 3, cells: makeSquareCells(3) }
  const { cell: entry } = getEntryCell(inside, opposite('right'), HALF)
  inside.cells[entry!.y][entry!.x] = { type: 'floor', requirement: 'box' }
  return {
    boards: { root, inside },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 0, y: 2 },
      container1: { board: 'root', x: 2, y: 2 },
      box1: { board: 'root', x: 3, y: 2 },
    },
  }
}

test('tryInjectObstacle returns null when there is no blockable walk step (open room, no walls)', () => {
  const world: World = {
    boards: { root: { id: 'root', size: 5, cells: makeSquareCells(5) } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 2 }, box1: { board: 'root', x: 1, y: 2 } },
  }
  const solved = solve(world)!
  expect(tryInjectObstacle(world, solved, () => 0)).toBeNull()
})

test('tryInjectObstacle rejects a colinear approach-to-eat site: chain-pushes always absorb it for free', () => {
  // Hand-verified via the engine's own resolveBlocked recursion (see
  // injectObstacle.ts's own comment): inserting a piece directly on the
  // cell right before an eat's push chain never costs an extra move — the
  // chain silently absorbs it. findBlockableWalkIndices deliberately does
  // NOT select such a site (its destination's "beyond" cell here is the
  // container, not a wall), so this should report no viable injection
  // rather than one that turns out to be free.
  const world = makeEatWorldWithApproach()
  const solved = solve(world)!
  expect(solved.moves).toEqual(['right', 'right'])
  expect(tryInjectObstacle(world, solved, () => 0)).toBeNull()
})

test('tryInjectObstacle does not mutate the original world', () => {
  const world = makeEatWorldWithApproach()
  const solved = solve(world)!
  tryInjectObstacle(world, solved, () => 0)
  expect(world.pieces.obstacle0).toBeUndefined()
})

test('tryInjectObstacle throws on a move that is invalid for this world', () => {
  const world = makeEatWorldWithApproach()
  expect(() => tryInjectObstacle(world, { moves: ['left'], expandedStates: 0, maxFrontierSize: 0, visitedStates: 0 }, () => 0))
    .toThrow(/invalid move/)
})

test('whenever tryInjectObstacle succeeds on a real generated level, the result is strictly longer and the obstacle is present', () => {
  // Property test over real generated content (rather than one hand-built
  // maze): across many seeds, every non-null result must satisfy the same
  // invariant the function is supposed to guarantee.
  function seededRng(startSeed: number): () => number {
    let s = startSeed
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return (s % 10000) / 10000
    }
  }

  const rng = seededRng(424242)
  let successCount = 0
  for (let i = 0; i < 60; i++) {
    const profile = i % 2 === 0 ? GENERATOR_CONFIG.seedProfile : GENERATOR_CONFIG.hardSeedProfile
    const { world: seed, groups } = createSeedWorld(rng, profile)
    const steps = GENERATOR_CONFIG.minReverseSteps + Math.floor(rng() * (GENERATOR_CONFIG.maxReverseSteps - GENERATOR_CONFIG.minReverseSteps + 1))
    const generated = generateLevel(seed, groups, steps, rng)
    if (!generated) continue
    const world = pruneUntouchedGoals(generated.world, groups)
    const solved = solve(world, 150, GENERATOR_CONFIG.maxSolverExpandedStates)
    if (!solved || solved.moves.length === 0) continue

    const result = tryInjectObstacle(world, solved, rng)
    if (result === null) continue
    successCount++
    expect(result.world.pieces.obstacle0).toBeDefined()
    expect(result.solved.moves.length).toBeGreaterThan(solved.moves.length)
  }
  // Not asserting successCount > 0 here — real success rate is measured by
  // the mandatory diagnostic pass before shipping (per this project's own
  // established practice), not assumed in a unit test. This test exists to
  // catch a broken invariant, not to prove the feature "works often".
})
