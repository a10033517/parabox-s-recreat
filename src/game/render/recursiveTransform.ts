import { Board, BoardId, Location, PLAYER_ID, VOID_BOARD_ID, World, findContainerFor } from '../engine/types'

export interface BoardTransform {
  boardId: BoardId
  // Top-left corner of this board's (0,0) cell, in the active anchor's units.
  originX: number
  originY: number
  // Size of ONE cell of this board, in anchor units. The anchor board's own
  // transform has scale === 1.
  scale: number
}

export function childTransform(
  parentTransform: BoardTransform,
  location: Location,
  childBoard: Board,
): BoardTransform {
  if (childBoard.size <= 0) {
    throw new Error(`Invalid board size: ${childBoard.size}`)
  }
  return {
    boardId: childBoard.id,
    originX: parentTransform.originX + location.x * parentTransform.scale,
    originY: parentTransform.originY + location.y * parentTransform.scale,
    scale: parentTransform.scale / childBoard.size,
  }
}

export type CameraAnchor = 'root' | 'void'

// The anchor board is identified the same way levelSchema.ts's own startBoardId is: the
// sole zero-owner board if one exists (an ordinary tree level), otherwise the player's
// own board (a pure-cycle level has no zero-owner board at all — see the general-cycles
// spec). Never a hardcoded 'root' literal.
export function resolveAnchorBoardId(world: World, anchor: CameraAnchor): BoardId | null {
  if (anchor === 'void') {
    return world.boards[VOID_BOARD_ID] !== undefined ? VOID_BOARD_ID : null
  }
  // VOID_BOARD_ID excluded from the orphan scan: once any piece falls into the Void,
  // 'void' is added to world.boards but nothing ever owns it (no container has
  // boardRef: 'void'), so on a pure-cycle level (every real board already owned) it
  // would otherwise become the only zero-owner board and hijack the anchor away from
  // wherever the player actually is (final-review C1).
  const ownerCount = new Map<BoardId, number>(
    Object.keys(world.boards).filter((id) => id !== VOID_BOARD_ID).map((id) => [id, 0]),
  )
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind === 'container' && piece.boardRef !== undefined && piece.boardRef !== VOID_BOARD_ID) {
      ownerCount.set(piece.boardRef, (ownerCount.get(piece.boardRef) ?? 0) + 1)
    }
  }
  const orphan = [...ownerCount.entries()].find(([, count]) => count === 0)
  if (orphan !== undefined) return orphan[0]
  return world.locations[PLAYER_ID]?.board ?? null
}

// Walks from boardId UP to the anchor board via findContainerFor (mirroring
// computeTarget's own upward climb in rules.ts), cycle-safe via a visited set, then
// composes childTransform forward from the anchor's identity transform down through the
// discovered path. Returns null if boardId isn't reachable from this anchor at all, or a
// cycle prevents reaching the anchor board.
export function resolveCanonicalBoardTransform(
  world: World,
  boardId: BoardId,
  anchor: CameraAnchor,
): BoardTransform | null {
  const anchorBoardId = resolveAnchorBoardId(world, anchor)
  if (anchorBoardId === null) return null
  if (world.boards[boardId] === undefined) return null

  const path: { location: Location; board: Board }[] = []
  let current = boardId
  const visited = new Set<BoardId>()
  while (current !== anchorBoardId) {
    if (visited.has(current)) return null
    visited.add(current)
    const ownerId = findContainerFor(world, current)
    if (ownerId === undefined) return null
    const ownerLoc = world.locations[ownerId]
    if (ownerLoc === undefined) return null
    path.push({ location: ownerLoc, board: world.boards[current] })
    current = ownerLoc.board
  }

  let transform: BoardTransform = { boardId: anchorBoardId, originX: 0, originY: 0, scale: 1 }
  for (let i = path.length - 1; i >= 0; i--) {
    transform = childTransform(transform, path[i].location, path[i].board)
  }
  return transform
}
