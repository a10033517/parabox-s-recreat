import { describe, it, expect } from 'vitest'
import { renderBoard, drawBoardRecursive, indexPiecesByBoard, DEFAULT_RENDER_BUDGET, resolveRecursionTarget, combineTint, FLOOR_COLOR, isCloneInstance } from './CanvasRenderer'
import { CameraTransform, Viewport } from './camera'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from '../engine/testFixtures'
import { PLAYER_ID, World, Board } from '../engine/types'

function mockContext() {
  return {
    fillRect: () => {},
    fillStyle: '',
    strokeRect: () => {},
    strokeStyle: '',
    lineWidth: 0,
    save: () => {},
    restore: () => {},
    font: '',
    textAlign: '',
    textBaseline: '',
    fillText: () => {},
    beginPath: () => {}, rect: () => {}, arc: () => {}, moveTo: () => {}, fill: () => {},
  } as unknown as CanvasRenderingContext2D
}

// Reproduces the old renderBoard(ctx, board, world, cellSize)'s exact framing: draws
// `board` 1:1 (one board cell = cellSize screen pixels), board's own top-left at the
// canvas origin — verified algebraically (worldToScreen(0,0,...) = 0 and
// worldToScreen(size,size,...) = size*cellSize for these camera/viewport values).
function drawBoardForTest(ctx: CanvasRenderingContext2D, board: Board, world: World, cellSize: number) {
  const camera: CameraTransform = {
    anchor: 'root',
    centerX: board.size / 2,
    centerY: board.size / 2,
    pixelsPerRootUnit: cellSize,
  }
  const viewport: Viewport = { width: board.size * cellSize, height: board.size * cellSize }
  const dc = {
    ctx,
    world,
    camera,
    viewport,
    budget: DEFAULT_RENDER_BUDGET,
    piecesByBoard: indexPiecesByBoard(world),
    cellsDrawnSoFar: { count: 0 },
  }
  drawBoardRecursive(dc, board, { boardId: board.id, originX: 0, originY: 0, scale: 1 }, 0, 0, false)
}

