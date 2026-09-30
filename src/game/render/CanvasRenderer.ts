import { Board, BoardId, Location, Piece, PieceId, PieceKind, World, findContainerFor, VOID_BOARD_ID } from '../engine/types'
import { CameraTransform, Viewport, worldToScreen } from './camera'
import { BoardTransform } from './recursiveTransform'

// Look modelled on the original game (user-supplied screenshots): every board is drawn in its
// host box's own color — walls a slightly lighter shade of it, floor a dark shade — and the
// top-level board uses a neutral light gray (light walls, dark gray floor).
const ROOT_HOST_COLOR = '#d4d4d4'
export const FLOOR_COLOR = shade(ROOT_HOST_COLOR, -0.58)
const WALL_COLOR = shade(ROOT_HOST_COLOR, 0.12)
const OUTLINE_COLOR = '#141414'
const WALL_SHADOW = 'rgba(0,0,0,0.28)'
const EYE_COLOR = '#2a0016'
const EYE_COLOR_ON_INTERIOR = '#ffd6ec'
const POSSESSABLE_EYE_COLOR = 'rgba(0,0,0,0.28)'
// The Void (7x7, walled by its own edge): black, a pale border, faint drifting squares.
const VOID_FLOOR_COLOR = '#000000'
const VOID_BORDER_COLOR = '#8a8a8a'
const VOID_STAR_COLOR = '#4b4b4b'
export const EPSILON_COLOR = '#1f8f4a' // green ε box, as in the original
// Goal markers: a pale outlined square on the floor (the player goal also gets two eye dots).
export const REQUIREMENT_OVERLAY: Record<'box' | 'player', string> = {
  box: '#cfcfcf',
  player: '#e6e6e6',
}
export const PIECE_COLORS: Record<PieceKind, string> = {
  normal: '#ffb236',
  container: '#3d9bff',
  player: '#c4006f',
}

// Mixes a #rrggbb color toward white (amount > 0) or black (amount < 0).
function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0
  const a = Math.abs(amount)
  const ch = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - a) + target * a)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return '#' + toHex(ch(1)) + toHex(ch(3)) + toHex(ch(5))
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
const CYCLE_PALETTE = ['#e8433f', '#e6c229', '#9b5de5', '#1fb5a3', '#ff7a2f']
const LOCKED_RING_COLOR = '#e2e8f0' // pale slate/white — reads as "frozen", stays visually distinct from every PIECE_COLORS and CYCLE_PALETTE entry (all of which are saturated hues), unlike the previous yellow-400 which was a near-miss against CYCLE_PALETTE's yellow-500
// Outline strokes (lock ring, Void border, linkedTo border) scale with the cell but stay within
// [2, 6] screen pixels. Unclamped, a piece the camera is INSIDE (e.g. a self-loop box pushed into
// the Void with the player still in it) spans hundreds of pixels, and a cell/8 ring grew thick
// enough to hide the player's own edge row (user-reported, 2026-09-24).
const MAX_OUTLINE_PIXELS = 6
function outlineWidth(scaled: number): number {
  return Math.min(MAX_OUTLINE_PIXELS, Math.max(2, scaled))
}
const INFINITY_MARKER_COLOR = '#f5f5f5' // pale: every board floor is a dark shade of its box color

export interface RenderBudget {
  minCellPixels: number
  maxCellsPerFrame: number
  maxRecursionDepth: number
  // Camera framing: cells of the outer board shown around the player's box (see camera.ts).
  marginCells: number
}

