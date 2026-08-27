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

test('single container box against wall cannot nest (wall does not receive)', () => {
  const grid = withPlayer(createEmptyGrid(4, 3), 0, 1)
  addBox(grid, 'c1', 1, 1, 'container')
  grid.cells[1][2] = 'wall'
  const next = applyMove(grid, 'right')
  expect(next).toBeNull()
})

test('pushing a normal box into a container box against the wall nests it', () => {
  const grid = withPlayer(createEmptyGrid(5, 3), 0, 1)
  addBox(grid, 'n1', 1, 1, 'normal')
  const container = addBox(grid, 'c1', 2, 1, 'container')
  grid.cells[1][3] = 'wall'
  const next = applyMove(grid, 'right')!
  expect(next.boxes.find((b) => b.id === 'n1')).toBeUndefined()
  const nextContainer = next.boxes.find((b) => b.id === 'c1')!
  expect(nextContainer.x).toBe(container.x)
  expect(nextContainer.y).toBe(container.y)
  expect(nextContainer.interior.boxes).toHaveLength(1)
  expect(nextContainer.interior.boxes[0].id).toBe('n1')
  expect(next.player).toEqual({ x: 1, y: 1 })
})

test('three container boxes against a wall: only the pair closest to the wall nests', () => {
  const grid = withPlayer(createEmptyGrid(6, 3), 0, 1)
  addBox(grid, 'c1', 1, 1, 'container')
  addBox(grid, 'c2', 2, 1, 'container')
  addBox(grid, 'c3', 3, 1, 'container')
  grid.cells[1][4] = 'wall'
  const next = applyMove(grid, 'right')!
  expect(next.boxes.find((b) => b.id === 'c2')).toBeUndefined()
  const c3 = next.boxes.find((b) => b.id === 'c3')!
  expect(c3).toMatchObject({ x: 3, y: 1 })
  expect(c3.interior.boxes.map((b) => b.id)).toEqual(['c2'])
  const c1 = next.boxes.find((b) => b.id === 'c1')!
  expect(c1).toMatchObject({ x: 2, y: 1 })
  expect(next.player).toEqual({ x: 1, y: 1 })
})

test('container1 -> container2 -> normal -> wall: container1 nests into container2, rest stays', () => {
  const grid = withPlayer(createEmptyGrid(6, 3), 0, 1)
  addBox(grid, 'c1', 1, 1, 'container')
  addBox(grid, 'c2', 2, 1, 'container')
  addBox(grid, 'n1', 3, 1, 'normal')
  grid.cells[1][4] = 'wall'
  const next = applyMove(grid, 'right')!
  expect(next.boxes.find((b) => b.id === 'c1')).toBeUndefined()
  const c2 = next.boxes.find((b) => b.id === 'c2')!
  expect(c2).toMatchObject({ x: 2, y: 1 })
  expect(c2.interior.boxes.map((b) => b.id)).toEqual(['c1'])
  const n1 = next.boxes.find((b) => b.id === 'n1')!
  expect(n1).toMatchObject({ x: 3, y: 1 })
  expect(next.player).toEqual({ x: 1, y: 1 })
})

test('chain of only normal boxes against a wall is fully jammed', () => {
  const grid = withPlayer(createEmptyGrid(5, 3), 0, 1)
  addBox(grid, 'n1', 1, 1, 'normal')
  addBox(grid, 'n2', 2, 1, 'normal')
  grid.cells[1][3] = 'wall'
  const next = applyMove(grid, 'right')
  expect(next).toBeNull()
})
