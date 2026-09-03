import { describe, it, expect } from 'vitest'
import { computeTarget, getEntryCell, applyMove, tryEnter } from './rules'
import { HALF, makeFraction, ZERO, ONE } from './fraction'
import { makeFloorBoard, makeWorld, setWall } from './testFixtures'
import { PLAYER_ID } from './types'

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

describe('applyMove — enter', () => {
  it('pushes a normal box into an adjacent container box, entering at the center', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'normalBox', kind: 'normal' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        normalBox: { board: 'root', x: 1, y: 1 },
        containerBox: { board: 'root', x: 2, y: 1 },
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
    expect(next?.locations.normalBox).toEqual({ board: 'inside', x: 0, y: 1 })
    expect(next?.locations.containerBox).toEqual({ board: 'root', x: 2, y: 1 })
  })

  it('lets the player walk directly into a container box', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        containerBox: { board: 'root', x: 1, y: 0 },
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'inside', x: 0, y: 1 })
    expect(next?.locations.containerBox).toEqual({ board: 'root', x: 1, y: 0 })
  })

  it('fails to enter when the center entry cell is a wall', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    setWall(inside, 0, 1) // the 'right'-direction entry cell for a 3x3 board
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'normalBox', kind: 'normal' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        normalBox: { board: 'root', x: 1, y: 1 },
        containerBox: { board: 'root', x: 2, y: 1 },
      },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })

  it('fails to enter when the entry cell is occupied by something that cannot itself move', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    setWall(inside, 1, 1) // wall directly behind the entry cell, blocking any further push
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'normalBox', kind: 'normal' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
        { id: 'blocker', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        normalBox: { board: 'root', x: 1, y: 1 },
        containerBox: { board: 'root', x: 2, y: 1 },
        blocker: { board: 'inside', x: 0, y: 1 }, // sits on the entry cell itself
      },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })

  it('tryEnter refuses to enter a container already marked as being entered, without recursing', () => {
    // This is a direct unit test of the beingEntered guard's own
    // short-circuit line, not a black-box test through applyMove. An
    // earlier version of this test tried to trigger the guard indirectly
    // by constructing a container whose boardRef equals the board it sits
    // on (a "self-containing box"). That construction doesn't actually
    // exercise this guard at all: findContainerFor(world, 'root') would
    // return that very container as root's "owner", so computeTarget's
    // board-exit recursion (a separate function with no cycle detection of
    // its own) loops forever on identical arguments before beingEntered is
    // ever consulted. That's a known, deliberately out-of-scope limitation
    // of computeTarget (self-recursive boards are explicitly deferred past
    // this sub-project), not a gap in this guard — and it can never arise
    // from a real level: parseLevel (Task 11) rejects any board that isn't
    // referenced by exactly one container (or, for the one true root,
    // zero), which this shape violates. So instead: call tryEnter directly
    // with a beingEntered set that already contains the target container's
    // id, and assert the guard's own `if (beingEntered.has(intoId)) return
    // null` line fires immediately — no push, no board traversal, no
    // reliance on any other function's cycle behavior.
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        containerBox: { board: 'root', x: 1, y: 1 },
      },
    )
    const result = tryEnter(
      world, PLAYER_ID, 'containerBox', 'right', HALF,
      new Map(), new Set(['containerBox']),
    )
    expect(result).toBeNull()
  })
})

describe('applyMove — eat', () => {
  it('absorbs a normal box into the back of a container box being pushed into it', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 3)
    setWall(root, 3, 1) // wall behind the normal box — it cannot be pushed further
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
        { id: 'normalBox', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        containerBox: { board: 'root', x: 1, y: 1 },
        normalBox: { board: 'root', x: 2, y: 1 },
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
    expect(next?.locations.containerBox).toEqual({ board: 'root', x: 2, y: 1 })
    // Eaten from the opposite side (left) of the container's interior, entering at its center.
    expect(next?.locations.normalBox).toEqual({ board: 'inside', x: 2, y: 1 })
  })

  it('fails outright when the mover is not a container (no eat possible)', () => {
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 1)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'normalBox1', kind: 'normal' },
        { id: 'normalBox2', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        normalBox1: { board: 'root', x: 1, y: 1 },
        normalBox2: { board: 'root', x: 2, y: 1 },
      },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })
})

describe('applyMove — exiting a box', () => {
  it('lets the player walk out of a container through an open edge into the parent board', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'inside', x: 1, y: 0 },
        containerBox: { board: 'root', x: 1, y: 1 },
      },
    )
    const next = applyMove(world, 'up')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
  })

  it('exits into an occupied cell that requires entering another box, whose own entry cell is also occupied', () => {
    // Player exits boardA into root, landing exactly on containerB (an
    // occupied cell) — this forces an `enter` into boardB. boardB's own
    // entry cell for that direction is occupied by normalBox, which can
    // still be pushed one cell further inside boardB. This exercises
    // exit -> occupied-entry -> enter -> occupied-entry -> recursive push,
    // plus inMotion and beingEntered, together in one fixture.
    const root = makeFloorBoard('root', 3)
    const boardA = makeFloorBoard('boardA', 3)
    const boardB = makeFloorBoard('boardB', 3)
    const world = makeWorld(
      [root, boardA, boardB],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'boxA', kind: 'container', boardRef: 'boardA' },
        { id: 'boxB', kind: 'container', boardRef: 'boardB' },
        { id: 'normalBox', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'boardA', x: 2, y: 1 }, // right edge, middle row
        boxA: { board: 'root', x: 1, y: 1 },           // center of root
        boxB: { board: 'root', x: 2, y: 1 },           // immediately right of boxA
        normalBox: { board: 'boardB', x: 0, y: 1 },     // sits on boardB's 'right'-entry cell
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'boardB', x: 0, y: 1 })
    expect(next?.locations.normalBox).toEqual({ board: 'boardB', x: 1, y: 1 })
    expect(next?.locations.boxA).toEqual({ board: 'root', x: 1, y: 1 })
    expect(next?.locations.boxB).toEqual({ board: 'root', x: 2, y: 1 })
  })
})