describe('renderBoard', () => {
  it('draws one rect per cell for a board with no requirements or pieces', () => {
    const board = makeFloorBoard('root', 3)
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    renderBoard(ctx, board, world, 32)
    expect(calls).toBe(9) // 3x3 cells
  })

  it('draws an extra overlay rect for each cell with a requirement', () => {
    const board = makeFloorBoard('root', 2)
    setRequirement(board, 1, 0, 'box')
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    renderBoard(ctx, board, world, 32)
    expect(calls).toBe(5) // 4 cells + 1 requirement overlay
  })

  it('draws one rect per piece located on the rendered board, and skips pieces on other boards', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'box1', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        box1: { board: 'inside', x: 0, y: 0 }, // on the OTHER board
      },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    renderBoard(ctx, root, world, 32)
    expect(calls).toBe(5) // 4 cells + 1 piece (player only; box1 is on 'inside')
  })

  it('renders a self-loop container with a different fillStyle than a normal container', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 1)
    const world = makeWorld(
      [root, inside],
      [
        { id: 'c1', kind: 'container', boardRef: 'inside' },
        { id: 'c2', kind: 'container', boardRef: 'root' },
      ],
      {
        c1: { board: 'root', x: 0, y: 0 },
        c2: { board: 'root', x: 1, y: 0 }, // self-referencing: boardRef === its own board
      },
    )
    const ctx = mockContext()
    const styles: string[] = []
    ctx.fillRect = () => { styles.push(ctx.fillStyle as string) }
    renderBoard(ctx, root, world, 32)
    // 4 cell draws (2x2, no requirements), then c1 (normal container), then c2 (self-loop)
    expect(styles[5]).not.toBe(styles[4])
  })

  it('uses a different fillStyle for a wall cell than a floor cell', () => {
    const board = makeFloorBoard('root', 2)
    setWall(board, 1, 0)
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    const stylesAtFillTime: string[] = []
    ctx.fillRect = () => { stylesAtFillTime.push(ctx.fillStyle as string) }
    renderBoard(ctx, board, world, 32)
    // cells are visited row-major: (0,0) floor, (1,0) wall, (0,1) floor, (1,1) floor
    expect(stylesAtFillTime[0]).not.toBe(stylesAtFillTime[1])
  })

  it('renders two members of a multi-node cycle in different colors from each other', () => {
    const root = makeFloorBoard('root', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [root, redInterior],
      [
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'root' },
      ],
      {
        redPiece: { board: 'root', x: 0, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )
    const ctx = mockContext()

    const rootStyles: string[] = []
    ctx.fillRect = () => { rootStyles.push(ctx.fillStyle as string) }
    renderBoard(ctx, root, world, 32)
    const redPieceColor = rootStyles[4] // 4 cell draws (2x2), then redPiece (the only piece on root)

    const insideStyles: string[] = []
    ctx.fillRect = () => { insideStyles.push(ctx.fillStyle as string) }
    renderBoard(ctx, redInterior, world, 32)
    const yellowPieceColor = insideStyles[1] // 1 cell draw (size 1), then yellowPiece

    expect(redPieceColor).not.toBe(yellowPieceColor)
    expect(redPieceColor).not.toBe('#3d9bff') // neither is the plain container color
    expect(yellowPieceColor).not.toBe('#3d9bff')
  })

  it('does not color an ordinary container that merely owns an unrelated board, even when a real cycle exists on the same board', () => {
    const root = makeFloorBoard('root', 3)
    const obstacleInside = makeFloorBoard('obstacleInside', 1)
    const world = makeWorld(
      [root, obstacleInside],
      [
        { id: 'loopBox', kind: 'container', boardRef: 'root' }, // genuine self-loop
        { id: 'obstacleContainer', kind: 'container', boardRef: 'obstacleInside' }, // ordinary, unrelated
      ],
      {
        loopBox: { board: 'root', x: 0, y: 0 },
        obstacleContainer: { board: 'root', x: 1, y: 0 },
      },
    )
    const ctx = mockContext()
    const styles: string[] = []
    ctx.fillRect = () => { styles.push(ctx.fillStyle as string) }
    renderBoard(ctx, root, world, 32)
    // 9 cell draws (3x3), then loopBox, then obstacleContainer
    expect(styles[10]).toBe('#3d9bff') // obstacleContainer: plain container color
    expect(styles[9]).not.toBe('#3d9bff') // loopBox: cycle color
  })

  it('draws a gold ring around a locked piece', () => {
    // "Locked" is derived from physically standing on the Void board (see
    // isInVoid in types.ts) — so this fixture places the piece on 'void'
    // itself and renders that board, rather than tagging the piece.
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld(
      [voidBoard],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'void', x: 2, y: 2 } },
    )
    const ctx = mockContext()
    let strokeCalls = 0
    let sawPaleSlateStroke = false
    ctx.strokeRect = () => {
      strokeCalls++
      if (ctx.strokeStyle === '#e2e8f0') sawPaleSlateStroke = true
    }
    renderBoard(ctx, voidBoard, world, 32)
    expect(strokeCalls).toBe(1)
    expect(sawPaleSlateStroke).toBe(true)
  })

  it('keeps the lock ring thin when the camera is zoomed into a Void piece, so it never hides the player inside', () => {
    // User-reported (2026-09-24): a self-loop box pushed into the Void with the player still in
    // it is drawn hundreds of pixels wide; a cellSize/8 ring grew thick enough to cover the
    // player's edge row.
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld([voidBoard], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'void', x: 2, y: 2 } })
    const ctx = mockContext()
    const widths: number[] = []
    ctx.strokeRect = () => { widths.push(ctx.lineWidth) }
    renderBoard(ctx, voidBoard, world, 432)
    expect(widths.length).toBe(1)
    expect(widths[0]).toBeLessThanOrEqual(4) // no thicker than the ordinary piece outline
  })

  it('draws the same gold ring around an infExit-flagged ∞ box even on an ordinary (non-Void) board', () => {
    // Confirmed by direct user correction (2026-09-22): an ∞ box can only be exited or pushed,
    // never entered, wherever it stands — not only while physically in the Void.
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [{ id: 'infBox', kind: 'container', boardRef: 'root', infExit: true }],
      { infBox: { board: 'root', x: 1, y: 1 } },
    )
    const ctx = mockContext()
    let strokeCalls = 0
    let sawPaleSlateStroke = false
    ctx.strokeRect = () => {
      strokeCalls++
      if (ctx.strokeStyle === '#e2e8f0') sawPaleSlateStroke = true
    }
    renderBoard(ctx, root, world, 32)
    expect(strokeCalls).toBe(1)
    expect(sawPaleSlateStroke).toBe(true)
  })

  it('does not draw a ring around a non-locked piece of the same kind', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let strokeCalls = 0
    ctx.strokeRect = () => { strokeCalls++ }
    renderBoard(ctx, root, world, 32)
    expect(strokeCalls).toBe(0)
  })

  it('a voided former cycle member gets the plain container color plus the ring, not the cycle color', () => {
    // Once a self-loop container is physically relocated into the Void, it's
    // structurally disconnected from the containment graph: isCycleMember's
    // walk (boardRef -> owner -> owner's own location -> ...) can no longer
    // find its way back to 'start', because nothing owns the Void board.
    // So a voided piece correctly loses its cycle coloring — it keeps only
    // its plain PIECE_COLORS[kind] fill, plus the lock ring (which is purely
    // board-based, independent of cycle membership).
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld(
      [voidBoard],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root' }],
      { loopBox: { board: 'void', x: 2, y: 2 } },
    )
    const ctx = mockContext()
    let fillStyleAtPieceDraw = ''
    let strokeCalls = 0
    ctx.fillRect = () => { fillStyleAtPieceDraw = ctx.fillStyle as string }
    ctx.strokeRect = () => { strokeCalls++ }
    renderBoard(ctx, voidBoard, world, 32)
    expect(fillStyleAtPieceDraw).toBe('#3d9bff') // plain container color — no longer a cycle member once voided
    expect(strokeCalls).toBe(1) // still gets the ring
  })

  it('restores context state after drawing a locked ring, so it does not bleed into the next piece drawn', () => {
    // Every piece standing on the Void board is locked (see isInVoid), so
    // there's no such thing as an "unlocked piece on the same board" anymore
    // to prove non-leakage against. Instead: two DIFFERENT locked pieces,
    // confirm each gets its own save/restore pair (not fewer than expected,
    // which would mean state bled/got skipped), and confirm the second
    // piece's fill color is unaffected by the first piece's ring-drawing.
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld(
      [voidBoard],
      [
        { id: 'locked1', kind: 'normal' },
        { id: 'locked2', kind: 'container', boardRef: 'someInterior' },
      ],
      {
        locked1: { board: 'void', x: 2, y: 2 },
        locked2: { board: 'void', x: 3, y: 2 },
      },
    )
    const ctx = mockContext()
    let saveCalls = 0
    let restoreCalls = 0
    const pieceFillStyles: string[] = []
    ctx.save = () => { saveCalls++ }
    ctx.restore = () => { restoreCalls++ }
    ctx.strokeRect = () => {}
    ctx.fillRect = () => { pieceFillStyles.push(ctx.fillStyle as string) }
    renderBoard(ctx, voidBoard, world, 32)
    expect(saveCalls).toBe(2)
    expect(restoreCalls).toBe(2) // one save/restore pair per locked piece — neither shared nor skipped
    // pieceFillStyles also records the 25 floor-cell fills before the two
    // piece fills — only the last two entries are the pieces themselves.
    expect(pieceFillStyles.at(-2)).toBe('#ffb236') // locked1: plain 'normal' color
    expect(pieceFillStyles.at(-1)).toBe('#3d9bff') // locked2: plain 'container' color, unaffected by locked1's ring
  })

  it('LOCKED_RING_COLOR does not collide with any known piece or cycle color', () => {
    // Pinned literal comparison, not an import — PIECE_COLORS/CYCLE_PALETTE aren't
    // exported. Catches an exact collision if either palette or the ring color
    // changes later without updating this test. (Does not catch near-miss
    // perceptual similarity, e.g. the yellow-400/yellow-500 pair this replaces —
    // that required a human/reviewer judgment call, not an automatable check.)
    const knownPieceAndCycleColors = [
      '#ffb236', '#3d9bff', '#c4006f', // PIECE_COLORS
      '#e8433f', '#e6c229', '#9b5de5', '#1fb5a3', '#ff7a2f', // CYCLE_PALETTE
    ]
    const LOCKED_RING_COLOR = '#e2e8f0'
    expect(knownPieceAndCycleColors).not.toContain(LOCKED_RING_COLOR)
  })

  it('an infinite destination renders with the color of the real piece it represents, plus the infinity marker', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [voidBoard, root],
      [
        { id: 'realOwner', kind: 'container', boardRef: 'root' }, // self-loop -> a cycle member
        { id: 'void-infinite:realOwner', kind: 'normal', infiniteFor: 'realOwner' },
      ],
      {
        realOwner: { board: 'root', x: 0, y: 0 },
        'void-infinite:realOwner': { board: 'void', x: 2, y: 2 },
      },
    )
    const ctx = mockContext()
    let destinationFillStyle = ''
    let markerDrawn = false
    ctx.fillRect = () => { destinationFillStyle = ctx.fillStyle as string }
    ctx.fillText = (text) => { if (text === '∞') markerDrawn = true }
    renderBoard(ctx, voidBoard, world, 32)
    expect(destinationFillStyle).not.toBe('#3d9bff') // realOwner's cycle color, not the plain container color
    expect(markerDrawn).toBe(true)
  })

  it('an ordinary locked Void piece (no infiniteFor) does not render the infinity marker', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld(
      [voidBoard],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'void', x: 2, y: 2 } },
    )
    const ctx = mockContext()
    let markerDrawn = false
    ctx.fillText = (text) => { if (text === '∞') markerDrawn = true }
    renderBoard(ctx, voidBoard, world, 32)
    expect(markerDrawn).toBe(false)
  })
})

