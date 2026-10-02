import { BoardId, PLAYER_ID, PieceId, World } from '../engine/types'
import { CameraTransform, Viewport } from './camera'
import { resolveRecursionTarget } from './CanvasRenderer'
import { Hit } from './hitTest'
import { boardTransformInAnchor } from './recursiveTransform'

// Peeking into a box: the game's own camera zooms in on a box the player taps, framed the way
// the game frames a box the player has walked into. Tapping a box inside goes one level deeper,
// tapping outside the box comes back out one level, and any move returns to the normal view.

export interface PeekRect {
  originX: number // the box's cell, in camera (anchor) units
  originY: number
  scale: number
}

export interface PeekLevel {
  pieceId: PieceId
  rect: PeekRect
}

// The camera looking into the box at `rect`: its room as big as the level's own room on screen
// (`roomFraction` of the short side, see anchorRoomFraction), in the same space as `base`.
export function peekCamera(base: CameraTransform, rect: PeekRect, viewport: Viewport, roomFraction: number): CameraTransform {
  return {
    ...(base.anchorBoardId !== undefined ? { anchorBoardId: base.anchorBoardId } : {}),
    anchor: base.anchor,
    centerX: rect.originX + rect.scale / 2,
    centerY: rect.originY + rect.scale / 2,
    pixelsPerRootUnit: (Math.min(viewport.width, viewport.height) * roomFraction) / rect.scale,
  }
}

// The room the player stands in, in camera units — what the normal view is looking at.
export function playerRoomRect(world: World, anchorBoardId: BoardId): PeekRect | null {
  const board = world.locations[PLAYER_ID]?.board
  if (board === undefined || world.boards[board] === undefined) return null
  const t = boardTransformInAnchor(world, board, anchorBoardId)
  if (t === null) return null
  return { originX: t.originX, originY: t.originY, scale: world.boards[board].size * t.scale }
}

const EPS = 1e-9
const contains = (outer: PeekRect, inner: PeekRect) =>
  inner.originX >= outer.originX - EPS &&
  inner.originY >= outer.originY - EPS &&
  inner.originX + inner.scale <= outer.originX + outer.scale + EPS &&
  inner.originY + inner.scale <= outer.originY + outer.scale + EPS

// What a tap at screen (sx, sy) means while looking at `view` (the peeked box, or the player's
// room): 'outside' when it lands outside it, a box with a room inside it to peek into (the
// outermost one under the finger, so each tap goes one level deeper), or null.
export function peekTargetAt(
  world: World,
  camera: CameraTransform,
  viewport: Viewport,
  chain: Hit[],
  view: PeekRect,
  sx: number,
  sy: number,
): PeekLevel | 'outside' | null {
  const wx = (sx - viewport.width / 2) / camera.pixelsPerRootUnit + camera.centerX
  const wy = (sy - viewport.height / 2) / camera.pixelsPerRootUnit + camera.centerY
  if (wx < view.originX || wy < view.originY || wx > view.originX + view.scale || wy > view.originY + view.scale) return 'outside'
  let best: Hit | null = null
  for (const hit of chain) {
    if (hit.rect.scale >= view.scale - EPS || !contains(view, hit.rect)) continue
    if (resolveRecursionTarget(world, world.pieces[hit.pieceId]) === null) continue
    if (best === null || hit.rect.scale > best.rect.scale) best = hit
  }
  return best === null ? null : { pieceId: best.pieceId, rect: best.rect }
}
