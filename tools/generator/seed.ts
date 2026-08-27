import { createEmptyGrid, Grid } from '../../src/game/engine/types'

export function createSeedGrid(): Grid {
  const grid = createEmptyGrid(7, 5)
  for (let x = 0; x < grid.width; x++) {
    grid.cells[0][x] = 'wall'
    grid.cells[grid.height - 1][x] = 'wall'
  }
  for (let y = 0; y < grid.height; y++) {
    grid.cells[y][0] = 'wall'
    grid.cells[y][grid.width - 1] = 'wall'
  }
  grid.cells[2][5] = 'target'
  grid.boxes.push({
    id: 'goal',
    x: 5,
    y: 2,
    boxType: 'container',
    isGoalBox: true,
    interior: createEmptyGrid(3, 3),
  })
  grid.player = { x: 3, y: 2 }
  return grid
}
