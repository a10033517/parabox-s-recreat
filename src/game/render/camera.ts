import { BoardId, PLAYER_ID, World, findContainerFor, isInVoidSpace } from '../engine/types'
import { CameraAnchor, boardTransformInAnchor, ownerPathToAnchor, resolveAnchorBoardId } from './recursiveTransform'

export interface Viewport {
  width: number
  height: number
}

export interface CameraTransform {
  centerX: number
  centerY: number
  pixelsPerRootUnit: number
  anchor: CameraAnchor
  // Set when the camera works in a local loop instead of the level's anchor board (see
  // effectiveAnchorBoard); the scene is then drawn from this board.
  anchorBoardId?: BoardId
}

export interface CameraBudget {
  // Cells of the surrounding (outer) board shown on every side of the framed box.
  marginCells: number
}

const MIN_ZOOM = 4
// High enough for a box several levels deep (each level divides the scale by its board size).
const MAX_ZOOM = 1e7

export function clampCameraZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function worldToScreen(
  x: number,
  y: number,
  camera: CameraTransform,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (x - camera.centerX) * camera.pixelsPerRootUnit + viewport.width / 2,
    y: (y - camera.centerY) * camera.pixelsPerRootUnit + viewport.height / 2,
  }
}

export function cameraFallbackForAnchor(anchor: CameraAnchor, viewport: Viewport, budget: CameraBudget): CameraTransform {
  const spanUnits = 1 + 2 * budget.marginCells
  return { anchor, centerX: 0.5, centerY: 0.5, pixelsPerRootUnit: clampCameraZoom(Math.min(viewport.width, viewport.height) / spanUnits) }
}

// Frames the box the player is standing in, as seen from one level up (see
// docs/superpowers/specs/2026-09-18-camera-framing-design.md): the whole box plus
// budget.marginCells of its outer board on every side. The target depends only on WHICH board
// the player stands on, never on the player's x/y inside it — so an ordinary step never moves
// the camera; it only reframes on entering / leaving a box, a teleport, or the Void.
// cachedRootAnchorBoardId: see resolveCanonicalBoardTransform's own doc — thread through
// the same anchor board id resolved once per level load, so pre-move/post-move cameras
// computed for one animated move stay in the same coordinate space (final-review I3).
// The board the camera works in. Normally the level's anchor. But when the way OUT of the
// player's board (the engine's exit chain, findContainerFor — the same climb computeTarget
// makes) loops without ever reaching the anchor — e.g. file_format_example's green box, whose
// exitblock Ref sits inside itself — the player is inside that loop: walking out only ever
// leads back into it (green inside green). The loop is then the player's whole world, so the
// camera anchors on it (its smallest board id, for stability) and the scene around it is the
// loop itself, not the outer level (user-reported, 2026-09-26).
export function effectiveAnchorBoard(world: World, focusBoardId: BoardId, anchorBoardId: BoardId): BoardId {
  const order: BoardId[] = []
  let current = focusBoardId
  while (current !== anchorBoardId) {
    const seenAt = order.indexOf(current)
    if (seenAt >= 0) return order.slice(seenAt).sort()[0]
    order.push(current)
    const ownerId = findContainerFor(world, current)
    const ownerLoc = ownerId === undefined ? undefined : world.locations[ownerId]
    if (ownerLoc === undefined) return anchorBoardId
    current = ownerLoc.board
  }
  return anchorBoardId
}

export function cameraForFocus(
  world: World,
  viewport: Viewport,
  budget: CameraBudget,
  cachedRootAnchorBoardId?: BoardId,
): CameraTransform {
  const playerLoc = world.locations[PLAYER_ID]
  const anchor: CameraAnchor = playerLoc !== undefined && isInVoidSpace(world, playerLoc.board) ? 'void' : 'root'
  if (playerLoc === undefined) return cameraFallbackForAnchor(anchor, viewport, budget)
  const shortSide = Math.min(viewport.width, viewport.height)
  const levelAnchorBoardId =
    anchor === 'root' && cachedRootAnchorBoardId !== undefined ? cachedRootAnchorBoardId : resolveAnchorBoardId(world, anchor)
  const focusBoardId = playerLoc.board
  const anchorBoardId = levelAnchorBoardId === null ? null : effectiveAnchorBoard(world, focusBoardId, levelAnchorBoardId)
  const local = anchorBoardId !== levelAnchorBoardId && anchorBoardId !== null ? { anchorBoardId } : {}

  // Case 2: the player stands on the anchor board itself — frame the whole board plus margin.
  if (focusBoardId === anchorBoardId) {
    const t = boardTransformInAnchor(world, focusBoardId, anchorBoardId)
    const board = world.boards[focusBoardId]
    if (t === null || board === undefined) return cameraFallbackForAnchor(anchor, viewport, budget)
    const spanUnits = board.size + 2 * budget.marginCells
    return {
      ...local,
      anchor,
      centerX: t.originX + (board.size / 2) * t.scale,
      centerY: t.originY + (board.size / 2) * t.scale,
      pixelsPerRootUnit: clampCameraZoom(shortSide / (spanUnits * t.scale)),
    }
  }

  // Case 1: frame the containing box's own cell on its parent board, plus margin — the box
  // through which the renderer actually shows this board (ownerPathToAnchor).
  if (anchorBoardId === null) return cameraFallbackForAnchor(anchor, viewport, budget)
  const ownerId = ownerPathToAnchor(world, focusBoardId, anchorBoardId)?.[0]
  const ownerLoc = ownerId === undefined ? undefined : world.locations[ownerId]
  if (ownerLoc === undefined) return cameraFallbackForAnchor(anchor, viewport, budget)
  const parent = boardTransformInAnchor(world, ownerLoc.board, anchorBoardId)
  if (parent === null) return cameraFallbackForAnchor(anchor, viewport, budget)
  const spanUnits = 1 + 2 * budget.marginCells
  const ownerX = parent.mirrorH === true ? world.boards[ownerLoc.board].size - 1 - ownerLoc.x : ownerLoc.x
  return {
    ...local,
    anchor,
    centerX: parent.originX + (ownerX + 0.5) * parent.scale,
    centerY: parent.originY + (ownerLoc.y + 0.5) * parent.scale,
    pixelsPerRootUnit: clampCameraZoom(shortSide / (spanUnits * parent.scale)),
  }
}
