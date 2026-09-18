import { Board, BoardId, Location, Piece, PieceId, PieceKind, World, findContainerFor, VOID_BOARD_ID } from '../engine/types'
import { CameraTransform, Viewport, worldToScreen } from './camera'
import { BoardTransform, childTransform } from './recursiveTransform'

const FLOOR_COLOR = '#1e293b'
const WALL_COLOR = '#0f172a'
const REQUIREMENT_OVERLAY: Record<'box' | 'player', string> = {
  box: '#334155',
  player: '#4c1d95',
}
const PIECE_COLORS: Record<PieceKind, string> = {
  normal: '#f59e0b',
  container: '#38bdf8',
  player: '#f472b6',
}
// A container that's part of a containment cycle (a self-loop, or a longer
// ring of several containers each owning the next) isn't a distinct
// PieceKind — see worldEdit.ts's placeSelfLoopBox and rules.ts's cycle
// detection. It still needs a visibly different color from an ordinary
// container: pushing it (or anything else) flush against the edge that
// closes the ring resolves to infinite recursion (see sendToVoid in
// types.ts) and sends it to the Void, locked — rendering it identically to
// a harmless container would make that outcome invisible until it happens.
// This is a visual distinction AID, not a uniqueness guarantee: for a ring
// bigger than the palette, or on a hash collision, two members can share a
// color. Every level this codebase ships has at most two cycle members.
const CYCLE_PALETTE = ['#ef4444', '#eab308', '#a855f7', '#14b8a6', '#f97316']
const LOCKED_RING_COLOR = '#e2e8f0' // pale slate/white — reads as "frozen", stays visually distinct from every PIECE_COLORS and CYCLE_PALETTE entry (all of which are saturated hues), unlike the previous yellow-400 which was a near-miss against CYCLE_PALETTE's yellow-500
const INFINITY_MARKER_COLOR = '#0f172a' // dark, readable against LOCKED_RING_COLOR's pale fill

export interface RenderBudget {
  minCellPixels: number
  maxCellsPerFrame: number
  maxRecursionDepth: number
  targetPlayerCellPixels: number
}

export const DEFAULT_RENDER_BUDGET: RenderBudget = {
  minCellPixels: 4,
  maxCellsPerFrame: 4000,
  maxRecursionDepth: 48,
  targetPlayerCellPixels: 64,
}

export interface BoardPieceEntry {
  pieceId: PieceId
  location: Location
}
export type PiecesByBoard = Map<BoardId, BoardPieceEntry[]>

export function indexPiecesByBoard(world: World): PiecesByBoard {
  const index: PiecesByBoard = new Map()
  for (const [pieceId, location] of Object.entries(world.locations)) {
    const entries = index.get(location.board)
    if (entries) {
      entries.push({ pieceId, location })
    } else {
      index.set(location.board, [{ pieceId, location }])
    }
  }
  return index
}

interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

function intersectsViewport(rect: ScreenRect, viewport: Viewport): boolean {
  return rect.right > 0 && rect.left < viewport.width && rect.bottom > 0 && rect.top < viewport.height
}

function isCycleMember(pieceId: PieceId, world: World): boolean {
  const piece = world.pieces[pieceId]
  if (piece.kind !== 'container' || piece.boardRef === undefined) return false
  const start = piece.boardRef
  let current: BoardId = start
  const seen = new Set<BoardId>()
  while (!seen.has(current)) {
    seen.add(current)
    const owner = findContainerFor(world, current)
    if (owner === undefined) return false
    const ownerLoc = world.locations[owner]
    if (ownerLoc === undefined) return false
    current = ownerLoc.board
  }
  return current === start
}

