import { Board, BoardId, Location, PLAYER_ID, PieceId, VOID_BOARD_ID, World, findContainerFor, hasInterior } from '../engine/types'

export interface BoardTransform {
  boardId: BoardId
  // Top-left corner of this board's (0,0) cell, in the active anchor's units.
  originX: number
  originY: number
  // Size of ONE cell of this board, in anchor units. The anchor board's own
  // transform has scale === 1.
  scale: number
  // Set when this board is drawn mirrored (it sits inside an odd number of fliph boxes on
  // the way down from the anchor): its column x is drawn at size-1-x.
  mirrorH?: boolean
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
    if ((piece.kind === 'container' || piece.kind === 'player') && piece.boardRef !== undefined && piece.boardRef !== VOID_BOARD_ID) {
      ownerCount.set(piece.boardRef, (ownerCount.get(piece.boardRef) ?? 0) + 1)
    }
  }
  const orphan = [...ownerCount.entries()].find(([, count]) => count === 0)
  if (orphan !== undefined) return orphan[0]
  return world.locations[PLAYER_ID]?.board ?? null
}

// The chain of owners that leads from boardId up to the anchor board — the path along which the
// renderer, drawing down from the anchor, actually shows this board. The canonical exit
// (findContainerFor) is preferred at every step, but when it cannot reach the anchor (e.g. a
// box whose exitblock Ref sits inside its own interior, as in file_format_example — climbing
// through it only loops) another instance that does reach it is used. Null if none does.
export function ownerPathToAnchor(world: World, boardId: BoardId, anchorBoardId: BoardId): PieceId[] | null {
  const visited = new Set<BoardId>()
  const search = (board: BoardId): PieceId[] | null => {
    if (board === anchorBoardId) return []
    if (visited.has(board)) return null
    visited.add(board)
    const canonical = findContainerFor(world, board)
    const owners = Object.values(world.pieces)
      .filter((p) => hasInterior(p) && p.cloneOf === undefined && p.boardRef === board && world.locations[p.id] !== undefined)
      .map((p) => p.id)
      .sort((a, b) => (a === canonical ? -1 : b === canonical ? 1 : a.localeCompare(b)))
    for (const ownerId of owners) {
      const rest = search(world.locations[ownerId].board)
      if (rest !== null) return [ownerId, ...rest]
    }
    return null
  }
  return search(boardId)
}

// boardId's transform in anchorBoardId's units, following ownerPathToAnchor down from the
// anchor and mirroring inside fliph owners exactly as drawBoardRecursive does.
export function boardTransformInAnchor(world: World, boardId: BoardId, anchorBoardId: BoardId): BoardTransform | null {
  if (world.boards[boardId] === undefined || world.boards[anchorBoardId] === undefined) return null
  const path = ownerPathToAnchor(world, boardId, anchorBoardId)
  if (path === null) return null
  let originX = 0
  let originY = 0
  let scale = 1
  let mirror = false
  for (let i = path.length - 1; i >= 0; i--) {
    const owner = world.pieces[path[i]]
    const ownerLoc = world.locations[owner.id]
    const parentSize = world.boards[ownerLoc.board].size
    const x = mirror ? parentSize - 1 - ownerLoc.x : ownerLoc.x
    originX += x * scale
    originY += ownerLoc.y * scale
    scale /= world.boards[owner.boardRef as BoardId].size
    mirror = mirror !== (owner.fliph === true)
  }
  const transform: BoardTransform = { boardId, originX, originY, scale }
  if (mirror) transform.mirrorH = true
  return transform
}

// boardId's transform relative to the camera anchor (see boardTransformInAnchor).
export function resolveCanonicalBoardTransform(
  world: World,
  boardId: BoardId,
  anchor: CameraAnchor,
  // When provided and anchor === 'root', used directly instead of re-deriving the anchor
  // board from this (possibly mid-move) World snapshot. On a pure-cycle level,
  // resolveAnchorBoardId's own fallback is the player's CURRENT board, which changes
  // during the exact move being animated — so the pre-move and post-move World snapshots
  // can silently resolve to two different anchor boards while both are tagged anchor:
  // 'root', producing a nonsensical camera lerp across unrelated coordinate spaces
  // (final-review I3). Callers that resolve the anchor once per level load (GameScreen)
  // pass that cached id here so every call stays in the same coordinate space.
  cachedRootAnchorBoardId?: BoardId,
): BoardTransform | null {
  const anchorBoardId =
    anchor === 'root' && cachedRootAnchorBoardId !== undefined
      ? cachedRootAnchorBoardId
      : resolveAnchorBoardId(world, anchor)
  if (anchorBoardId === null) return null
  return boardTransformInAnchor(world, boardId, anchorBoardId)
}

// Where drawing starts. The camera's margin shows a little of what lies OUTSIDE the anchor
// board; when that board is itself inside a box (a self-loop / cycle level — e.g. the root of
// iiexit_intro sits inside its own self-loop box), that outside is the box's surroundings on
// its own board, not empty space. So drawing starts up to `maxLevels` owners further out,
// scaled so the owner's cell covers exactly the anchor board's extent — the anchor board then
// lands at the identity transform as before, and every camera coordinate stays valid.
// A tree root (no owner) and the Void are drawn from themselves, as before. An owner with
// fliph is not climbed: drawing through it would mirror the anchor board itself.
// locate: where a piece is drawn right now (mid-move animation); when the owner itself is
// moving, the outer ring then glides with it instead of jumping at the end of the move.
export function resolveDrawRoot(
  world: World,
  anchorBoardId: BoardId,
  maxLevels = 2,
  locate?: (pieceId: PieceId) => Location | undefined,
): BoardTransform {
  let transform: BoardTransform = { boardId: anchorBoardId, originX: 0, originY: 0, scale: 1 }
  for (let level = 0; level < maxLevels; level++) {
    const board = world.boards[transform.boardId]
    if (board === undefined || transform.boardId === VOID_BOARD_ID) break
    const ownerId = findContainerFor(world, transform.boardId)
    if (ownerId === undefined) break
    const owner = world.pieces[ownerId]
    const ownerLoc = locate?.(ownerId) ?? world.locations[ownerId]
    if (owner === undefined || ownerLoc === undefined || owner.fliph === true) break
    if (world.boards[ownerLoc.board] === undefined || ownerLoc.board === VOID_BOARD_ID) break
    const scale = transform.scale * board.size
    transform = {
      boardId: ownerLoc.board,
      originX: transform.originX - ownerLoc.x * scale,
      originY: transform.originY - ownerLoc.y * scale,
      scale,
    }
  }
  return transform
}
