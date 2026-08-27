import { createEmptyGrid, Box, Grid } from './types'
import { applyMove } from './rules'

function withPlayer(grid: Grid, x: number, y: number): Grid {
  grid.player = { x, y }
  return grid
}

function addBox(grid: Grid, id: string, x: number, y: number, boxType: 'normal' | 'container' = 'normal'): Box {
  const box: Box = { id, x, y, boxType, interior: createEmptyGrid(3, 3) }
  grid.boxes.push(box)
  return box
}

test('player moves into empty cell', () => {
  const grid = withPlayer(createEmptyGrid(3, 3), 1, 1)
  const next = applyMove(grid, 'right')
  expect(next?.player).toEqual({ x: 2, y: 1 })
})

test('player blocked by wall', () => {
  const grid = withPlayer(createEmptyGrid(3, 3), 1, 1)
  grid.cells[1][2] = 'wall'
  const next = applyMove(grid, 'right')
  expect(next).toBeNull()
})

test('player blocked by grid boundary', () => {
  const grid = withPlayer(createEmptyGrid(3, 3), 0, 0)
  const next = applyMove(grid, 'left')
  expect(next).toBeNull()
})

test('pushing a single box into empty space translates both', () => {
  const grid = withPlayer(createEmptyGrid(4, 3), 0, 1)
  addBox(grid, 'b1', 1, 1)
  const next = applyMove(grid, 'right')!
  expect(next.player).toEqual({ x: 1, y: 1 })
  expect(next.boxes.find((b) => b.id === 'b1')).toMatchObject({ x: 2, y: 1 })
})

test('pushing a chain of boxes into empty space translates the whole chain', () => {
  const grid = withPlayer(createEmptyGrid(5, 3), 0, 1)
  addBox(grid, 'b1', 1, 1)
  addBox(grid, 'b2', 2, 1)
  const next = applyMove(grid, 'right')!
  expect(next.player).toEqual({ x: 1, y: 1 })
  expect(next.boxes.find((b) => b.id === 'b1')).toMatchObject({ x: 2, y: 1 })
  expect(next.boxes.find((b) => b.id === 'b2')).toMatchObject({ x: 3, y: 1 })
})

test('pushing a chain fully jammed by wall (all normal boxes) is invalid', () => {
  const grid = withPlayer(createEmptyGrid(4, 3), 0, 1)
  addBox(grid, 'b1', 1, 1, 'normal')
  addBox(grid, 'b2', 2, 1, 'normal')
  grid.cells[1][3] = 'wall'
  const next = applyMove(grid, 'right')
  expect(next).toBeNull()
})

test('does not mutate the original grid', () => {
  const grid = withPlayer(createEmptyGrid(3, 3), 1, 1)
  applyMove(grid, 'right')
  expect(grid.player).toEqual({ x: 1, y: 1 })
})