export const DEFAULT_RENDER_BUDGET: RenderBudget = {
  minCellPixels: 2, // low enough that a self-loop box on screen still shows its own interior
  maxCellsPerFrame: 4000,
  maxRecursionDepth: 48,
  marginCells: 1,
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
    // Locked = "can only be exited or pushed, never entered": a piece standing in the Void
    // (see isInVoid in types.ts — every piece this loop reaches has already been filtered to
    // location.board === board.id, so board.id === VOID_BOARD_ID means THIS piece is in the
    // Void too), OR a level-authored infExit ∞ box wherever it stands (confirmed by direct
    // user correction, 2026-09-22: an ∞ box is itself the RESULT of being pushed out of an
    // infinite chain, so it can never be entered — see tryEnter's own infExit check).
    if (board.id === VOID_BOARD_ID || piece.infExit === true) {
      ctx.save()
      ctx.strokeStyle = LOCKED_RING_COLOR
      ctx.lineWidth = lockRingWidth(cellSize)
      const inset = ctx.lineWidth / 2
      ctx.strokeRect(
        location.x * cellSize + inset,
        location.y * cellSize + inset,
        cellSize - inset * 2,
        cellSize - inset * 2,
      )
      const glyph = paradoxGlyph(piece)
      if (glyph !== null) {
        const rect = { left: location.x * cellSize, top: location.y * cellSize, right: (location.x + 1) * cellSize, bottom: (location.y + 1) * cellSize }
        drawParadoxBadgeStack(ctx, rect, { glyph, count: voidParadoxCount(piece) })
      }
      ctx.restore()
    }
  }
}

// Deterministic scatter (no RNG, so a frame never flickers): a few dim squares of varying size,
// plus the Void's boundary line. Purely decorative — the Void's 7x7 edge is what stops movement.
function drawVoidBackdrop(dc: DrawContext, board: Board, transform: BoardTransform, screenCellSize: number): void {
  const topLeft = worldToScreen(transform.originX, transform.originY, dc.camera, dc.viewport)
  const side = screenCellSize * board.size
  // Only fillRect / fillStyle are used (no save/restore, no stroke): every piece draw below sets
  // its own fillStyle, and the lock-ring code owns strokeRect / save / restore.
  dc.ctx.fillStyle = VOID_STAR_COLOR
  for (let i = 0; i < 24; i++) {
    const fx = ((i * 7919) % 97) / 97
    const fy = ((i * 104729) % 89) / 89
    const size = screenCellSize * (0.08 + (((i * 31) % 7) / 7) * 0.22)
    dc.ctx.fillRect(topLeft.x + fx * (side - size), topLeft.y + fy * (side - size), size, size)
  }
  dc.ctx.fillStyle = VOID_BORDER_COLOR
  const t = outlineWidth(screenCellSize / 24)
  dc.ctx.fillRect(topLeft.x, topLeft.y, side, t)
  dc.ctx.fillRect(topLeft.x, topLeft.y + side - t, side, t)
  dc.ctx.fillRect(topLeft.x, topLeft.y, t, side)
  dc.ctx.fillRect(topLeft.x + side - t, topLeft.y, t, side)
}

export interface DrawContext {
  ctx: CanvasRenderingContext2D
  world: World
  camera: CameraTransform
  viewport: Viewport
  budget: RenderBudget
  piecesByBoard: PiecesByBoard
  cellsDrawnSoFar: { count: number }
  getRenderLocation?: (pieceId: PieceId) => Location | undefined
  // Presentation-only per-piece scale 0..1 (ε spawn animation). Absent / 1 = drawn normally.
  getPieceScale?: (pieceId: PieceId) => number
  // Presentation-only horizontal scale -1..1 while a piece flips (fliph changed this move).
  getPieceFlipScale?: (pieceId: PieceId) => number
  // Pieces skipped by the board draw (the caller draws them itself, e.g. mid-move between boards).
  hiddenPieces?: ReadonlySet<PieceId>
}

