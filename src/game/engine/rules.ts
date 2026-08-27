import { Box, boxAt, canNestAt, cellAt, cloneGrid, Direction, DIRECTION_VECTORS, Grid, nestEntryPosition } from './types'

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

function resolveNesting(grid: Grid, chain: Box[], direction: Direction): Grid | null {
  const { dx, dy } = DIRECTION_VECTORS[direction]
  let canReceiveNext = false
  let nestIndex = -1
  for (let i = chain.length - 1; i >= 0; i--) {
    if (canReceiveNext) {
      nestIndex = i
      break
    }
    canReceiveNext = chain[i].boxType === 'container'
  }
  if (nestIndex === -1) return null

  const receiver = chain[nestIndex + 1]
  const nested = chain[nestIndex]
  const entryPos = nestEntryPosition(receiver.interior, direction)
  if (!canNestAt(receiver.interior, entryPos)) return null

  const next = cloneGrid(grid)
  next.boxes = next.boxes.filter((b) => b.id !== nested.id)
  const nextReceiver = next.boxes.find((b) => b.id === receiver.id)!
  const nestedCopy = structuredClone(nested)
  nestedCopy.x = entryPos.x
  nestedCopy.y = entryPos.y
  nextReceiver.interior.boxes.push(nestedCopy)

  next.player = { x: grid.player!.x + dx, y: grid.player!.y + dy }
  for (let i = 0; i < nestIndex; i++) {
    const b = next.boxes.find((bb) => bb.id === chain[i].id)!
    b.x += dx
    b.y += dy
  }
  return next
}
