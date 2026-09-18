import { PLAYER_ID, World, isInVoid } from '../engine/types'
import { CameraAnchor, resolveCanonicalBoardTransform } from './recursiveTransform'

export interface Viewport {
  width: number
  height: number
}

export interface CameraTransform {
  centerX: number
  centerY: number
  pixelsPerRootUnit: number
  anchor: CameraAnchor
}

export interface CameraBudget {
  targetPlayerCellPixels: number
}

const MIN_ZOOM = 4
const MAX_ZOOM = 4096

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

export function cameraFallbackForAnchor(anchor: CameraAnchor, targetPlayerCellPixels: number): CameraTransform {
  return { anchor, centerX: 0.5, centerY: 0.5, pixelsPerRootUnit: clampCameraZoom(targetPlayerCellPixels) }
}

export function cameraForPlayer(world: World, budget: CameraBudget): CameraTransform {
  const anchor: CameraAnchor = isInVoid(world, PLAYER_ID) ? 'void' : 'root'
  const playerLoc = world.locations[PLAYER_ID]
  if (playerLoc === undefined) return cameraFallbackForAnchor(anchor, budget.targetPlayerCellPixels)

  const boardTransform = resolveCanonicalBoardTransform(world, playerLoc.board, anchor)
  if (boardTransform === null) return cameraFallbackForAnchor(anchor, budget.targetPlayerCellPixels)

  const centerX = boardTransform.originX + (playerLoc.x + 0.5) * boardTransform.scale
  const centerY = boardTransform.originY + (playerLoc.y + 0.5) * boardTransform.scale
  const targetZoom = budget.targetPlayerCellPixels / boardTransform.scale

  return { anchor, centerX, centerY, pixelsPerRootUnit: clampCameraZoom(targetZoom) }
}
