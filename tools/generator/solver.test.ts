import { Cell, World } from '../../src/game/engine/types'
import { BUILTIN_LEVELS } from '../../src/levels'
import { countBoxLines, countCrossingMoves, countEatMoves, countPushMoves, solve } from './solver'

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

test('branchingFactors has exactly one entry per expanded state, in expansion order', () => {
  // 1-wide horizontal corridor (row y=2, columns x=1..4), box needs exactly
  // 2 rightward pushes to reach the goal at (4,2).
  const size = 6
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x): Cell => ({
      type: y === 2 && x >= 1 && x <= 4 ? 'floor' : 'wall',
    })),
  )
  cells[2][4] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 1, y: 2 }, box1: { board: 'root', x: 2, y: 2 } },
  }
  const result = solve(world)!
  expect(result.moves).toEqual(['right', 'right'])
  expect(result.branchingFactors).toHaveLength(result.expandedStates)
  // State 0 (player at x=1, box at x=2): 'left' hits the border wall, 'up'/
  // 'down' hit the corridor's own walls — only 'right' (push) is legal, so
  // branching is 1. State 1 (player at x=2, box at x=3, after the first
  // push): 'right' pushes the box onto the goal (the winning move), but
  // 'left' is ALSO legal (walking back to x=1, now empty) — branching
  // counts every legal direction regardless of whether BFS re-expands it,
  // so this state's branching is 2, not 1.
  expect(result.branchingFactors).toEqual([1, 2])
})

test('branchingFactors is empty for an already-won world (0 expanded states)', () => {
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
  const result = solve(world)!
  expect(result.branchingFactors).toEqual([])
})

test('branchingFactors counts all 4 directions independent of visited-state pruning', () => {
  // Open 5x5 room, box already one push from its goal — the start state
  // has up to 4 legal directions (bounded by the border), not fewer just
  // because some neighbors get visited/pruned later in the search.
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'floor' as const })),
  )
  cells[2][3] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 1, y: 2 }, box1: { board: 'root', x: 2, y: 2 } },
  }
  const result = solve(world)!
  // The very first expanded state (the initial world) has 4 legal moves:
  // up/down/left/right all land on in-bounds floor (row/col 1 and 3 are
  // clear of the border at size 5).
  expect(result.branchingFactors[0]).toBe(4)
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

test('countBoxLines counts one line for any run of same-box same-direction pushes', () => {
  const root = { id: 'root', size: 6, cells: makeSquareCells(6, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 2 }, box1: { board: 'root', x: 1, y: 2 } },
  }
  // Three consecutive rightward pushes of the same box: still one line.
  expect(countBoxLines(world, ['right', 'right', 'right'])).toBe(1)
})

test('countBoxLines counts a new line when the same box changes direction', () => {
  const root = { id: 'root', size: 6, cells: makeSquareCells(6, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 2, y: 3 }, box1: { board: 'root', x: 2, y: 2 } },
  }
  // Push box1 up twice (one line: box1 ends at (2,0), player at (2,1)),
  // walk around to its left side, then push it right once (a second line —
  // new direction for the same box).
  const moves = ['up', 'up', 'left', 'up', 'right'] as const
  expect(countBoxLines(world, [...moves])).toBe(2)
})

test('countBoxLines counts pushing two different boxes as two lines even in the same direction', () => {
  const root = { id: 'root', size: 7, cells: makeSquareCells(7, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root },
    pieces: {
      player: { id: 'player', kind: 'player' },
      box1: { id: 'box1', kind: 'normal' },
      box2: { id: 'box2', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 0, y: 1 },
      box1: { board: 'root', x: 1, y: 1 },
      box2: { board: 'root', x: 1, y: 3 },
    },
  }
  // Push box1 right once, walk around to box2's left side, push box2 right
  // once — same direction, but a different box each time, so two separate
  // lines (box lines track direction-changes-per-box, not per-direction).
  const moves = ['right', 'left', 'down', 'down', 'right'] as const
  expect(countBoxLines(world, [...moves])).toBe(2)
})

test('countBoxLines is 0 for plain player movement with nothing pushed', () => {
  const root = { id: 'root', size: 5, cells: makeSquareCells(5, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 0, y: 2 } },
  }
  expect(countBoxLines(world, ['right', 'right'])).toBe(0)
})

test('countBoxLines counts the container advancing during an eat as its own line, same as any other push', () => {
  const eatWorld = makeEatWorld()
  // container1 advances one cell during the eat (see countPushMoves's own
  // eat test above) — that's a genuine push of the container, so it counts
  // as one line, same as any other pushed piece.
  expect(countBoxLines(eatWorld, ['right'])).toBe(1)
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

test('every builtin level is solvable', () => {
  for (const level of BUILTIN_LEVELS) {
    const result = solve(level.world, 100)
    expect(result, `level ${level.id} should be solvable`).not.toBeNull()
  }
})

import { solveDetailed } from './solver'

test('solveDetailed distinguishes EXPANSION_CAP and DEPTH_CAP from UNSOLVABLE', () => {
  const floor = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ({ type: 'floor' as const })))
  const cells = floor()
  cells[3][3] = { type: 'floor', requirement: 'player' } as never
  const open = { boards: { root: { id: 'root', size: 4, cells } }, pieces: { player: { id: 'player', kind: 'player' as const } }, locations: { player: { board: 'root', x: 0, y: 0 } } }
  expect(solveDetailed(open, 200).status).toBe('SOLVED')
  expect(solveDetailed(open, 200, 2).status).toBe('EXPANSION_CAP')
  expect(solveDetailed(open, 2).status).toBe('DEPTH_CAP')

  const walled: Cell[][] = floor()
  walled[3][3] = { type: 'floor', requirement: 'player' } as never
  walled[0][1] = { type: 'wall' }
  walled[1][0] = { type: 'wall' }
  const stuck = { ...open, boards: { root: { id: 'root', size: 4, cells: walled } } }
  expect(solveDetailed(stuck, 200).status).toBe('UNSOLVABLE')
})
