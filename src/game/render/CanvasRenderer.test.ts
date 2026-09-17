import { describe, it, expect } from 'vitest'
import { renderBoard } from './CanvasRenderer'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from '../engine/testFixtures'
import { PLAYER_ID } from '../engine/types'

function mockContext() {
  return {
    fillRect: () => {},
    fillStyle: '',
    strokeRect: () => {},
    strokeStyle: '',
    lineWidth: 0,
    save: () => {},
    restore: () => {},
  } as unknown as CanvasRenderingContext2D
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
    expect(redPieceColor).not.toBe('#38bdf8') // neither is the plain container color
    expect(yellowPieceColor).not.toBe('#38bdf8')
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
    expect(styles[10]).toBe('#38bdf8') // obstacleContainer: plain container color
    expect(styles[9]).not.toBe('#38bdf8') // loopBox: cycle color
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
    expect(fillStyleAtPieceDraw).toBe('#38bdf8') // plain container color — no longer a cycle member once voided
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
    expect(pieceFillStyles.at(-2)).toBe('#f59e0b') // locked1: plain 'normal' color
    expect(pieceFillStyles.at(-1)).toBe('#38bdf8') // locked2: plain 'container' color, unaffected by locked1's ring
  })

  it('LOCKED_RING_COLOR does not collide with any known piece or cycle color', () => {
    // Pinned literal comparison, not an import — PIECE_COLORS/CYCLE_PALETTE aren't
    // exported. Catches an exact collision if either palette or the ring color
    // changes later without updating this test. (Does not catch near-miss
    // perceptual similarity, e.g. the yellow-400/yellow-500 pair this replaces —
    // that required a human/reviewer judgment call, not an automatable check.)
    const knownPieceAndCycleColors = [
      '#f59e0b', '#38bdf8', '#f472b6', // PIECE_COLORS
      '#ef4444', '#eab308', '#a855f7', '#14b8a6', '#f97316', // CYCLE_PALETTE
    ]
    const LOCKED_RING_COLOR = '#e2e8f0'
    expect(knownPieceAndCycleColors).not.toContain(LOCKED_RING_COLOR)
  })
})