describe('drawBoardRecursive', () => {
  it('draws one rect per cell for a board with no requirements or pieces', () => {
    const board = makeFloorBoard('root', 3)
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    drawBoardForTest(ctx, board, world, 32)
    expect(calls).toBe(9)
  })

  it('draws an extra overlay rect for each cell with a requirement', () => {
    const board = makeFloorBoard('root', 2)
    setRequirement(board, 1, 0, 'box')
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    drawBoardForTest(ctx, board, world, 32)
    expect(calls).toBe(5)
  })

  it('draws one rect per piece located on the rendered board, and skips pieces on other boards', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box1', kind: 'normal' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, box1: { board: 'inside', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    drawBoardForTest(ctx, root, world, 32)
    expect(calls).toBe(5) // 4 cells + player only
  })

  it('renders a self-loop container with a different fillStyle than a normal container', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 1)
    const world = makeWorld(
      [root, inside],
      [{ id: 'c1', kind: 'container', boardRef: 'inside' }, { id: 'c2', kind: 'container', boardRef: 'root' }],
      { c1: { board: 'root', x: 0, y: 0 }, c2: { board: 'root', x: 1, y: 0 } },
    )
    const ctx = mockContext()
    const styles: string[] = []
    ctx.fillRect = () => { styles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, root, world, 32)
    expect(styles[5]).not.toBe(styles[4])
  })

  it('uses a different fillStyle for a wall cell than a floor cell', () => {
    const board = makeFloorBoard('root', 2)
    setWall(board, 1, 0)
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    const stylesAtFillTime: string[] = []
    ctx.fillRect = () => { stylesAtFillTime.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, board, world, 32)
    expect(stylesAtFillTime[0]).not.toBe(stylesAtFillTime[1])
  })

  it('renders two members of a multi-node cycle in different colors from each other', () => {
    const root = makeFloorBoard('root', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [root, redInterior],
      [{ id: 'redPiece', kind: 'container', boardRef: 'redInterior' }, { id: 'yellowPiece', kind: 'container', boardRef: 'root' }],
      { redPiece: { board: 'root', x: 0, y: 0 }, yellowPiece: { board: 'redInterior', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    const rootStyles: string[] = []
    ctx.fillRect = () => { rootStyles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, root, world, 32)
    const redPieceColor = rootStyles[4]

    const insideStyles: string[] = []
    ctx.fillRect = () => { insideStyles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, redInterior, world, 32)
    const yellowPieceColor = insideStyles[1]

    expect(redPieceColor).not.toBe(yellowPieceColor)
    expect(redPieceColor).not.toBe('#3d9bff')
    expect(yellowPieceColor).not.toBe('#3d9bff')
  })

  it('does not color an ordinary container that merely owns an unrelated board, even when a real cycle exists on the same board', () => {
    const root = makeFloorBoard('root', 3)
    const obstacleInside = makeFloorBoard('obstacleInside', 1)
    const world = makeWorld(
      [root, obstacleInside],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root' }, { id: 'obstacleContainer', kind: 'container', boardRef: 'obstacleInside' }],
      { loopBox: { board: 'root', x: 0, y: 0 }, obstacleContainer: { board: 'root', x: 1, y: 0 } },
    )
    const ctx = mockContext()
    const styles: string[] = []
    ctx.fillRect = () => { styles.push(ctx.fillStyle as string) }
    // loopBox is a genuine self-loop (boardRef points back at 'root', the very board
    // being rendered), so with the default budget drawBoardRecursive immediately dives
    // into it recursively — correctly, per the recursive-rendering design — before ever
    // reaching obstacleContainer, shifting every later fillRect index unpredictably deep
    // into that recursion. Capping maxRecursionDepth at 1 lets loopBox draw its own
    // cell/piece rects (proving its color) and stops before descending further, so
    // obstacleContainer's draw lands at the same index the old flat renderBoard produced
    // — which is what this test's indices assume. drawBoardForTest can't express this
    // (it always uses DEFAULT_RENDER_BUDGET), so this test builds its DrawContext
    // directly, same as the viewport-culling/budget tests below.
    const camera: CameraTransform = { anchor: 'root', centerX: root.size / 2, centerY: root.size / 2, pixelsPerRootUnit: 32 }
    const viewport: Viewport = { width: root.size * 32, height: root.size * 32 }
    const dc = {
      ctx,
      world,
      camera,
      viewport,
      budget: { ...DEFAULT_RENDER_BUDGET, maxRecursionDepth: 1 },
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
    }
    drawBoardRecursive(dc, root, { boardId: root.id, originX: 0, originY: 0, scale: 1 }, 0, 0, false)
    expect(styles[10]).toBe('#3d9bff')
    expect(styles[9]).not.toBe('#3d9bff')
  })

  it('draws a gold ring around a locked piece', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld([voidBoard], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'void', x: 2, y: 2 } })
    const ctx = mockContext()
    let strokeCalls = 0
    let sawPaleSlateStroke = false
    ctx.strokeRect = () => {
      strokeCalls++
      if (ctx.strokeStyle === '#e2e8f0') sawPaleSlateStroke = true
    }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(strokeCalls).toBe(1)
    expect(sawPaleSlateStroke).toBe(true)
  })

  it('draws the same gold ring around an infExit-flagged ∞ box even on an ordinary (non-Void) board', () => {
    // A non-self-referencing interior (not pointing back at root) so the ring is drawn exactly
    // once, not once per recursive copy of a self-loop.
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: 'infBox', kind: 'container', boardRef: 'inside', infExit: true }],
      { infBox: { board: 'root', x: 1, y: 1 } },
    )
    const ctx = mockContext()
    let strokeCalls = 0
    let sawPaleSlateStroke = false
    ctx.strokeRect = () => {
      strokeCalls++
      if (ctx.strokeStyle === '#e2e8f0') sawPaleSlateStroke = true
    }
    drawBoardForTest(ctx, root, world, 32)
    expect(strokeCalls).toBe(1)
    expect(sawPaleSlateStroke).toBe(true)
  })

  it('does not draw a ring around a non-locked piece of the same kind', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'root', x: 0, y: 0 } })
    const ctx = mockContext()
    let strokeCalls = 0
    ctx.strokeRect = () => { strokeCalls++ }
    drawBoardForTest(ctx, root, world, 32)
    expect(strokeCalls).toBe(0)
  })

  it('a voided former cycle member gets the plain container color plus the ring, not the cycle color', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld([voidBoard], [{ id: 'loopBox', kind: 'container', boardRef: 'root' }], { loopBox: { board: 'void', x: 2, y: 2 } })
    const ctx = mockContext()
    let fillStyleAtPieceDraw = ''
    let strokeCalls = 0
    ctx.fillRect = () => { fillStyleAtPieceDraw = ctx.fillStyle as string }
    ctx.strokeRect = () => { strokeCalls++ }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(fillStyleAtPieceDraw).toBe('#3d9bff')
    expect(strokeCalls).toBe(1)
  })

  it('restores context state after drawing a locked ring, so it does not bleed into the next piece drawn', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld(
      [voidBoard],
      [{ id: 'locked1', kind: 'normal' }, { id: 'locked2', kind: 'container', boardRef: 'someInterior' }],
      { locked1: { board: 'void', x: 2, y: 2 }, locked2: { board: 'void', x: 3, y: 2 } },
    )
    const ctx = mockContext()
    let saveCalls = 0
    let restoreCalls = 0
    const pieceFillStyles: string[] = []
    ctx.save = () => { saveCalls++ }
    ctx.restore = () => { restoreCalls++ }
    ctx.strokeRect = () => {}
    ctx.fillRect = () => { pieceFillStyles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(saveCalls).toBe(2)
    expect(restoreCalls).toBe(2)
    expect(pieceFillStyles.at(-2)).toBe('#ffb236')
    expect(pieceFillStyles.at(-1)).toBe('#3d9bff')
  })

  it('an infinite destination renders with the color of the real piece it represents, plus the infinity marker', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [voidBoard, root],
      [{ id: 'realOwner', kind: 'container', boardRef: 'root' }, { id: 'void-infinite:realOwner', kind: 'normal', infiniteFor: 'realOwner' }],
      { realOwner: { board: 'root', x: 0, y: 0 }, 'void-infinite:realOwner': { board: 'void', x: 2, y: 2 } },
    )
    const ctx = mockContext()
    let destinationFillStyle = ''
    let markerDrawn = false
    ctx.fillRect = () => { destinationFillStyle = ctx.fillStyle as string }
    ctx.fillText = (text) => { if (text === '∞') markerDrawn = true }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(destinationFillStyle).not.toBe('#3d9bff')
    expect(markerDrawn).toBe(true)
  })

  it('I2 regression: the lock ring on a Void-locked container with a real, recursable interior is drawn AFTER the interior\'s own cell fills, so nothing erases it', () => {
    // A container standing on VOID_BOARD_ID whose boardRef points at a real, non-empty
    // board — big/close enough that its screen cell stays above the pixel cutoff, so
    // drawBoardRecursive actually recurses into it. Before the fix, the ring/marker were
    // drawn BEFORE that recursion, so the interior's own opaque cell fills painted over
    // (erased) them.
    const voidBoard = makeFloorBoard('void', 5)
    const interior = makeFloorBoard('interior', 2)
    const world = makeWorld(
      [voidBoard, interior],
      [{ id: 'lockedBox', kind: 'container', boardRef: 'interior' }],
      { lockedBox: { board: 'void', x: 2, y: 2 } },
    )
    const ctx = mockContext()
    const callOrder: string[] = []
    let strokeCalls = 0
    ctx.fillRect = () => { callOrder.push('fill') }
    ctx.strokeRect = () => { callOrder.push('stroke'); strokeCalls++ }
    // cellSize 64 -> lockedBox's own screen cell is 64px (well above the 4px cutoff),
    // and its interior's cells render at 64/2=32px, also above cutoff -> recursion happens.
    drawBoardForTest(ctx, voidBoard, world, 64)
    expect(strokeCalls).toBe(1) // the ring is still drawn at all
    const ringStrokeIndex = callOrder.indexOf('stroke')
    const lastFillIndex = callOrder.lastIndexOf('fill') // the interior's own cell fills are the last fills
    expect(ringStrokeIndex).toBeGreaterThan(lastFillIndex)
  })

  it('an ordinary locked Void piece (no infiniteFor) does not render the infinity marker', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld([voidBoard], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'void', x: 2, y: 2 } })
    const ctx = mockContext()
    let markerDrawn = false
    ctx.fillText = (text) => { if (text === '∞') markerDrawn = true }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(markerDrawn).toBe(false)
  })

  it('a container above the pixel cutoff draws its nested board\'s own cells', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside' }],
      { box: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    // cellSize 32 on a 2x2 root -> box's own cell is 32px, well above the 4px cutoff,
    // and its nested 3x3 board's cells render at 32/2=16px, still above cutoff.
    drawBoardForTest(ctx, root, world, 32)
    // 4 root cells + 1 box fill + 9 nested inside cells = 14
    expect(calls).toBe(14)
  })

  it('a container below the pixel cutoff keeps its flat fill without recursing', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside' }],
      { box: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    // cellSize 2 -> box's own cell is 2px, below the 4px cutoff -> no nested draw.
    drawBoardForTest(ctx, root, world, 2)
    expect(calls).toBe(5) // 4 root cells + 1 box fill, nothing nested
  })

  it('I4 regression: minCellPixels is checked against the CHILD\'s own per-cell size, not the parent container\'s cell', () => {
    // box's own screen cell is comfortably above minCellPixels (64px, from a 2x2 root at
    // cellSize 64), but its interior is a 40x40 board: dividing 64px by 40 brings the
    // CHILD's own per-cell size to 1.6px, below the 2px default cutoff. The old (buggy)
    // parent-only check compared 64px >= 2px and wrongly allowed recursion; the fixed
    // check must compare 1.6px >= 2px and refuse to recurse, keeping box's flat fill only.
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 40)
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside' }],
      { box: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    // cellSize 64 -> box's own cell is 64px (above cutoff); its 40x40 interior's own
    // cells would render at 64/40=1.6px (below cutoff).
    drawBoardForTest(ctx, root, world, 64)
    expect(calls).toBe(5) // 4 root cells + 1 box fill, nothing nested — recursion refused
  })

  it('a viewport-culled board is skipped entirely', () => {
    const root = makeFloorBoard('root', 2)
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    const world = makeWorld([root], [], {})
    const dc = {
      ctx,
      world,
      camera: { anchor: 'root' as const, centerX: 1000, centerY: 1000, pixelsPerRootUnit: 32 }, // far off-screen
      viewport: { width: 100, height: 100 },
      budget: DEFAULT_RENDER_BUDGET,
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
    }
    drawBoardRecursive(dc, root, { boardId: 'root', originX: 0, originY: 0, scale: 1 }, 0, 0, false)
    expect(calls).toBe(0)
  })

  it('stops drawing once maxCellsPerFrame is reached, mid-board', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld([root], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    const dc = {
      ctx,
      world,
      camera: { anchor: 'root' as const, centerX: 2, centerY: 2, pixelsPerRootUnit: 32 },
      viewport: { width: 128, height: 128 },
      budget: { ...DEFAULT_RENDER_BUDGET, maxCellsPerFrame: 5 },
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
    }
    drawBoardRecursive(dc, root, { boardId: 'root', originX: 0, originY: 0, scale: 1 }, 0, 0, false)
    expect(calls).toBe(5)
  })

  it('stops recursing once maxRecursionDepth is reached, even for a 1x1 self-loop that never shrinks', () => {
    const loopBoard = makeFloorBoard('loop', 1)
    const world = makeWorld(
      [loopBoard],
      [{ id: 'C', kind: 'container', boardRef: 'loop' }],
      { C: { board: 'loop', x: 0, y: 0 } }, // self-referencing, size 1 -> scale never shrinks
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    const dc = {
      ctx,
      world,
      camera: { anchor: 'root' as const, centerX: 0.5, centerY: 0.5, pixelsPerRootUnit: 1000 }, // stays >4px at every depth
      viewport: { width: 2000, height: 2000 },
      budget: { ...DEFAULT_RENDER_BUDGET, maxRecursionDepth: 5, maxCellsPerFrame: 100000 },
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
    }
    drawBoardRecursive(dc, loopBoard, { boardId: 'loop', originX: 0, originY: 0, scale: 1 }, 0, 0, false)
    // Two fillRect calls per depth level (1 cell board): the board's own single cell,
    // plus piece C's own rect (C sits on 'loop' and is what triggers the next level's
    // recursion — every container draws itself before recursing into its interior, same
    // as the non-self-loop container tests above). Depths 0..4 = 5 levels x 2 = 10
    // draws, then depth 5 hits maxRecursionDepth and stops before drawing anything —
    // proves termination independent of pixel size, which never drops below cutoff in
    // this fixture.
    expect(calls).toBe(10)
  })
})

