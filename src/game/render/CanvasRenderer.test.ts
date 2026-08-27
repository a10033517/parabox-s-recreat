import { createEmptyGrid } from '../engine/types'
import { renderGrid } from './CanvasRenderer'

function mockContext() {
  return {
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    fillStyle: '',
    strokeStyle: '',
  } as unknown as CanvasRenderingContext2D
}

test('renderGrid draws one rect per cell plus one per box, and recurses into container interiors', () => {
  const ctx = mockContext()
  let fillRectCalls = 0
  ctx.fillRect = () => {
    fillRectCalls++
  }

  const grid = createEmptyGrid(2, 2)
  grid.boxes.push({
    id: 'c1',
    x: 0,
    y: 0,
    boxType: 'container',
    interior: createEmptyGrid(2, 2),
  })

  renderGrid(ctx, grid, 0, 0, 32)

  // 4 background cells + 1 box body + 4 nested background cells drawn inside the box = 9
  expect(fillRectCalls).toBe(9)
})

test('renderGrid does not throw on deeply nested grids', () => {
  const ctx = mockContext()
  let grid = createEmptyGrid(2, 2)
  for (let i = 0; i < 5; i++) {
    const inner = createEmptyGrid(2, 2)
    grid = createEmptyGrid(2, 2)
    grid.boxes.push({ id: `c${i}`, x: 0, y: 0, boxType: 'container', interior: inner })
  }
  expect(() => renderGrid(ctx, grid, 0, 0, 32)).not.toThrow()
})
