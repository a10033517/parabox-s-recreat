import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, Grid } from '../../src/game/engine/types'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export function solve(initialGrid: Grid, maxDepth = 200): Direction[] | null {
  if (checkWin(initialGrid)) return []

  const visited = new Set<string>([JSON.stringify(initialGrid)])
  let frontier: { grid: Grid; path: Direction[] }[] = [{ grid: initialGrid, path: [] }]
  let depth = 0

  while (frontier.length > 0 && depth < maxDepth) {
    const nextFrontier: typeof frontier = []
    for (const { grid, path } of frontier) {
      for (const direction of DIRECTIONS) {
        const next = applyMove(grid, direction)
        if (!next) continue
        const key = JSON.stringify(next)
        if (visited.has(key)) continue
        visited.add(key)
        const newPath = [...path, direction]
        if (checkWin(next)) return newPath
        nextFrontier.push({ grid: next, path: newPath })
      }
    }
    frontier = nextFrontier
    depth++
  }
  return null
}

export function countNestingEvents(grid: Grid, moves: Direction[]): number {
  let current = grid
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countNestingEvents received an invalid move for this grid')
    if (next.boxes.length < current.boxes.length) count++
    current = next
  }
  return count
}
