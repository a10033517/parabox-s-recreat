import { createEmptyGrid } from '../../src/game/engine/types'
import { BUILTIN_LEVELS } from '../../src/levels'
import { countNestingEvents, solve } from './solver'

test('solve finds the shortest path for a trivial one-step level', () => {
  const grid = createEmptyGrid(3, 1)
  grid.player = { x: 0, y: 0 }
  grid.cells[0][2] = 'target'
  grid.boxes.push({ id: 'g1', x: 1, y: 0, boxType: 'normal', interior: createEmptyGrid(1, 1), isGoalBox: true })
  const solution = solve(grid)
  expect(solution).toEqual(['right'])
})

test('solve returns null for an already-impossible level within maxDepth', () => {
  const grid = createEmptyGrid(3, 1)
  grid.player = { x: 0, y: 0 }
  grid.cells[0][2] = 'target'
  grid.boxes.push({ id: 'g1', x: 1, y: 0, boxType: 'normal', interior: createEmptyGrid(1, 1), isGoalBox: true })
  grid.cells[0][1] = 'wall'
  const solution = solve(grid, 5)
  expect(solution).toBeNull()
})

test('every builtin level is solvable', () => {
  for (const level of BUILTIN_LEVELS) {
    const solution = solve(level.grid, 100)
    expect(solution, `level ${level.id} should be solvable`).not.toBeNull()
  }
})

test('countNestingEvents counts how many moves in the path trigger a nest', () => {
  const grid = createEmptyGrid(5, 3)
  grid.player = { x: 0, y: 1 }
  grid.cells[1][3] = 'wall'
  grid.boxes.push({ id: 'n1', x: 1, y: 1, boxType: 'normal', interior: createEmptyGrid(1, 1) })
  grid.boxes.push({ id: 'c1', x: 2, y: 1, boxType: 'container', interior: createEmptyGrid(3, 3) })
  expect(countNestingEvents(grid, ['right'])).toBe(1)
})