// A piece the level author flagged infExit/infEnter shows a STATIC badge: infExitNum/
// infEnterNum + 1 paradox glyphs stacked in its own cell — "0 = 1 infinity", "0 = 1 epsilon"
// per the tooltips in Parafox (a third-party GameMaker editor for the official format;
// iwVerve/Parafox, objRef/Create_0.gml — see docs/engine-official-audit.md). Its own draw()
// confirms the model precisely: the Ref's real recursive content is drawn UNCONDITIONALLY
// (same depth/size budget as any container, no special early cutoff), and the badge stack is
// then overlaid on top, unconditionally, regardless of degree or remaining budget. This
// SUPERSEDES an earlier reading of a single real-game screenshot that assumed recursion was
// cut off after N real nested copies in favor of ONE glyph — that read a screenshot's limited
// resolution as nested boxes where the simpler, source-code-confirmed explanation is: one box,
// showing infExitNum+1 stacked badges over its own ordinary (budget-bounded) recursive content.
function staticParadoxBadge(piece: Piece): { glyph: string; count: number } | null {
  if (piece.infExit === true) return { glyph: '∞', count: (piece.infExitNum ?? 0) + 1 }
  if (piece.infEnter === true) return { glyph: 'ε', count: (piece.infEnterNum ?? 0) + 1 }
  return null
}

