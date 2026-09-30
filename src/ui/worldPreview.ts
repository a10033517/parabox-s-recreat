import { BoardId, World } from '../game/engine/types'
import { DEFAULT_RENDER_BUDGET, DrawContext, drawBoardRecursive, indexPiecesByBoard } from '../game/render/CanvasRenderer'
import { resolveAnchorBoardId, resolveDrawRoot } from '../game/render/recursiveTransform'

// Draws a whole level (its top board, centred, with a thin margin) into a canvas — for the
// level-select thumbnails and the menu's animated hero. zoom > 1 magnifies around (cx, cy),
// given in the top board's own cell units (default: the board centre).
export function drawWorldPreview(
  canvas: HTMLCanvasElement,
  world: World,
  options: { zoom?: number; cx?: number; cy?: number; margin?: number } = {},
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const rect = canvas.getBoundingClientRect()
  const cssWidth = rect.width || canvas.width
  const cssHeight = rect.height || canvas.height
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const width = Math.round(cssWidth * dpr)
  const height = Math.round(cssHeight * dpr)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const anchor: BoardId | null = resolveAnchorBoardId(world, 'root')
  if (anchor === null || world.boards[anchor] === undefined) return
  const size = world.boards[anchor].size
  const margin = options.margin ?? 0.25
  const viewport = { width: cssWidth, height: cssHeight }
  const camera = {
    anchor: 'root' as const,
    centerX: options.cx ?? size / 2,
    centerY: options.cy ?? size / 2,
    pixelsPerRootUnit: (Math.min(cssWidth, cssHeight) / (size + 2 * margin)) * (options.zoom ?? 1),
  }
  try {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0b0b0b'
    ctx.fillRect(0, 0, cssWidth, cssHeight)
    const dc: DrawContext = {
      ctx,
      world,
      camera,
      viewport,
      budget: DEFAULT_RENDER_BUDGET,
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
    }
    const root = resolveDrawRoot(world, anchor)
    drawBoardRecursive(dc, world.boards[root.boardId], root, 0, 0, false)
  } catch {
    // A preview is decoration only: a canvas stub without the full 2D API (tests) draws nothing.
  }
}