describe('indexPiecesByBoard', () => {
  it('groups pieces by their current board', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box1', kind: 'normal' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, box1: { board: 'inside', x: 1, y: 1 } },
    )
    const index = indexPiecesByBoard(world)
    expect(index.get('root')).toEqual([{ pieceId: PLAYER_ID, location: { board: 'root', x: 0, y: 0 } }])
    expect(index.get('inside')).toEqual([{ pieceId: 'box1', location: { board: 'inside', x: 1, y: 1 } }])
  })

  it('returns an empty map for a world with no pieces', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [], {})
    expect(indexPiecesByBoard(world).size).toBe(0)
  })
})

describe('DEFAULT_RENDER_BUDGET', () => {
  it('matches the spec\'s exact default values', () => {
    expect(DEFAULT_RENDER_BUDGET).toEqual({
      minCellPixels: 2,
      maxCellsPerFrame: 4000,
      maxRecursionDepth: 48,
      marginCells: 1,
    })
  })
})

describe('resolveRecursionTarget', () => {
  it('a plain container recurses into its own boardRef, untinted, mirrored per its own fliph', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld([root, inside], [{ id: 'box', kind: 'container', boardRef: 'inside', fliph: true }], { box: { board: 'root', x: 0, y: 0 } })
    expect(resolveRecursionTarget(world, world.pieces.box)).toEqual({ boardId: 'inside', tintAmount: 0, mirrorH: true })
  })

  it('a clone recurses into its main body\'s CURRENT board, tinted, mirrored per the MAIN BODY\'s fliph (not its own)', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: 'mainBody', kind: 'normal', fliph: true },
        { id: 'clone', kind: 'container', cloneOf: 'mainBody', fliph: false }, // clone's own fliph is inert
      ],
      { mainBody: { board: 'root', x: 0, y: 0 }, clone: { board: 'root', x: 2, y: 0 } },
    )
    expect(resolveRecursionTarget(world, world.pieces.clone)).toEqual({ boardId: 'root', tintAmount: 0.35, mirrorH: true })
  })

  it('returns null for a clone whose main body no longer exists', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [{ id: 'clone', kind: 'container', cloneOf: 'gone' }], { clone: { board: 'root', x: 0, y: 0 } })
    expect(resolveRecursionTarget(world, world.pieces.clone)).toBeNull()
  })

  it('returns null for a non-container, non-clone piece', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'root', x: 0, y: 0 } })
    expect(resolveRecursionTarget(world, world.pieces.box1)).toBeNull()
  })
})

