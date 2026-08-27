import { createEmptyGrid, cloneGrid, cellAt, boxAt } from './types'

test('createEmptyGrid produces all-empty cells of given size', () => {
  const grid = createEmptyGrid(3, 2)
  expect(grid.width).toBe(3)
  expect(grid.height).toBe(2)
  expect(grid.cells).toEqual([
    ['empty', 'empty', 'empty'],
    ['empty', 'empty', 'empty'],
  ])
  expect(grid.boxes).toEqual([])
})

test('cellAt returns oob outside bounds', () => {
  const grid = createEmptyGrid(2, 2)
  expect(cellAt(grid, -1, 0)).toBe('oob')
  expect(cellAt(grid, 2, 0)).toBe('oob')
  expect(cellAt(grid, 0, 0)).toBe('empty')
})

test('boxAt finds box by position', () => {
  const grid = createEmptyGrid(3, 3)
  const box = { id: 'b1', x: 1, y: 1, boxType: 'normal' as const, interior: createEmptyGrid(2, 2) }
  grid.boxes.push(box)
  expect(boxAt(grid, 1, 1)).toBe(box)
  expect(boxAt(grid, 0, 0)).toBeUndefined()
})

test('cloneGrid produces a deep, independent copy', () => {
  const grid = createEmptyGrid(2, 2)
  grid.boxes.push({ id: 'b1', x: 0, y: 0, boxType: 'container', interior: createEmptyGrid(2, 2) })
  const copy = cloneGrid(grid)
  copy.boxes[0].x = 5
  copy.cells[0][0] = 'wall'
  expect(grid.boxes[0].x).toBe(0)
  expect(grid.cells[0][0]).toBe('empty')
})
