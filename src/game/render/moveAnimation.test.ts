import { describe, it, expect } from 'vitest'
import { crossBoardMoves, flipScaleAt, flippedPieces, interpolateCell, pieceCellInAnchor, selfLoopTransits } from './moveAnimation'
import { EngineEvent, withEngineContext } from '../engine/events'
import { applyMove } from '../engine/rules'
import { makeFloorBoard, makeWorld, setWall } from '../engine/testFixtures'
import { Direction, PLAYER_ID, World } from '../engine/types'

function nested(fliph = false): World {
  // root 4x4; box B (3x3 interior 'bIn') at root (2,1); the player on root at (1,1).
  const world = makeWorld(
    [makeFloorBoard('root', 4), makeFloorBoard('bIn', 3)],
    [{ id: PLAYER_ID, kind: 'player' }, { id: 'B', kind: 'container', boardRef: 'bIn', fliph }],
    { [PLAYER_ID]: { board: 'root', x: 1, y: 1 }, B: { board: 'root', x: 2, y: 1 } },
  )
  setWall(world.boards.root, 3, 1) // B cannot be pushed right: the player enters it
  return world
}

describe('pieceCellInAnchor', () => {
  it('a piece on the anchor board: its own cell, scale 1', () => {
    expect(pieceCellInAnchor(nested(), PLAYER_ID, 'root')).toEqual({ originX: 1, originY: 1, scale: 1, mirrorH: false })
  })

  it('a piece inside a box: the box cell subdivided', () => {
    const w = nested()
    w.locations[PLAYER_ID] = { board: 'bIn', x: 0, y: 1 }
    const cell = pieceCellInAnchor(w, PLAYER_ID, 'root')!
    expect(cell.scale).toBeCloseTo(1 / 3)
    expect(cell.originX).toBeCloseTo(2)
    expect(cell.originY).toBeCloseTo(1 + 1 / 3)
  })

  it('inside a flipped box, x is mirrored exactly as the renderer mirrors it', () => {
    const w = nested(true)
    w.locations[PLAYER_ID] = { board: 'bIn', x: 0, y: 1 }
    const cell = pieceCellInAnchor(w, PLAYER_ID, 'root')!
    expect(cell.originX).toBeCloseTo(2 + 2 / 3) // interior column 0 drawn at the right
    expect(cell.mirrorH).toBe(true)
  })

  it('null when the board is not reachable from the anchor', () => {
    const w = nested()
    expect(pieceCellInAnchor(w, PLAYER_ID, 'bIn')).toBeNull()
  })
})

describe('crossBoardMoves', () => {
  it('entering a box: the player glides from its root cell to its cell inside the box', () => {
    const pre = nested()
    const post = applyMove(pre, 'right')!
    expect(post.locations[PLAYER_ID].board).toBe('bIn')
    const moves = crossBoardMoves(pre, post, 'root')
    expect(moves).toHaveLength(1)
    expect(moves[0].pieceId).toBe(PLAYER_ID)
    expect(moves[0].from).toEqual({ originX: 1, originY: 1, scale: 1, mirrorH: false })
    expect(moves[0].to.scale).toBeCloseTo(1 / 3)
  })

  it('a same-board move is not a cross-board move', () => {
    const pre = nested()
    const post = applyMove(pre, 'up')!
    expect(crossBoardMoves(pre, post, 'root')).toEqual([])
  })
})

describe('interpolateCell', () => {
  const from = { originX: 1, originY: 1, scale: 1 }
  const to = { originX: 2, originY: 1, scale: 1 / 9 }
  it('starts and ends exactly on the two cells', () => {
    expect(interpolateCell(from, to, 0)).toEqual(from)
    const end = interpolateCell(from, to, 1)
    expect(end.originX).toBeCloseTo(2)
    expect(end.scale).toBeCloseTo(1 / 9)
  })
  it('shrinks geometrically: halfway is the geometric mean of the sizes', () => {
    expect(interpolateCell(from, to, 0.5).scale).toBeCloseTo(1 / 3)
  })
})

describe('flip animation', () => {
  it('a piece passing through a flipped box is reported as flipped', () => {
    const pre = nested(true)
    const post = applyMove(pre, 'right')!
    expect([...flippedPieces(pre, post)]).toEqual([PLAYER_ID])
  })
  it('turns over: -1 (old orientation) -> 0 -> 1 (new orientation)', () => {
    expect(flipScaleAt(0)).toBeCloseTo(-1)
    expect(flipScaleAt(0.5)).toBeCloseTo(0)
    expect(flipScaleAt(1)).toBeCloseTo(1)
  })
})

describe('selfLoopTransits', () => {
  // A 5x5 room holding a box L, at (2,2) with a wall behind it, that leads into the room itself.
  const loopWorld = (player: { x: number; y: number }) => {
    const root = makeFloorBoard('root', 5)
    setWall(root, 3, 2)
    return makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'L', kind: 'container', boardRef: 'root' }],
      { [PLAYER_ID]: { board: 'root', ...player }, L: { board: 'root', x: 2, y: 2 } },
    )
  }
  const step = (world: World, dir: Direction) => {
    const events: EngineEvent[] = []
    const next = withEngineContext({ events }, () => applyMove(world, dir))
    if (next === null) throw new Error('blocked')
    return { next, events }
  }

  it('leaving the room through its own box: glides out of the box cell, the camera zooms out of it', () => {
    const pre = loopWorld({ x: 0, y: 2 })
    const { next, events } = step(pre, 'left')
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 2 }) // came out beside L
    const transit = selfLoopTransits(pre, next, events, 'root')
    expect(transit.player).toEqual({ kind: 'exit', boxCell: { originX: 2, originY: 2, scale: 1, mirrorH: false } })
    // From where the room's copy inside L shows the player (in L's cell, a fifth of the size).
    expect(transit.moves).toEqual([
      { pieceId: PLAYER_ID, from: { originX: 2, originY: 2.4, scale: 0.2, mirrorH: false }, to: { originX: 1, originY: 2, scale: 1, mirrorH: false } },
    ])
  })

  it('walking into its own box: shrinks into the box cell, the camera zooms into it', () => {
    const pre = loopWorld({ x: 1, y: 2 })
    const { next, events } = step(pre, 'right')
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 2 }) // the room's left edge
    const transit = selfLoopTransits(pre, next, events, 'root')
    expect(transit.player?.kind).toBe('enter')
    expect(transit.moves[0].to).toEqual({ originX: 2, originY: 2.4, scale: 0.2, mirrorH: false })
  })

  it('an ordinary step makes no transit', () => {
    const pre = loopWorld({ x: 1, y: 1 })
    const { next, events } = step(pre, 'up')
    expect(selfLoopTransits(pre, next, events, 'root')).toEqual({ moves: [] })
  })
})
