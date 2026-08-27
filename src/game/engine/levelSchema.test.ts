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

test('parseLevel rejects malformed player field', () => {
  const badPlayer = JSON.stringify({ width: 1, height: 1, cells: [['empty']], boxes: [], player: 'nope' })
  expect(() => parseLevel(badPlayer)).toThrow()
  const badPlayerMissingY = JSON.stringify({ width: 1, height: 1, cells: [['empty']], boxes: [], player: { x: 0 } })
  expect(() => parseLevel(badPlayerMissingY)).toThrow()
  const badPlayerNonNumber = JSON.stringify({ width: 1, height: 1, cells: [['empty']], boxes: [], player: { x: 'zero', y: 0 } })
  expect(() => parseLevel(badPlayerNonNumber)).toThrow()
})

test('parseLevel rejects malformed isGoalBox field', () => {
  const badIsGoalBox = JSON.stringify({
    width: 1,
    height: 1,
    cells: [['empty']],
    boxes: [{ id: 'b1', x: 0, y: 0, boxType: 'normal', interior: { width: 1, height: 1, cells: [['empty']], boxes: [] }, isGoalBox: 'yes' }]
  })
  expect(() => parseLevel(badIsGoalBox)).toThrow()
})

test('parseLevel includes box array index in error messages for malformed boxes', () => {
  const badBoxAtIndex1 = JSON.stringify({
    width: 2,
    height: 2,
    cells: [['empty', 'empty'], ['empty', 'empty']],
    boxes: [
      { id: 'b0', x: 0, y: 0, boxType: 'normal', interior: { width: 1, height: 1, cells: [['empty']], boxes: [] } },
      { id: 'b1', x: 1, y: 1, boxType: 'invalid', interior: { width: 1, height: 1, cells: [['empty']], boxes: [] } }
    ]
  })
  try {
    parseLevel(badBoxAtIndex1)
    throw new Error('Should have thrown')
  } catch (e) {
    expect((e as Error).message).toContain('boxes[1]')
  }
})
