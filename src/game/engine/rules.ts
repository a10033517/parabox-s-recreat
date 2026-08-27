import { Box, cellAt, boxAt, cloneGrid, Direction, DIRECTION_VECTORS, Grid } from './types'

export function applyMove(grid: Grid, direction: Direction): Grid | null {
  if (!grid.player) return null
  const { dx, dy } = DIRECTION_VECTORS[direction]

  const chain: Box[] = []
  let cx = grid.player.x + dx
  let cy = grid.player.y + dy
  while (true) {
    const cell = cellAt(grid, cx, cy)
    if (cell === 'oob' || cell === 'wall') break
    const box = boxAt(grid, cx, cy)
    if (!box) break
    chain.push(box)
    cx += dx
    cy += dy
  }

  const terminalCell = cellAt(grid, cx, cy)
  const terminalOpen = terminalCell !== 'oob' && terminalCell !== 'wall' && !boxAt(grid, cx, cy)

  if (chain.length === 0) {
    if (!terminalOpen) return null
    const next = cloneGrid(grid)
    next.player = { x: grid.player.x + dx, y: grid.player.y + dy }
    return next
  }

  if (terminalOpen) {
    const next = cloneGrid(grid)
    next.player = { x: grid.player.x + dx, y: grid.player.y + dy }
    for (const box of chain) {
      const nb = next.boxes.find((b) => b.id === box.id)!
      nb.x += dx
      nb.y += dy
    }
    return next
  }

  return resolveNesting(grid, chain, direction)
}

function resolveNesting(_grid: Grid, _chain: Box[], _direction: Direction): Grid | null {
  return null
}
