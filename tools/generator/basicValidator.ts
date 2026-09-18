import { Board, BoardId, Cell, PLAYER_ID, World, findContainerFor, inBounds } from '../../src/game/engine/types'

export type ValidationResult = { valid: true } | { valid: false; reason: string }

function floodFillFloorCount(board: Board): number {
  const size = board.size
  const seen: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  let start: { x: number; y: number } | null = null
  for (let y = 0; y < size && start === null; y++) {
    for (let x = 0; x < size; x++) {
      if (board.cells[y][x].type === 'floor') { start = { x, y }; break }
    }
  }
  if (start === null) return 0
  const stack: { x: number; y: number }[] = [start]
  seen[start.y][start.x] = true
  let count = 0
  while (stack.length > 0) {
    const { x, y } = stack.pop() as { x: number; y: number }
    count++
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy
      if (!inBounds(board, nx, ny)) continue
      if (seen[ny][nx]) continue
      if (board.cells[ny][nx].type !== 'floor') continue
      seen[ny][nx] = true
      stack.push({ x: nx, y: ny })
    }
  }
  return count
}

function countCellsWhere(board: Board, predicate: (cell: Cell) => boolean): number {
  let count = 0
  for (const row of board.cells) for (const cell of row) if (predicate(cell)) count++
  return count
}

// Generator-specific validator (see the design spec §5): root is always
// literally named 'root' by construction (randomGenerator.ts's own
// invariant), so this doesn't need the more general "figure out which
// board is ownerless" logic that levelSchema.ts's parseLevel uses for
// arbitrary hand-authored input.
export function basicValidate(world: World, maxNestingDepth: number): ValidationResult {
  const seenCells = new Set<string>()
  for (const [pieceId, loc] of Object.entries(world.locations)) {
    const board = world.boards[loc.board]
    if (board === undefined) {
      return { valid: false, reason: `piece "${pieceId}" references a nonexistent board "${loc.board}"` }
    }
    if (!inBounds(board, loc.x, loc.y)) {
      return { valid: false, reason: `piece "${pieceId}" is out of bounds on board "${loc.board}"` }
    }
    if (board.cells[loc.y][loc.x].type === 'wall') {
      return { valid: false, reason: `piece "${pieceId}" starts on a wall cell` }
    }
    const key = `${loc.board}:${loc.x}:${loc.y}`
    if (seenCells.has(key)) {
      return { valid: false, reason: `two pieces overlap at board "${loc.board}" (${loc.x}, ${loc.y})` }
    }
    seenCells.add(key)
  }

  const playerPieces = Object.values(world.pieces).filter((p) => p.kind === 'player')
  if (playerPieces.length !== 1) {
    return { valid: false, reason: `expected exactly one player piece, found ${playerPieces.length}` }
  }
  if (world.pieces[PLAYER_ID] === undefined || world.locations[PLAYER_ID] === undefined) {
    return { valid: false, reason: `the player piece must be keyed by id "${PLAYER_ID}"` }
  }

  let goalCount = 0
  for (const board of Object.values(world.boards)) {
    goalCount += countCellsWhere(board, (cell) => cell.requirement === 'box')
  }
  const boxCount = Object.values(world.pieces).filter((p) => p.kind === 'normal').length
  if (goalCount !== boxCount) {
    return { valid: false, reason: `goal count (${goalCount}) does not match box count (${boxCount})` }
  }

  for (const [boardId, board] of Object.entries(world.boards)) {
    const totalFloor = countCellsWhere(board, (cell) => cell.type === 'floor')
    if (totalFloor === 0) {
      return { valid: false, reason: `board "${boardId}" has no floor cells at all` }
    }
    const reachable = floodFillFloorCount(board)
    if (reachable !== totalFloor) {
      return {
        valid: false,
        reason: `board "${boardId}"'s floor is not a single connected region (${reachable}/${totalFloor} reachable)`,
      }
    }
  }

  const ownerCount = new Map<BoardId, number>()
  for (const boardId of Object.keys(world.boards)) ownerCount.set(boardId, 0)
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container') continue
    if (piece.boardRef === undefined || world.boards[piece.boardRef] === undefined) {
      return { valid: false, reason: `container "${piece.id}" references a nonexistent board` }
    }
    ownerCount.set(piece.boardRef, (ownerCount.get(piece.boardRef) ?? 0) + 1)
  }
  for (const [boardId, count] of ownerCount) {
    if (boardId === 'root') {
      if (count !== 0) return { valid: false, reason: 'root board must not be referenced by any container' }
      continue
    }
    if (count !== 1) {
      return { valid: false, reason: `board "${boardId}" has ${count} owning containers, expected exactly 1` }
    }
  }

  // Each BOARD's own depth (root = 0, each containment hop +1) must not
  // exceed maxNestingDepth — matches randomGenerator.ts's own semantics,
  // where a board at exactly maxNestingDepth can still exist, it simply
  // can't be chosen as the parent of an even deeper one.
  for (const boardId of Object.keys(world.boards)) {
    let depth = 0
    let currentBoardId: BoardId = boardId
    const visited = new Set<BoardId>()
    while (currentBoardId !== 'root') {
      if (visited.has(currentBoardId)) {
        return { valid: false, reason: `board containment forms a cycle at "${currentBoardId}"` }
      }
      visited.add(currentBoardId)
      const ownerContainer = findContainerFor(world, currentBoardId)
      if (ownerContainer === undefined) {
        return { valid: false, reason: `board "${currentBoardId}" is not reachable back to root` }
      }
      currentBoardId = world.locations[ownerContainer].board
      depth++
      if (depth > maxNestingDepth) {
        return { valid: false, reason: `nesting depth exceeds ${maxNestingDepth}` }
      }
    }
  }

  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container') continue
    const loc = world.locations[piece.id]
    const board = world.boards[loc.board]
    let blocked = false
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = loc.x + dx, ny = loc.y + dy
      if (!inBounds(board, nx, ny) || board.cells[ny][nx].type === 'wall') { blocked = true; break }
    }
    if (!blocked) {
      return { valid: false, reason: `container "${piece.id}" has open floor on all 4 sides and can never be entered` }
    }
  }

  return { valid: true }
}
