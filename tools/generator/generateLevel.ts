import { cloneGrid, Direction, Grid } from '../../src/game/engine/types'
import { inverseNest, inverseTranslate } from './inverseMoves'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export function generateLevel(seed: Grid, steps: number, rng: () => number): Grid {
  let grid = cloneGrid(seed)
  let applied = 0
  let attempts = 0
  const maxAttempts = Math.max(steps, 1) * 20

  while (applied < steps && attempts < maxAttempts) {
    attempts++
    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length) % DIRECTIONS.length]
    const preferNest = rng() < 0.5
    const primary = preferNest ? inverseNest(grid, direction) : inverseTranslate(grid, direction)
    const fallback = primary ?? (preferNest ? inverseTranslate(grid, direction) : inverseNest(grid, direction))
    if (!fallback) continue
    grid = fallback
    applied++
  }
  return grid
}
