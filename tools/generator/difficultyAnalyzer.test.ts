import { Cell, PLAYER_ID, World, opposite } from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { SolveResult, solve } from './solver'
import { analyze } from './difficultyAnalyzer'

function makeSquareCells(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, (): Cell => ({ type: 'floor' })))
}

function trivialWorld(): World {
  return {
    boards: { root: { id: 'root', size: 3, cells: [
      [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
      [{ type: 'floor' }, { type: 'floor' }, { type: 'floor', requirement: 'box' }],
      [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
    ] } },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 1, y: 1 } },
  }
}

function mockSolved(overrides: Partial<SolveResult> = {}): SolveResult {
  return { moves: ['right'], expandedStates: 1, maxFrontierSize: 1, visitedStates: 2, branchingFactors: [3], ...overrides }
}

test('avgBranching and maxBranching summarize solved.branchingFactors', () => {
  const vector = analyze(trivialWorld(), mockSolved({ branchingFactors: [2, 4, 3] }), 5000)
  expect(vector.avgBranching).toBeCloseTo(3, 5)
  expect(vector.maxBranching).toBe(4)
})

test('deadEndRatio is the fraction of expanded states with branching factor 0', () => {
  const vector = analyze(trivialWorld(), mockSolved({ branchingFactors: [2, 0, 3, 0], expandedStates: 4 }), 5000)
  expect(vector.deadEndRatio).toBeCloseTo(0.5, 5)
})

test('avgBranching and deadEndRatio are 0 for an already-solved (0-move) result', () => {
  const vector = analyze(trivialWorld(), mockSolved({ moves: [], expandedStates: 0, branchingFactors: [] }), 5000)
  expect(vector.avgBranching).toBe(0)
  expect(vector.deadEndRatio).toBe(0)
})

test('criticalDecisions counts the single fork in a 1-move puzzle with walkable-but-wrong alternatives', () => {
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x): Cell => ({
      type: x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 'wall' : 'floor',
    })),
  )
  cells[2][3] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 1, y: 2 }, box1: { board: 'root', x: 2, y: 2 } },
  }
  const solved = solve(world)!
  expect(solved.moves).toEqual(['right'])
  const vector = analyze(world, solved, 5000)
  expect(vector.criticalDecisions).toBe(1)
})

test('criticalDecisions is 0 when the single decision point has no legal alternative at all', () => {
  // Only (1,2)/(2,2)/(3,2) are floor — row y=1 and y=3 stay wall, so 'up'/
  // 'down' from the player's start are illegal, and (0,2) is the border
  // (wall). 'right' is the ONLY legal direction, so there is no
  // alternative to compare it against at all — distinct from the "single
  // fork" test above, where alternatives exist but all fail within budget.
  // (A corridor of 2+ moves can't reach 0 here: once the player has moved
  // at least one step, walking back the way they came is always legal,
  // which is itself an "alternative that fails within budget" — see the
  // single-fork test's own reasoning. 0 critical decisions is only
  // reachable at a single, fully-boxed-in decision point like this one.)
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'wall' as const })),
  )
  cells[2][1] = { type: 'floor' }
  cells[2][2] = { type: 'floor' }
  cells[2][3] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 1, y: 2 }, box1: { board: 'root', x: 2, y: 2 } },
  }
  const solved = solve(world)!
  expect(solved.moves).toEqual(['right'])
  const vector = analyze(world, solved, 5000)
  expect(vector.criticalDecisions).toBe(0)
})

test('nestedBoxRequired is true and maxContainerDepthUsed is 1 when the goal is only reachable inside a container', () => {
  const root = { id: 'root', size: 6, cells: makeSquareCells(6) }
  for (let i = 0; i < 6; i++) {
    root.cells[0][i] = { type: 'wall' }; root.cells[5][i] = { type: 'wall' }
    root.cells[i][0] = { type: 'wall' }; root.cells[i][5] = { type: 'wall' }
  }
  root.cells[2][4] = { type: 'wall' }
  const inside = { id: 'inside', size: 3, cells: makeSquareCells(3) }
  const { cell: entry } = getEntryCell(inside, opposite('right'), HALF)
  inside.cells[entry!.y][entry!.x] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root, inside },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      [PLAYER_ID]: { board: 'root', x: 1, y: 2 },
      container1: { board: 'root', x: 2, y: 2 },
      box1: { board: 'root', x: 3, y: 2 },
    },
  }
  const solved = solve(world)!
  const vector = analyze(world, solved, 5000)
  expect(vector.nestedBoxRequired).toBe(true)
  expect(vector.nestedBoxUsed).toBe(true)
  expect(vector.maxContainerDepthUsed).toBe(1)
})

test('nestedBoxRequired is false when the container is never needed for the solution', () => {
  const size = 6
  const cells = makeSquareCells(size)
  for (let i = 0; i < size; i++) {
    cells[0][i] = { type: 'wall' }; cells[size - 1][i] = { type: 'wall' }
    cells[i][0] = { type: 'wall' }; cells[i][size - 1] = { type: 'wall' }
  }
  cells[3][3] = { type: 'floor', requirement: 'box' }
  const inside = { id: 'inside', size: 3, cells: makeSquareCells(3) }
  const world: World = {
    boards: { root: { id: 'root', size, cells }, inside },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      box1: { id: 'box1', kind: 'normal' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
    },
    locations: {
      [PLAYER_ID]: { board: 'root', x: 1, y: 3 },
      box1: { board: 'root', x: 2, y: 3 },
      container1: { board: 'root', x: 4, y: 4 },
    },
  }
  const solved = solve(world)!
  expect(solved.moves).toEqual(['right'])
  const vector = analyze(world, solved, 5000)
  expect(vector.nestedBoxRequired).toBe(false)
  expect(vector.nestedBoxUsed).toBe(false)
})
