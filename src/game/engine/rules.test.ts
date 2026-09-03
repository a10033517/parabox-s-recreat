import { describe, it, expect } from 'vitest'
import { computeTarget, getEntryCell } from './rules'
import { HALF, makeFraction, ZERO, ONE } from './fraction'
import { makeFloorBoard, makeWorld } from './testFixtures'

describe('computeTarget', () => {
  it('returns the adjacent cell unchanged when it stays within the board', () => {
    const world = makeWorld([makeFloorBoard('root', 3)], [], {})
    const result = computeTarget(world, { board: 'root', x: 1, y: 1 }, 'right', HALF)
    expect(result).toEqual({ location: { board: 'root', x: 2, y: 1 }, relativeCoord: HALF })
  })

  it('exits into the parent board through the container piece that owns this board', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('boardA', 3)],
      [{ id: 'boxA', kind: 'container', boardRef: 'boardA' }],
      { boxA: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'boardA', x: 1, y: 0 }, 'up', HALF)
    expect(result).toEqual({ location: { board: 'root', x: 1, y: 0 }, relativeCoord: HALF })
  })

  it('produces a non-center fraction when exiting from an off-center column', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('boardA', 3)],
      [{ id: 'boxA', kind: 'container', boardRef: 'boardA' }],
      { boxA: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'boardA', x: 0, y: 0 }, 'up', HALF)
    expect(result).toEqual({ location: { board: 'root', x: 1, y: 0 }, relativeCoord: makeFraction(1, 6) })
  })

  it('fails to exit a board nothing else contains (e.g. the root board)', () => {
    const world = makeWorld([makeFloorBoard('root', 3)], [], {})
    const result = computeTarget(world, { board: 'root', x: 0, y: 1 }, 'left', HALF)
    expect(result).toBeNull()
  })

  it('crosses two board boundaries in a single call, chaining through two containers', () => {
    // boardC sits at the left edge of boardB (0,1); boardB in turn sits at
    // the center of root (1,1) — not the edge — so a single 'left' move
    // from the left edge of boardC exits boardC into boardB, immediately
    // exits boardB into root (since boardB's own position there is also
    // at boardB's left edge), and finally lands in-bounds inside root.
    const root = makeFloorBoard('root', 3)
    const boardB = makeFloorBoard('boardB', 3)
    const boardC = makeFloorBoard('boardC', 3)
    const world = makeWorld(
      [root, boardB, boardC],
      [
        { id: 'boxB', kind: 'container', boardRef: 'boardB' },
        { id: 'boxC', kind: 'container', boardRef: 'boardC' },
      ],
      {
        boxB: { board: 'root', x: 1, y: 1 },
        boxC: { board: 'boardB', x: 0, y: 1 },
      },
    )
    const result = computeTarget(world, { board: 'boardC', x: 0, y: 1 }, 'left', HALF)
    expect(result).toEqual({ location: { board: 'root', x: 0, y: 1 }, relativeCoord: HALF })
  })
})

describe('getEntryCell', () => {
  it('lands on the center cell of a 3x3 board for all four directions when relativeCoord is HALF', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'up', HALF)).toEqual({ cell: { x: 1, y: 2 }, newRelativeCoord: HALF })
    expect(getEntryCell(board, 'down', HALF)).toEqual({ cell: { x: 1, y: 0 }, newRelativeCoord: HALF })
    expect(getEntryCell(board, 'left', HALF)).toEqual({ cell: { x: 2, y: 1 }, newRelativeCoord: HALF })
    expect(getEntryCell(board, 'right', HALF)).toEqual({ cell: { x: 0, y: 1 }, newRelativeCoord: HALF })
  })

  it('lands on a non-center cell for a non-center relativeCoord', () => {
    const board = makeFloorBoard('inside', 4)
    expect(getEntryCell(board, 'down', makeFraction(3, 8))).toEqual({
      cell: { x: 1, y: 0 },
      newRelativeCoord: HALF,
    })
  })

  it('backs up one cell on an exact-boundary left/right entry, still in bounds', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'left', makeFraction(2, 3))).toEqual({ cell: { x: 2, y: 1 }, newRelativeCoord: ONE })
    expect(getEntryCell(board, 'right', makeFraction(2, 3))).toEqual({ cell: { x: 0, y: 1 }, newRelativeCoord: ONE })
  })

  it('does not apply the back-up rule to up/down entry on the same exact-boundary input', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'up', makeFraction(2, 3))).toEqual({ cell: { x: 2, y: 2 }, newRelativeCoord: ZERO })
    expect(getEntryCell(board, 'down', makeFraction(2, 3))).toEqual({ cell: { x: 2, y: 0 }, newRelativeCoord: ZERO })
  })

  it('returns a null cell instead of a negative index when the boundary case lands out of bounds', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'left', ZERO)).toEqual({ cell: null, newRelativeCoord: ONE })
    expect(getEntryCell(board, 'right', ZERO)).toEqual({ cell: null, newRelativeCoord: ONE })
  })

  it('never needs the null case for up/down, even at the same zero input', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'down', ZERO)).toEqual({ cell: { x: 0, y: 0 }, newRelativeCoord: ZERO })
  })
})

import { applyMove } from './rules'
import { PLAYER_ID } from './types'
import { setWall } from './testFixtures'

describe('applyMove — push only', () => {
  it('moves the player into an empty floor cell', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
  })

  it('fails when the target cell is a wall', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 1, 0)
    const world = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })

  it('pushes a single normal box into empty space', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box1', kind: 'normal' }],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        box1: { board: 'root', x: 1, y: 0 },
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
    expect(next?.locations.box1).toEqual({ board: 'root', x: 2, y: 0 })
  })

  it('fails to push a chain of normal boxes against a wall — nothing moves', () => {
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 0)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'box1', kind: 'normal' },
        { id: 'box2', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        box1: { board: 'root', x: 1, y: 0 },
        box2: { board: 'root', x: 2, y: 0 },
      },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })
})
