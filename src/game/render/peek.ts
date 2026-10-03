import { BoardId, PLAYER_ID, PieceId, World } from '../engine/types'
import { CameraTransform, Viewport } from './camera'
import { resolveRecursionTarget } from './CanvasRenderer'
import { Hit } from './hitTest'
import { boardTransformInAnchor } from './recursiveTransform'

// Peeking into a box: the game's own camera zooms in on a box the player taps, framed the way
// the game frames a box the player has walked into. Tapping a box inside goes one level deeper,
// tapping outside the box comes back out one level, and a move returns to the normal view —
// unless the player is in the room being looked at (a box that contains itself shows the
// player's own room), then the peek stays.

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

// Where each box of a peek path (outermost first) is drawn now, in camera units: the first from
// its own location in the anchor's space, each next one inside the room of the one before
// (mirrored where that room is). Recomputed every frame, so a pushed box is followed. Null when
// the path no longer holds (a box gone, or no longer inside the one before).
export function peekRects(world: World, anchorBoardId: BoardId, path: PieceId[]): PeekRect[] | null {
  const rects: PeekRect[] = []
  let parent: { rect: PeekRect; room: BoardId; mirrorH: boolean } | null = null
  for (const pieceId of path) {
    const piece = world.pieces[pieceId]
    const loc = world.locations[pieceId]
    const board = loc === undefined ? undefined : world.boards[loc.board]
    if (piece === undefined || loc === undefined || board === undefined) return null
    let rect: PeekRect
    let mirrorH: boolean
    if (parent === null) {
      const t = boardTransformInAnchor(world, loc.board, anchorBoardId)
      if (t === null) return null
      mirrorH = t.mirrorH === true
      const x = mirrorH ? board.size - 1 - loc.x : loc.x
      rect = { originX: t.originX + x * t.scale, originY: t.originY + loc.y * t.scale, scale: t.scale }
    } else {
      if (loc.board !== parent.room) return null
      mirrorH = parent.mirrorH
      const cell = parent.rect.scale / board.size
      const x = mirrorH ? board.size - 1 - loc.x : loc.x
      rect = { originX: parent.rect.originX + x * cell, originY: parent.rect.originY + loc.y * cell, scale: cell }
    }
    const target = resolveRecursionTarget(world, piece)
    if (target === null) return null
    rects.push(rect)
    parent = { rect, room: target.boardId, mirrorH: mirrorH !== target.mirrorH }
  }
  return rects
}

// Whether the player is in the room of the box being looked at — then moving keeps the peek.
export function playerInPeekedRoom(world: World, pieceId: PieceId | undefined): boolean {
  if (pieceId === undefined || world.pieces[pieceId] === undefined) return false
  const target = resolveRecursionTarget(world, world.pieces[pieceId])
  return target !== null && world.locations[PLAYER_ID]?.board === target.boardId
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
