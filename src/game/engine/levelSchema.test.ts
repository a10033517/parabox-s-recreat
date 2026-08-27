import { createEmptyGrid } from './types'
import { parseLevel, serializeLevel } from './levelSchema'

test('serializeLevel then parseLevel round-trips a grid', () => {
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 0, y: 0 }
  grid.cells[2][2] = 'target'
  grid.boxes.push({ id: 'b1', x: 1, y: 1, boxType: 'container', interior: createEmptyGrid(2, 2), isGoalBox: true })
  const json = serializeLevel(grid)
  const parsed = parseLevel(json)
  expect(parsed).toEqual(grid)
})

test('parseLevel rejects malformed JSON structure', () => {
  expect(() => parseLevel('{"width": 3}')).toThrow()
  expect(() => parseLevel('not json')).toThrow()
})

test('parseLevel rejects a grid whose cells do not match declared dimensions', () => {
  const bad = JSON.stringify({ width: 2, height: 2, cells: [['empty']], boxes: [] })
  expect(() => parseLevel(bad)).toThrow()
})