// Draws `badge.count` copies of badge.glyph stacked in equal vertical bands filling `rect`,
// mirroring Parafox's own layout (lerp into count bands, one glyph per band, narrower than the
// full cell width) — an unconditional decoration, independent of recursion/budget state.
function drawParadoxBadgeStack(
  ctx: CanvasRenderingContext2D,
  rect: ScreenRect,
  badge: { glyph: string; count: number },
): void {
  const bandHeight = (rect.bottom - rect.top) / badge.count
  const fontSize = Math.max(1, Math.floor(Math.min(bandHeight * 0.9, (rect.right - rect.left) * 0.7)))
  ctx.fillStyle = INFINITY_MARKER_COLOR
  ctx.font = `${fontSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const centerX = (rect.left + rect.right) / 2
  for (let i = 0; i < badge.count; i++) {
    ctx.fillText(badge.glyph, centerX, rect.top + bandHeight * (i + 0.5))
  }
}

export function drawBoardRecursive(
  dc: DrawContext,
  board: Board,
  transform: BoardTransform,
  recursionDepth: number,
  tintAmount: number,
  mirrorH: boolean,
  // The color of the box this board is drawn inside (its walls and floor are shades of it).
  hostColor: string = ROOT_HOST_COLOR,
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
  // A top-level board with an authored color (official levels) uses it as its own host color.
  if (recursionDepth === 0 && board.color !== undefined) hostColor = board.color
  const wallColor = hostColor === ROOT_HOST_COLOR ? WALL_COLOR : shade(hostColor, 0.12)
  const floorColor = hostColor === ROOT_HOST_COLOR ? FLOOR_COLOR : shade(hostColor, -0.55)

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
      dc.ctx.fillStyle = applyTint(
        cell.type === 'wall' ? wallColor : board.id === VOID_BOARD_ID ? VOID_FLOOR_COLOR : floorColor,
        tintAmount,
      )
      // +0.5px overlap hides the anti-aliasing seams between neighbouring cells.
      dc.ctx.fillRect(cellRect.left, cellRect.top, screenCellSize + 0.5, screenCellSize + 0.5)
      if (cell.type === 'floor' && board.id !== VOID_BOARD_ID) {
        // Walls cast a short shadow onto the floor below / right of them (depth, as in the original).
        // Drawn as a path, not fillRect, so fillRect stays one call per cell / goal / piece.
        const wallAbove = y > 0 && board.cells[y - 1][x].type === 'wall'
        const leftX = mirrorH ? x + 1 : x - 1
        const wallLeft = leftX >= 0 && leftX < board.size && board.cells[y][leftX].type === 'wall'
        if (wallAbove || wallLeft) {
          const band = screenCellSize * 0.14
          dc.ctx.fillStyle = WALL_SHADOW
          dc.ctx.beginPath()
          if (wallAbove) dc.ctx.rect(cellRect.left, cellRect.top, screenCellSize, band)
          if (wallLeft) dc.ctx.rect(cellRect.left, cellRect.top + (wallAbove ? band : 0), band, screenCellSize - (wallAbove ? band : 0))
          dc.ctx.fill()
        }
      }
      if (cell.requirement) {
        // Outlined square: the outer square is a fillRect, the hole is punched with the floor color.
        dc.ctx.fillStyle = applyTint(REQUIREMENT_OVERLAY[cell.requirement], tintAmount)
        const inset = screenCellSize * 0.14
        dc.ctx.fillRect(cellRect.left + inset, cellRect.top + inset, screenCellSize - inset * 2, screenCellSize - inset * 2)
        const ring = Math.max(1, screenCellSize * 0.06)
        dc.ctx.fillStyle = applyTint(floorColor, tintAmount)
        dc.ctx.beginPath()
        dc.ctx.rect(cellRect.left + inset + ring, cellRect.top + inset + ring, screenCellSize - (inset + ring) * 2, screenCellSize - (inset + ring) * 2)
        dc.ctx.fill()
        if (cell.requirement === 'player') drawEyes(dc.ctx, cellRect, screenCellSize, applyTint(REQUIREMENT_OVERLAY.player, tintAmount))
      }
    }
  }

  if (board.id === VOID_BOARD_ID) drawVoidBackdrop(dc, board, transform, screenCellSize)

  const entries = dc.piecesByBoard.get(board.id) ?? []
  for (const { pieceId, location: storedLocation } of entries) {
    if (dc.hiddenPieces?.has(pieceId)) continue // drawn separately (a move across boards)
    const location = dc.getRenderLocation?.(pieceId) ?? storedLocation
    const cell: CellPlacement = {
      originX: transform.originX + mirrorX(location.x) * transform.scale,
      originY: transform.originY + location.y * transform.scale,
      scale: transform.scale,
    }
    drawPiece(dc, pieceId, cell, board.id, recursionDepth, tintAmount, mirrorH)
  }
}

// Where one piece is drawn: its cell's top-left corner and size, in anchor units.
export interface CellPlacement {
  originX: number
  originY: number
  scale: number
}

// Draws one piece (shell, recursive interior, decorations) in `cell`. onBoardId is the board
// it stands on (a piece in the Void is drawn locked); mirrorH is that board's own mirroring.
// A piece mid-flip (dc.getPieceFlipScale) is squeezed horizontally around its centre.
export function drawPiece(
  dc: DrawContext,
  pieceId: PieceId,
  cell: CellPlacement,
  onBoardId: BoardId,
  recursionDepth: number,
  tintAmount: number,
  mirrorH: boolean,
): void {
  const flipScale = dc.getPieceFlipScale?.(pieceId) ?? 1
  if (flipScale === 1) {
    drawPieceBody(dc, pieceId, cell, onBoardId, recursionDepth, tintAmount, mirrorH)
    return
  }
  const centreX = worldToScreen(cell.originX + cell.scale / 2, cell.originY, dc.camera, dc.viewport).x
  const sx = Math.abs(flipScale) < 0.02 ? Math.sign(flipScale || 1) * 0.02 : flipScale
  dc.ctx.save()
  dc.ctx.translate(centreX, 0)
  dc.ctx.scale(sx, 1)
  dc.ctx.translate(-centreX, 0)
  drawPieceBody(dc, pieceId, cell, onBoardId, recursionDepth, tintAmount, mirrorH)
  dc.ctx.restore()
}

function drawPieceBody(
  dc: DrawContext,
  pieceId: PieceId,
  cell: CellPlacement,
  onBoardId: BoardId,
  recursionDepth: number,
  tintAmount: number,
  mirrorH: boolean,
): void {
  const piece = dc.world.pieces[pieceId]
  const screen = worldToScreen(cell.originX, cell.originY, dc.camera, dc.viewport)
  const screenCellSize = cell.scale * dc.camera.pixelsPerRootUnit
  const pieceScale = dc.getPieceScale?.(pieceId) ?? 1
  if (pieceScale <= 0) return // not yet visible (spawn animation start)
  const pieceRect: ScreenRect = { left: screen.x, top: screen.y, right: screen.x + screenCellSize, bottom: screen.y + screenCellSize }
  if (!intersectsViewport(pieceRect, dc.viewport)) return
  if (pieceScale < 1) {
    // Shrink the piece toward its cell center and fade it; the interior is not recursed
    // while it is still growing.
    const inset = (screenCellSize * (1 - pieceScale)) / 2
    dc.ctx.save()
    dc.ctx.globalAlpha = pieceScale
    dc.ctx.fillStyle = applyTint(PIECE_COLORS[piece.kind], tintAmount)
    dc.ctx.fillRect(pieceRect.left + inset, pieceRect.top + inset, screenCellSize * pieceScale, screenCellSize * pieceScale)
    const growingGlyph = paradoxGlyph(piece)
    if (growingGlyph !== null) {
      dc.ctx.fillStyle = INFINITY_MARKER_COLOR
      dc.ctx.font = `${Math.floor((screenCellSize * pieceScale) / 2)}px sans-serif`
      dc.ctx.textAlign = 'center'
      dc.ctx.textBaseline = 'middle'
      dc.ctx.fillText(growingGlyph, pieceRect.left + screenCellSize / 2, pieceRect.top + screenCellSize / 2)
    }
    dc.ctx.restore()
    return
  }

  // An infinite destination (piece.infiniteFor set) has no cycle membership
  // or kind of its own worth rendering — it's colored as whichever real
  // piece it represents.
  // A clone takes its source box's color (then drawn lighter, below).
  const cloneSource = piece.cloneOf !== undefined ? dc.world.pieces[piece.cloneOf] : undefined
  const colorSourceId = piece.infiniteFor ?? (cloneSource !== undefined ? cloneSource.id : pieceId)
  const colorSource = piece.infiniteFor !== undefined ? dc.world.pieces[piece.infiniteFor] : cloneSource ?? piece
  const authoredColor = authoredColorOf(dc.world, colorSource)
  const onBoardColor = dc.world.boards[onBoardId]?.color
  const ownColor =
    piece.wall === true
      ? (onBoardColor !== undefined ? shade(onBoardColor, 0.12) : WALL_COLOR) // a wall block looks like the walls around it
      : piece.epsilonFor !== undefined
      ? EPSILON_COLOR
      : authoredColor !== undefined
        ? authoredColor
        : isCycleMember(colorSourceId, dc.world) ? cycleColorFor(colorSourceId) : PIECE_COLORS[colorSource.kind]
  // A clone is drawn in a lighter, brighter shade of its original (user request, 2026-09-25),
  // shell and interior alike (the interior's walls / floor are shades of this color).
  const baseColor = isCloneInstance(dc.world, piece) ? shade(ownColor, CLONE_LIGHTEN) : ownColor
  dc.ctx.fillStyle = applyTint(baseColor, tintAmount)
  dc.ctx.fillRect(pieceRect.left, pieceRect.top, screenCellSize, screenCellSize)

  const target = resolveRecursionTarget(dc.world, piece)
  if (target !== null) {
    const childBoard = dc.world.boards[target.boardId]
    // The cutoff is "one CHILD cell would render smaller than minCellPixels" (spec
    // §2.1), not the current (parent) board's own cell size — screenCellSize here is
    // this piece's cell on the board being drawn now, but recursing one level deeper
    // divides it again by childBoard.size (see childTransform's own scale formula), so
    // that division must happen before the check (final-review I4). This is the ONLY
    // recursion cutoff — infExit/infEnter do not shorten it (see drawParadoxBadgeStack).
    if (childBoard !== undefined && screenCellSize / childBoard.size >= dc.budget.minCellPixels) {
      // Same mirrored x-coordinate used for the piece's own screen position (above)
      // must also be used for where its nested interior is placed — otherwise a
      // container's shell and its recursively-drawn content come apart horizontally
      // whenever mirrorH is true (final-review I1).
      const childT: BoardTransform = { boardId: childBoard.id, originX: cell.originX, originY: cell.originY, scale: cell.scale / childBoard.size }
      drawBoardRecursive(
        dc, childBoard, childT, recursionDepth + 1,
        combineTint(tintAmount, target.tintAmount),
        mirrorH !== target.mirrorH,
        baseColor,
      )
    }
  }
  // A player that is itself a box shows its dark interior floor, so its eyes turn pale.
  if (piece.kind === 'player') drawEyes(dc.ctx, pieceRect, screenCellSize, applyTint(target !== null ? EYE_COLOR_ON_INTERIOR : EYE_COLOR, tintAmount))
  // A block the player could possess shows faint, empty eyes.
  else if (piece.possessable === true) drawEyes(dc.ctx, pieceRect, screenCellSize, POSSESSABLE_EYE_COLOR)
  drawPieceOutline(dc.ctx, pieceRect, screenCellSize)

  // Static paradox badge: an unconditional overlay for a level-authored infExit/infEnter
  // piece, drawn on top of whatever recursive content was (or wasn't) drawn above — see
  // staticParadoxBadge's own comment for why this replaced an earlier depth-cutoff model.
  const badge = staticParadoxBadge(piece)
  if (badge !== null) drawParadoxBadgeStack(dc.ctx, pieceRect, badge)

  // Locked = "can only be exited or pushed, never entered": a piece standing in the Void
  // (see isInVoid in types.ts — every piece this loop reaches has already been filtered to
  // piecesByBoard's grouping by board.id, so board.id === VOID_BOARD_ID means THIS piece is
  // in the Void too), OR a level-authored infExit ∞ box wherever it stands (see the legacy
  // renderBoard's matching comment). Drawn AFTER the recursive call above (like the linkedTo
  // border below) so a recursable interior's own opaque cell fills never paint over it
  // (final-review I2).
  if (onBoardId === VOID_BOARD_ID || piece.infExit === true) {
    dc.ctx.save()
    dc.ctx.strokeStyle = LOCKED_RING_COLOR
    // As thin as the ordinary piece outline, drawn over it: a thicker ring covered the edge
    // cells of the box's own interior (e.g. what was pushed into an ε box in the Void).
    dc.ctx.lineWidth = lockRingWidth(screenCellSize)
    const ringInset = dc.ctx.lineWidth / 2
    dc.ctx.strokeRect(pieceRect.left + ringInset, pieceRect.top + ringInset, screenCellSize - ringInset * 2, screenCellSize - ringInset * 2)
    const glyph = paradoxGlyph(piece)
    if (glyph !== null) drawParadoxBadgeStack(dc.ctx, pieceRect, { glyph, count: voidParadoxCount(piece) })
    dc.ctx.restore()
  }

  if (piece.kind === 'container' && piece.linkedTo !== undefined) {
    dc.ctx.save()
    dc.ctx.strokeStyle = LINKED_BORDER_COLOR
    dc.ctx.lineWidth = outlineWidth(screenCellSize / 10)
    const inset = dc.ctx.lineWidth / 2
    dc.ctx.strokeRect(pieceRect.left + inset, pieceRect.top + inset, screenCellSize - inset * 2, screenCellSize - inset * 2)
    dc.ctx.restore()
  }
}

// How much lighter a clone is drawn than its original.
const CLONE_LIGHTEN = 0.4

// A clone: a legacy cloneOf piece, or a second (or later) Ref instance of a board whose
// canonical owner (findContainerFor — the exitBlock one, as in the official game) is another
// piece. ∞ / ε boxes are not clones: they are marked with their own badge instead.
export function isCloneInstance(world: World, piece: Piece): boolean {
  if (piece.cloneOf !== undefined) return true
  if (piece.kind !== 'container' || piece.boardRef === undefined) return false
  if (piece.infExit === true || piece.infEnter === true || piece.infiniteFor !== undefined || piece.epsilonFor !== undefined) return false
  const canonical = findContainerFor(world, piece.boardRef)
  return canonical !== undefined && canonical !== piece.id
}

// The level's own color for a piece (official levels carry one per block): the piece's own,
// else — for a container / Ref — the color of the board it shows.
function authoredColorOf(world: World, piece: Piece): string | undefined {
  if (piece.color !== undefined) return piece.color
  if (piece.boardRef !== undefined) return world.boards[piece.boardRef]?.color
  return undefined
}

// Width of the pale "locked" ring: the same as the piece outline (drawPieceOutline).
function lockRingWidth(cellSize: number): number {
  return Math.min(4, Math.max(1.5, cellSize * 0.035))
}

// Dark border around every piece (a path, not strokeRect: strokeRect is reserved for state rings).
function drawPieceOutline(ctx: CanvasRenderingContext2D, rect: ScreenRect, cellSize: number): void {
  const w = Math.min(4, Math.max(1, cellSize * 0.03))
  ctx.fillStyle = OUTLINE_COLOR
  ctx.beginPath()
  ctx.rect(rect.left, rect.top, cellSize, w)
  ctx.rect(rect.left, rect.top + cellSize - w, cellSize, w)
  ctx.rect(rect.left, rect.top + w, w, cellSize - 2 * w)
  ctx.rect(rect.left + cellSize - w, rect.top + w, w, cellSize - 2 * w)
  ctx.fill()
}

// Two round eyes, as on the original's player block and player goal.
function drawEyes(ctx: CanvasRenderingContext2D, rect: ScreenRect, cellSize: number, color: string): void {
  if (cellSize < 6) return
  const r = cellSize * 0.075
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(rect.left + cellSize * 0.3, rect.top + cellSize * 0.44, r, 0, Math.PI * 2)
  ctx.moveTo(rect.left + cellSize * 0.7 + r, rect.top + cellSize * 0.44)
  ctx.arc(rect.left + cellSize * 0.7, rect.top + cellSize * 0.44, r, 0, Math.PI * 2)
  ctx.fill()
}

export const LINKED_BORDER_COLOR = '#22d3ee' // cyan — distinct from every PIECE_COLORS/CYCLE_PALETTE/LOCKED_RING_COLOR entry

// One paradox visual for both kinds: ∞ (Infinite Exit destination) and ε (Infinite Enter).
// The simulation decides which pieces are paradox objects; the renderer only picks the glyph
// (a single ε code point, U+03B5, regardless of what any wiki shows).
// How many glyphs a runtime paradox object shows: a Void-spawned ∞ of degree d (infExitNum)
// is ∞ repeated d+1 times (∞, ∞∞, ∞∞∞ ...), same as an authored box of that degree.
function voidParadoxCount(piece: Piece): number {
  return piece.infiniteFor !== undefined ? (piece.infExitNum ?? 0) + 1 : 1
}

export function paradoxGlyph(piece: Piece): string | null {
  if (piece.infiniteFor !== undefined) return '∞'
  if (piece.epsilonFor !== undefined) return 'ε'
  return null
}

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
    // Source with its own interior: the clone shows THAT interior (what entering it enters).
    if ((mainBody.kind === 'container' || mainBody.kind === 'player') && mainBody.boardRef !== undefined && world.boards[mainBody.boardRef] !== undefined) {
      return { boardId: mainBody.boardRef, tintAmount: 0.35, mirrorH: mainBody.fliph ?? false }
    }
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
