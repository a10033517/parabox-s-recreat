import { describe, it, expect } from 'vitest'
import { drawBoardRecursive, indexPiecesByBoard, DEFAULT_RENDER_BUDGET } from './CanvasRenderer'
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
    expect(redPieceColor).not.toBe('#38bdf8')
    expect(yellowPieceColor).not.toBe('#38bdf8')
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
    expect(styles[10]).toBe('#38bdf8')
    expect(styles[9]).not.toBe('#38bdf8')
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
    expect(fillStyleAtPieceDraw).toBe('#38bdf8')
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
    expect(pieceFillStyles.at(-2)).toBe('#f59e0b')
    expect(pieceFillStyles.at(-1)).toBe('#38bdf8')
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
    expect(destinationFillStyle).not.toBe('#38bdf8')
    expect(markerDrawn).toBe(true)
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
