import { Cell, World } from '../../src/game/engine/types'
import { BUILTIN_LEVELS } from '../../src/levels'
import { countCrossingMoves, countEatMoves, countGroupsUsed, countPushMoves, solve } from './solver'
import { SeedGroup } from './seed'

function makeSquareCells(size: number, fill: () => { type: 'floor' | 'wall'; requirement?: 'box' | 'player' }) {
  return Array.from({ length: size }, () => Array.from({ length: size }, fill))
}

test('solve returns an empty path for an already-won world', () => {
  const world: World = {
    boards: {
      root: {
        id: 'root', size: 3,
        cells: [
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor', requirement: 'box' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
        ],
      },
    },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 2, y: 1 } },
  }
  const result = solve(world)
  expect(result).not.toBeNull()
  expect(result!.moves).toEqual([])
  expect(result!.expandedStates).toBe(0)
  expect(result!.visitedStates).toBe(1)
})

test('solve finds a single-move solution', () => {
  const world: World = {
    boards: {
      root: {
        id: 'root', size: 3,
        cells: [
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor', requirement: 'box' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
        ],
      },
    },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 1, y: 1 } },
  }
  const result = solve(world)
  expect(result).not.toBeNull()
  expect(result!.moves).toEqual(['right'])
  expect(result!.expandedStates).toBeGreaterThanOrEqual(0)
  expect(result!.maxFrontierSize).toBeGreaterThanOrEqual(1)
  expect(result!.visitedStates).toBeGreaterThanOrEqual(1)
})

test('solve returns null when no solution exists', () => {
  const size = 4
  const cells = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => {
      if (y !== 0) return { type: 'wall' as const }
      if (x === 2) return { type: 'wall' as const }
      if (x === 3) return { type: 'floor' as const, requirement: 'box' as const }
      return { type: 'floor' as const }
    }),
  )
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 0 }, box1: { board: 'root', x: 1, y: 0 } },
  }
  expect(solve(world, 5)).toBeNull()
})

test('solve finds the shortest path even when a longer alternate route also exists', () => {
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'floor' as const })),
  )
  cells[2][4] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 1, y: 2 }, box1: { board: 'root', x: 3, y: 2 } },
  }
  // A direct 2-move solution exists (walk right, push right). A longer
  // alternate route also exists (go around via row 0 or row 4 and approach
  // from the other side), which takes strictly more moves. BFS must return
  // the short one.
  const result = solve(world)
  expect(result!.moves).toEqual(['right', 'right'])
})

test('countCrossingMoves returns 0 for a plain push with no board change', () => {
  const root = { id: 'root', size: 3, cells: makeSquareCells(3, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 1, y: 1 } },
  }
  expect(countCrossingMoves(world, ['right'])).toBe(0)
})

test('countCrossingMoves counts a move where a piece changes board', () => {
  const root = { id: 'root', size: 5, cells: makeSquareCells(5, () => ({ type: 'floor' as const })) }
  root.cells[2][3] = { type: 'wall' }
  const inside = { id: 'inside', size: 3, cells: makeSquareCells(3, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root, inside },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 2 },
      container1: { board: 'root', x: 2, y: 2 },
    },
  }
  expect(countCrossingMoves(world, ['right'])).toBe(1)
})

function makeEatWorld(): World {
  // player -> container -> box -> wall, four cells in a row. Pushing right
  // forces the box to be eaten into the container's interior (see the full
  // design spec's section 2 hand-trace).
  const root = { id: 'root', size: 6, cells: makeSquareCells(6, () => ({ type: 'floor' as const })) }
  root.cells[2][4] = { type: 'wall' }
  const inside = { id: 'inside', size: 3, cells: makeSquareCells(3, () => ({ type: 'floor' as const })) }
  return {
    boards: { root, inside },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 2 },
      container1: { board: 'root', x: 2, y: 2 },
      box1: { board: 'root', x: 3, y: 2 },
    },
  }
}

test('countPushMoves counts a same-board box push and ignores plain player-only movement', () => {
  const root = { id: 'root', size: 5, cells: makeSquareCells(5, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 2 }, box1: { board: 'root', x: 1, y: 2 } },
  }
  // 'right' pushes box1 one cell — a genuine same-board push.
  expect(countPushMoves(world, ['right'])).toBe(1)

  const emptyWorld: World = {
    boards: { root },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 0, y: 2 } },
  }
  // Plain player movement with nothing to push counts as 0.
  expect(countPushMoves(emptyWorld, ['right'])).toBe(0)
})

test('countPushMoves counts the container advancing during an eat, separately from the box crossing', () => {
  const root = { id: 'root', size: 6, cells: makeSquareCells(6, () => ({ type: 'floor' as const })) }
  root.cells[2][4] = { type: 'wall' }
  const inside = { id: 'inside', size: 3, cells: makeSquareCells(3, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root, inside },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 2 },
      container1: { board: 'root', x: 2, y: 2 },
      box1: { board: 'root', x: 3, y: 2 },
    },
  }
  // Same eat scenario as the countEatMoves test below (§2's hand-trace):
  // container1 advances from (2,2) to (3,2) on the SAME board — a genuine
  // push — while box1 separately crosses onto 'inside' (counted by
  // countEatMoves/countCrossingMoves, not this function). Both are true at
  // once for this one move, since they're different pieces.
  expect(countPushMoves(world, ['right'])).toBe(1)
})

test('countEatMoves counts a real eat interaction and 0 for a push-only solution', () => {
  const eatWorld = makeEatWorld()
  expect(countEatMoves(eatWorld, ['right'])).toBe(1)

  const pushOnly: World = {
    boards: { root: { id: 'root', size: 3, cells: makeSquareCells(3, () => ({ type: 'floor' as const })) } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 1, y: 1 } },
  }
  expect(countEatMoves(pushOnly, ['right'])).toBe(0)
})

test('countGroupsUsed counts a group whose container or box moved, and does not throw on a group missing from the world', () => {
  const eatWorld = makeEatWorld()
  const realGroup: SeedGroup = {
    containerId: 'container1', boxId: 'box1', interiorId: 'inside',
    originalPosition: { x: 2, y: 2 }, boxOriginalPosition: { x: 1, y: 1 },
  }
  const missingGroup: SeedGroup = {
    containerId: 'ghost', boxId: 'ghostBox', interiorId: 'ghostInside',
    originalPosition: { x: 0, y: 0 }, boxOriginalPosition: { x: 0, y: 0 },
  }

  // Filtered to survivors only — the intended usage.
  expect(countGroupsUsed(eatWorld, ['right'], [realGroup])).toBe(1)

  // Unfiltered, including a group whose pieces don't exist in this world —
  // the defensive-guard regression test for the crash the review caught.
  expect(() => countGroupsUsed(eatWorld, ['right'], [realGroup, missingGroup])).not.toThrow()
  expect(countGroupsUsed(eatWorld, ['right'], [realGroup, missingGroup])).toBe(1)
})

test('every builtin level is solvable', () => {
  for (const level of BUILTIN_LEVELS) {
    const result = solve(level.world, 100)
    expect(result, `level ${level.id} should be solvable`).not.toBeNull()
  }
})