describe('combineTint', () => {
  it('composes so a second application never fully resets toward zero', () => {
    const once = combineTint(0, 0.35)
    const twice = combineTint(once, 0.35)
    expect(twice).toBeGreaterThan(once)
  })
  it('parent tint alone (local 0) is unchanged', () => {
    expect(combineTint(0.5, 0)).toBeCloseTo(0.5)
  })
})

describe('drawBoardRecursive — Clone', () => {
  it('displays the main body\'s actual current board content, not a nonexistent boardRef', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [{ id: 'mainBody', kind: 'normal' }, { id: 'clone', kind: 'container', cloneOf: 'mainBody' }],
      { mainBody: { board: 'root', x: 0, y: 0 }, clone: { board: 'root', x: 2, y: 0 } },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    drawBoardForTest(ctx, root, world, 64) // 64px/3 cells ~21px, above cutoff -> clone recurses into root itself
    // 9 root cells + mainBody fill + clone fill + (clone's recursive peek: another 9
    // root cells + mainBody fill again, but NOT clone's own fill again since piece
    // identity inside the peek is still just mainBody/clone at their real root positions)
    expect(calls).toBeGreaterThan(11) // proves recursion happened, not just the flat clone fill
  })

  it('a clone\'s recursively-drawn content is provably paler than the same content drawn uncloned', () => {
    const root = makeFloorBoard('root', 3)
    const worldWithClone = makeWorld(
      [root],
      [{ id: 'mainBody', kind: 'normal' }, { id: 'clone', kind: 'container', cloneOf: 'mainBody' }],
      { mainBody: { board: 'root', x: 0, y: 0 }, clone: { board: 'root', x: 2, y: 0 } },
    )
    const ctx1 = mockContext()
    const stylesViaClone: string[] = []
    ctx1.fillRect = () => { stylesViaClone.push(ctx1.fillStyle as string) }
    drawBoardForTest(ctx1, root, worldWithClone, 64)
    // The nested peek's floor-cell fills come after the top-level 9 cells + 2 piece
    // fills (mainBody, clone) — compare one of those nested floor fills against a plain
    // undyed floor fill.
    const nestedFloorFill = stylesViaClone[11] // first cell of the recursed peek
    expect(nestedFloorFill).not.toBe(FLOOR_COLOR) // FLOOR_COLOR, unmixed
  })

  it('a clone of a container with its own interior peeks that interior directly, tinted', () => {
    // mainBody lives on its OWN separate board ('elsewhere'), away from the clone —
    // deliberately, so the clone's peek can't loop back into itself (a clone sitting on
    // the SAME board its own main body occupies would recurse into that board again,
    // re-encounter the clone piece, and keep going until the pixel cutoff — correct
    // behavior, but not what this test is isolating). Recursion path: clone (root) ->
    // peeks at mainBody's location board 'elsewhere' (tint 0.35) -> encounters mainBody
    // itself there, an ORDINARY container (tint contribution 0) -> recurses into
    // mainBody's own boardRef 'mainInside' (combined tint stays 0.35, since 0 composed
    // with 0.35 is 0.35) -> mainInside has no pieces, a clean leaf. Deterministic: 9
    // root cells + 1 clone fill + 4 elsewhere cells + 1 mainBody fill + 4 mainInside
    // cells = 19 total fillRect calls, so the last 4 are unambiguously mainInside's.
    const root = makeFloorBoard('root', 3)
    const elsewhere = makeFloorBoard('elsewhere', 2)
    const mainInside = makeFloorBoard('mainInside', 2)
    const world = makeWorld(
      [root, elsewhere, mainInside],
      [
        { id: 'mainBody', kind: 'container', boardRef: 'mainInside' },
        { id: 'clone', kind: 'container', cloneOf: 'mainBody' },
      ],
      { mainBody: { board: 'elsewhere', x: 0, y: 0 }, clone: { board: 'root', x: 2, y: 0 } },
    )
    const ctx = mockContext()
    const styles: string[] = []
    ctx.fillRect = () => { styles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, root, world, 64)
    // Clone -> source's own interior 'mainInside' (a clone is a reference to the
    // source block, not a portal to where the source stands): 9 root cells + 1 clone
    // fill + 4 mainInside cells = 14 fillRect calls; the last 4 are mainInside's.
    expect(styles).toHaveLength(14)
    const innermostMainInsideFill = styles.at(-1) as string
    expect(innermostMainInsideFill).not.toBe(FLOOR_COLOR) // FLOOR_COLOR, unmixed — must be tinted
  })
})