function cycleColorFor(pieceId: PieceId): string {
  let hash = 0
  for (const ch of pieceId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return CYCLE_PALETTE[hash % CYCLE_PALETTE.length]
}

// Legacy flat renderer: draws exactly one board, 1:1, at the canvas origin — no
// recursion, no camera/viewport. Kept permanently for EditorScreen.tsx's board
// preview, which the spec's "Explicitly out of scope" section keeps on this simpler
// path rather than adopting the camera-driven recursive renderer. GameScreen.tsx is
// the one switching to drawBoardRecursive (Task 6).
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  world: World,
  cellSize: number,
): void {
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      const cell = board.cells[y][x]
      ctx.fillStyle = cell.type === 'wall' ? WALL_COLOR : FLOOR_COLOR
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)

      if (cell.requirement) {
        ctx.fillStyle = REQUIREMENT_OVERLAY[cell.requirement]
        const inset = cellSize / 4
        ctx.fillRect(x * cellSize + inset, y * cellSize + inset, cellSize - inset * 2, cellSize - inset * 2)
      }
    }
  }

  for (const [pieceId, location] of Object.entries(world.locations)) {
    if (location.board !== board.id) continue
    const piece = world.pieces[pieceId]
    // An infinite destination (piece.infiniteFor set) has no cycle membership
    // or kind of its own worth rendering — it's colored as whichever real
    // piece it represents.
    const colorSourceId = piece.infiniteFor ?? pieceId
    const colorSource = piece.infiniteFor !== undefined ? world.pieces[piece.infiniteFor] : piece
    ctx.fillStyle = isCycleMember(colorSourceId, world) ? cycleColorFor(colorSourceId) : PIECE_COLORS[colorSource.kind]
    ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
    // A piece "is locked" exactly when it's standing in the Void (see
    // isInVoid in types.ts) — every piece this loop reaches has already been
    // filtered to location.board === board.id, so board.id === VOID_BOARD_ID
    // here means this particular piece is in the Void too.
    if (board.id === VOID_BOARD_ID) {
      ctx.save()
      ctx.strokeStyle = LOCKED_RING_COLOR
      ctx.lineWidth = Math.max(2, cellSize / 8)
      const inset = ctx.lineWidth / 2
      ctx.strokeRect(
        location.x * cellSize + inset,
        location.y * cellSize + inset,
        cellSize - inset * 2,
        cellSize - inset * 2,
      )
      if (piece.infiniteFor !== undefined) {
        ctx.fillStyle = INFINITY_MARKER_COLOR
        ctx.font = `${Math.floor(cellSize / 2)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('∞', location.x * cellSize + cellSize / 2, location.y * cellSize + cellSize / 2)
      }
      ctx.restore()
    }
  }
}

export interface DrawContext {
  ctx: CanvasRenderingContext2D
  world: World
  camera: CameraTransform
  viewport: Viewport
  budget: RenderBudget
  piecesByBoard: PiecesByBoard
  cellsDrawnSoFar: { count: number }
}

export function drawBoardRecursive(
  dc: DrawContext,
  board: Board,
  transform: BoardTransform,
  recursionDepth: number,
  tintAmount: number,
  mirrorH: boolean,
): void {
  if (dc.cellsDrawnSoFar.count >= dc.budget.maxCellsPerFrame) return
  if (recursionDepth >= dc.budget.maxRecursionDepth) return
  if (!Number.isFinite(transform.scale) || transform.scale <= 0) return

  const screenCellSize = transform.scale * dc.camera.pixelsPerRootUnit
  const boardTopLeft = worldToScreen(transform.originX, transform.originY, dc.camera, dc.viewport)
  const boardBottomRight = worldToScreen(
    transform.originX + board.size * transform.scale,
    transform.originY + board.size * transform.scale,
    dc.camera,
    dc.viewport,
  )
  const boardRect: ScreenRect = { left: boardTopLeft.x, top: boardTopLeft.y, right: boardBottomRight.x, bottom: boardBottomRight.y }
  if (!intersectsViewport(boardRect, dc.viewport)) return

  const mirrorX = (x: number) => (mirrorH ? board.size - 1 - x : x)

  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      const screen = worldToScreen(
        transform.originX + mirrorX(x) * transform.scale,
        transform.originY + y * transform.scale,
        dc.camera,
        dc.viewport,
      )
      const cellRect: ScreenRect = { left: screen.x, top: screen.y, right: screen.x + screenCellSize, bottom: screen.y + screenCellSize }
      if (!intersectsViewport(cellRect, dc.viewport)) continue
      if (dc.cellsDrawnSoFar.count >= dc.budget.maxCellsPerFrame) return
      dc.cellsDrawnSoFar.count++

      const cell = board.cells[y][x]
      dc.ctx.fillStyle = applyTint(cell.type === 'wall' ? WALL_COLOR : FLOOR_COLOR, tintAmount)
      dc.ctx.fillRect(cellRect.left, cellRect.top, screenCellSize, screenCellSize)
      if (cell.requirement) {
        dc.ctx.fillStyle = applyTint(REQUIREMENT_OVERLAY[cell.requirement], tintAmount)
        const inset = screenCellSize / 4
        dc.ctx.fillRect(cellRect.left + inset, cellRect.top + inset, screenCellSize - inset * 2, screenCellSize - inset * 2)
      }
    }
  }

  const entries = dc.piecesByBoard.get(board.id) ?? []
  for (const { pieceId, location } of entries) {
    const piece = dc.world.pieces[pieceId]
    const screen = worldToScreen(
      transform.originX + mirrorX(location.x) * transform.scale,
      transform.originY + location.y * transform.scale,
      dc.camera,
      dc.viewport,
    )
    const pieceRect: ScreenRect = { left: screen.x, top: screen.y, right: screen.x + screenCellSize, bottom: screen.y + screenCellSize }
    if (!intersectsViewport(pieceRect, dc.viewport)) continue

    // An infinite destination (piece.infiniteFor set) has no cycle membership
    // or kind of its own worth rendering — it's colored as whichever real
    // piece it represents.
    const colorSourceId = piece.infiniteFor ?? pieceId
    const colorSource = piece.infiniteFor !== undefined ? dc.world.pieces[piece.infiniteFor] : piece
    const baseColor = isCycleMember(colorSourceId, dc.world) ? cycleColorFor(colorSourceId) : PIECE_COLORS[colorSource.kind]
    dc.ctx.fillStyle = applyTint(baseColor, tintAmount)
    dc.ctx.fillRect(pieceRect.left, pieceRect.top, screenCellSize, screenCellSize)
    // A piece "is locked" exactly when it's standing in the Void (see
    // isInVoid in types.ts) — every piece this loop reaches has already been
    // filtered to piecesByBoard's grouping by board.id, so board.id ===
    // VOID_BOARD_ID here means this particular piece is in the Void too.
    if (board.id === VOID_BOARD_ID) {
      dc.ctx.save()
      dc.ctx.strokeStyle = LOCKED_RING_COLOR
      dc.ctx.lineWidth = Math.max(2, screenCellSize / 8)
      const ringInset = dc.ctx.lineWidth / 2
      dc.ctx.strokeRect(pieceRect.left + ringInset, pieceRect.top + ringInset, screenCellSize - ringInset * 2, screenCellSize - ringInset * 2)
      if (piece.infiniteFor !== undefined) {
        dc.ctx.fillStyle = INFINITY_MARKER_COLOR
        dc.ctx.font = `${Math.floor(screenCellSize / 2)}px sans-serif`
        dc.ctx.textAlign = 'center'
        dc.ctx.textBaseline = 'middle'
        dc.ctx.fillText('∞', pieceRect.left + screenCellSize / 2, pieceRect.top + screenCellSize / 2)
      }
      dc.ctx.restore()
    }

    const target = resolveRecursionTarget(dc.world, piece)
    if (target !== null && screenCellSize >= dc.budget.minCellPixels) {
      const childBoard = dc.world.boards[target.boardId]
      if (childBoard !== undefined) {
        const childT = childTransform(transform, location, childBoard)
        drawBoardRecursive(
          dc, childBoard, childT, recursionDepth + 1,
          combineTint(tintAmount, target.tintAmount),
          mirrorH !== target.mirrorH,
        )
      }
    }

    if (piece.kind === 'container' && piece.linkedTo !== undefined) {
      dc.ctx.save()
      dc.ctx.strokeStyle = LINKED_BORDER_COLOR
      dc.ctx.lineWidth = Math.max(2, screenCellSize / 10)
      const inset = dc.ctx.lineWidth / 2
      dc.ctx.strokeRect(pieceRect.left + inset, pieceRect.top + inset, screenCellSize - inset * 2, screenCellSize - inset * 2)
      dc.ctx.restore()
    }
  }
}

export const LINKED_BORDER_COLOR = '#22d3ee' // cyan — distinct from every PIECE_COLORS/CYCLE_PALETTE/LOCKED_RING_COLOR entry

export interface RecursionTarget {
  boardId: BoardId
  tintAmount: number
  mirrorH: boolean
}

export function resolveRecursionTarget(world: World, piece: Piece): RecursionTarget | null {
  if (piece.cloneOf !== undefined) {
    const mainBodyLoc = world.locations[piece.cloneOf]
    const mainBody = world.pieces[piece.cloneOf]
    if (mainBodyLoc === undefined || mainBody === undefined) return null
    // The clone's OWN fliph is inert for gameplay (tryEnter's cloneOf interception
    // returns before into.fliph is ever read) — using it here would render a mirrored
    // peek that lies about a real entry. The main body's own fliph is what actually
    // mirrors its interior.
    return { boardId: mainBodyLoc.board, tintAmount: 0.35, mirrorH: mainBody.fliph ?? false }
  }
  if (piece.boardRef === undefined) return null
  return { boardId: piece.boardRef, tintAmount: 0, mirrorH: piece.fliph ?? false }
}

export function combineTint(parent: number, local: number): number {
  return 1 - (1 - parent) * (1 - local)
}

// Alpha-blend toward white. amount 0 = unchanged; used for Clone's paler tint.
function applyTint(hexColor: string, amount: number): string {
  if (amount <= 0) return hexColor
  const r = parseInt(hexColor.slice(1, 3), 16)
  const g = parseInt(hexColor.slice(3, 5), 16)
  const b = parseInt(hexColor.slice(5, 7), 16)
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}
