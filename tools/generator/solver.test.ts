import { World } from '../../src/game/engine/types'
import { BUILTIN_LEVELS } from '../../src/levels'
import { countCrossingMoves, solve } from './solver'

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
  expect(solve(world)).toEqual([])
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
  expect(solve(world)).toEqual(['right'])
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

test('solve finds the shortest path even when longer alternate routes exist', () => {
  const size = 5
  const cells = makeSquareCells(size, () => ({ type: 'floor' }))
  cells[2][4] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 2, y: 2 }, box1: { board: 'root', x: 3, y: 2 } },
  }
  expect(solve(world)).toEqual(['right'])
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

test('every builtin level is solvable', () => {
  for (const level of BUILTIN_LEVELS) {
    const solution = solve(level.world, 100)
    expect(solution, `level ${level.id} should be solvable`).not.toBeNull()
  }
})