describe('drawBoardRecursive — Flip', () => {
  it('mirrors both cells and pieces horizontally inside a fliph container', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    setRequirement(inside, 0, 0, 'box') // leftmost column has the marker
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside', fliph: true }],
      { box: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    const fillCalls: { x: number; style: string }[] = []
    ctx.fillRect = (x) => { fillCalls.push({ x: x as number, style: ctx.fillStyle as string }) }
    drawBoardForTest(ctx, root, world, 64)
    // Without mirroring, the requirement overlay (0,0) would draw at the LEFT half of
    // box's own screen cell; mirrored, it must draw at the RIGHT half instead.
    const overlayCall = fillCalls.find((c) => c.style === '#cfcfcf')! // REQUIREMENT_OVERLAY.box
    const boxCellLeft = 0 // box sits at root (0,0), screen left edge = 0
    const boxCellCenter = boxCellLeft + (64 / 2) / 2 // half of box's own 32px screen cell
    expect(overlayCall.x).toBeGreaterThan(boxCellCenter)
  })

  it('I1 regression: a container inside a fliph board recurses into its nested content at the SAME mirrored screen position as its own shell', () => {
    // outer (fliph=false, size 2) contains `box` (fliph=true) at x=0, whose own interior
    // `boxInside` is size 3 and itself contains `innerBox` at x=0. Mirrored, innerBox's
    // shell (and its own recursively-drawn interior) must land at x=2 (size-1-0), not x=0.
    const outer = makeFloorBoard('outer', 2)
    const boxInside = makeFloorBoard('boxInside', 3)
    const innerBoxInside = makeFloorBoard('innerBoxInside', 2)
    setRequirement(innerBoxInside, 0, 0, 'box') // marker inside innerBox's own interior
    const world = makeWorld(
      [outer, boxInside, innerBoxInside],
      [
        { id: 'box', kind: 'container', boardRef: 'boxInside', fliph: true },
        { id: 'innerBox', kind: 'container', boardRef: 'innerBoxInside' },
      ],
      { box: { board: 'outer', x: 0, y: 0 }, innerBox: { board: 'boxInside', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    const fillCalls: { x: number; style: string }[] = []
    ctx.fillRect = (x) => { fillCalls.push({ x: x as number, style: ctx.fillStyle as string }) }
    // cellSize 90 on a 2x2 outer -> box's own screen cell is 90px; box's interior
    // (boardInside, size 3) cells render at 90/3=30px, innerBox's own interior
    // (innerBoxInside, size 2) cells render at 30/2=15px — all comfortably above the 4px
    // cutoff so every level recurses.
    drawBoardForTest(ctx, outer, world, 90)
    // box's own cell occupies screen x in [0,90). boxInside is 3 cells wide at 30px each,
    // so its cell x=0 occupies screen x in [0,30) unmirrored, or [60,90) mirrored (size-1-0=2).
    // innerBox sits at boxInside (0,0) -> mirrored to boxInside x=2 -> screen x in [60,90).
    // 'box' draws its own shell first (unmirrored at the outer level, since outer itself
    // has no fliph), THEN recursion reaches 'innerBox's own shell — the second container
    // fill in draw order.
    const innerBoxOwnFill = fillCalls.filter((c) => c.style === '#3d9bff').at(-1)! // PIECE_COLORS.container
    expect(innerBoxOwnFill.x).toBeGreaterThanOrEqual(60)
    // innerBox's own recursively-drawn interior (the 'box' requirement overlay marker)
    // must ALSO land in that same mirrored region, not at the unmirrored x in [0,30).
    const overlayCall = fillCalls.find((c) => c.style === '#cfcfcf')! // REQUIREMENT_OVERLAY.box
    expect(overlayCall.x).toBeGreaterThanOrEqual(60)
  })

  it('control: a non-fliph container is not mirrored', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    setRequirement(inside, 0, 0, 'box')
    const world = makeWorld([root, inside], [{ id: 'box', kind: 'container', boardRef: 'inside' }], { box: { board: 'root', x: 0, y: 0 } })
    const ctx = mockContext()
    const fillCalls: { x: number; style: string }[] = []
    ctx.fillRect = (x) => { fillCalls.push({ x: x as number, style: ctx.fillStyle as string }) }
    drawBoardForTest(ctx, root, world, 64)
    const overlayCall = fillCalls.find((c) => c.style === '#cfcfcf')! // REQUIREMENT_OVERLAY.box
    const boxCellCenter = 0 + (64 / 2) / 2
    expect(overlayCall.x).toBeLessThan(boxCellCenter)
  })
})

describe('drawBoardRecursive — getRenderLocation override', () => {
  it('uses getRenderLocation\'s position for both the piece\'s own draw and its recursive placement', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside' }],
      { box: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    const fillXs: number[] = []
    ctx.fillRect = (x) => { fillXs.push(x as number) }
    const dc = {
      ctx,
      world,
      camera: { anchor: 'root' as const, centerX: 2, centerY: 2, pixelsPerRootUnit: 32 },
      viewport: { width: 128, height: 128 },
      budget: DEFAULT_RENDER_BUDGET,
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
      // pretend box is actually at x=2 this frame (mid-tween), not its stored x=0
      getRenderLocation: (pieceId: string) => (pieceId === 'box' ? { board: 'root', x: 2, y: 0 } : world.locations[pieceId]),
    }
    drawBoardRecursive(dc, root, { boardId: 'root', originX: 0, originY: 0, scale: 1 }, 0, 0, false)
    // box's own fill, and its nested board's cells, must appear at screen x >= 2*32=64,
    // not at x=0 where its stored Location would otherwise place them.
    const boxOwnFillX = fillXs[16] // 16 root cells, then box's own fill
    expect(boxOwnFillX).toBeGreaterThanOrEqual(64)
  })
})

describe('paradox glyphs (∞ and ε share one visual path)', () => {
  it('paradoxGlyph picks ∞ for an Infinite Exit destination and a single ε for an Infinite Enter destination', async () => {
    const { paradoxGlyph } = await import('./CanvasRenderer')
    expect(paradoxGlyph({ id: 'a', kind: 'normal', infiniteFor: 'x' })).toBe('∞')
    expect(paradoxGlyph({ id: 'b', kind: 'container', boardRef: 'e', epsilonFor: 'x' })).toBe('ε')
    expect(paradoxGlyph({ id: 'c', kind: 'normal' })).toBeNull()
  })

  it('an ε standing in the Void is drawn with the ε glyph, and nothing in the renderer decides it exists', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const eps = { id: 'void-epsilon:s', kind: 'container' as const, boardRef: 'epsilon:s', epsilonFor: 's' }
    const world = makeWorld(
      [voidBoard, { id: 'epsilon:s', size: 1, cells: [[{ type: 'floor' }]] }],
      [eps],
      { [eps.id]: { board: 'void', x: 2, y: 2 } },
    )
    const ctx = mockContext()
    const glyphs: string[] = []
    ctx.fillText = (t) => { glyphs.push(t as string) }
    renderBoard(ctx, voidBoard, world, 32)
    expect(glyphs).toEqual(['ε'])
  })
})

describe('Void-spawned ∞ of degree d shows d+1 stacked glyphs', () => {
  it('a degree-2 Void ∞ (∞∞∞) draws three ∞ glyphs; degree 0 draws one', () => {
    const voidBoard = makeFloorBoard('void', 7)
    const world = makeWorld(
      [voidBoard, makeFloorBoard('root', 3)],
      [
        { id: 'loop', kind: 'container', boardRef: 'root' },
        { id: 'void-infinite:loop:2', kind: 'normal', infiniteFor: 'loop', infExitNum: 2 },
        { id: 'void-infinite:loop', kind: 'normal', infiniteFor: 'loop' },
      ],
      {
        loop: { board: 'root', x: 0, y: 0 },
        'void-infinite:loop:2': { board: 'void', x: 3, y: 3 },
        'void-infinite:loop': { board: 'void', x: 1, y: 1 },
      },
    )
    const ctx = mockContext()
    const glyphs: { x: number; y: number; t: string }[] = []
    ctx.fillText = (t, x, y) => { glyphs.push({ t: t as string, x: x as number, y: y as number }) }
    renderBoard(ctx, voidBoard, world, 30)
    const inCell = (cx: number, cy: number) => glyphs.filter((g) => g.x >= cx * 30 && g.x < (cx + 1) * 30 && g.y >= cy * 30 && g.y < (cy + 1) * 30)
    expect(inCell(3, 3).map((g) => g.t)).toEqual(['∞', '∞', '∞'])
    expect(inCell(1, 1).map((g) => g.t)).toEqual(['∞'])
  })
})

describe('clone colour', () => {
  it('a second Ref instance of a board is drawn lighter than the canonical one; the canonical one keeps the plain colour', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [
        { id: 'main', kind: 'container', boardRef: 'inside', exitBlock: true },
        { id: 'copy', kind: 'container', boardRef: 'inside' },
      ],
      { main: { board: 'root', x: 0, y: 0 }, copy: { board: 'root', x: 2, y: 0 } },
    )
    expect(isCloneInstance(world, world.pieces.main)).toBe(false)
    expect(isCloneInstance(world, world.pieces.copy)).toBe(true)
    const ctx = mockContext()
    const fills: { x: number; style: string }[] = []
    ctx.fillRect = (x) => { fills.push({ x: x as number, style: ctx.fillStyle as string }) }
    drawBoardForTest(ctx, root, world, 30)
    const shellAt = (x: number) => fills.find((f) => f.x === x && f.style !== fills[0].style && (f.style === '#3d9bff' || f.style !== FLOOR_COLOR))!
    const mainShell = shellAt(0)
    const copyShell = shellAt(60)
    expect(mainShell.style).toBe('#3d9bff')
    const brightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    expect(brightness(copyShell.style)).toBeGreaterThan(brightness(mainShell.style))
  })

  it('an ∞ Ref is not treated as a clone', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: 'loop', kind: 'container', boardRef: 'root', exitBlock: true },
        { id: 'inf', kind: 'container', boardRef: 'root', infExit: true, infExitNum: 0 },
      ],
      { loop: { board: 'root', x: 0, y: 0 }, inf: { board: 'root', x: 2, y: 0 } },
    )
    expect(isCloneInstance(world, world.pieces.inf)).toBe(false)
  })
})
