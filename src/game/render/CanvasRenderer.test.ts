import { describe, it, expect } from 'vitest'
import { renderBoard } from './CanvasRenderer'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from '../engine/testFixtures'
import { PLAYER_ID } from '../engine/types'

function mockContext() {
  return { fillRect: () => {}, fillStyle: '' } as unknown as CanvasRenderingContext2D
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
})
