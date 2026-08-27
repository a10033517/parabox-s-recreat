import { createEmptyGrid, nestEntryPosition } from '../../src/game/engine/types'
import { applyMove } from '../../src/game/engine/rules'
import { inverseNest, inverseTranslate } from './inverseMoves'

test('inverseTranslate produces a predecessor that forward-replays to the same grid', () => {
  const grid = createEmptyGrid(4, 3)
  grid.player = { x: 2, y: 1 }
  const prev = inverseTranslate(grid, 'right')!
  expect(prev.player).toEqual({ x: 1, y: 1 })
  expect(applyMove(prev, 'right')).toEqual(grid)
})

test('inverseTranslate also pulls back a box that sits ahead of the player', () => {
  const grid = createEmptyGrid(5, 3)
  grid.player = { x: 2, y: 1 }
  grid.boxes.push({ id: 'b1', x: 3, y: 1, boxType: 'normal', interior: createEmptyGrid(1, 1) })
  const prev = inverseTranslate(grid, 'right')!
  expect(applyMove(prev, 'right')).toEqual(grid)
})

test('inverseTranslate returns null when there is no room behind the player', () => {
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 0, y: 1 }
  expect(inverseTranslate(grid, 'right')).toBeNull()
})

test('inverseNest produces a predecessor whose forward move re-creates the nested state', () => {
  const grid = createEmptyGrid(5, 3)
  grid.cells[1][3] = 'wall'
  const container = { id: 'c1', x: 2, y: 1, boxType: 'container' as const, interior: createEmptyGrid(3, 3) }
  const entry = nestEntryPosition(container.interior, 'right')
  container.interior.boxes.push({ id: 'n1', x: entry.x, y: entry.y, boxType: 'normal', interior: createEmptyGrid(1, 1) })
  grid.boxes.push(container)
  grid.player = { x: 1, y: 1 }

  const prev = inverseNest(grid, 'right')!
  const replayed = applyMove(prev, 'right')
  expect(replayed).toEqual(grid)
})

test('inverseNest returns null when the container is not against a wall', () => {
  const grid = createEmptyGrid(5, 3)
  const container = { id: 'c1', x: 2, y: 1, boxType: 'container' as const, interior: createEmptyGrid(3, 3) }
  const entry = nestEntryPosition(container.interior, 'right')
  container.interior.boxes.push({ id: 'n1', x: entry.x, y: entry.y, boxType: 'normal', interior: createEmptyGrid(1, 1) })
  grid.boxes.push(container)
  grid.player = { x: 1, y: 1 }
  expect(inverseNest(grid, 'right')).toBeNull()
})
