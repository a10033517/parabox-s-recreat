import { describe, it, expect } from 'vitest'
import { computeTarget, getEntryCell, applyMove, tryEnter, tryMovePiece, resolveBlocked, resolveInfiniteExit, checkWin } from './rules'
import { HALF, makeFraction, ZERO, ONE } from './fraction'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from './testFixtures'
import { PLAYER_ID } from './types'

describe('computeTarget', () => {
  it('returns the adjacent cell unchanged when it stays within the board', () => {
    const world = makeWorld([makeFloorBoard('root', 3)], [], {})
    const result = computeTarget(world, { board: 'root', x: 1, y: 1 }, 'right', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 2, y: 1 }, relativeCoord: HALF })
  })

  it('exits into the parent board through the container piece that owns this board', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('boardA', 3)],
      [{ id: 'boxA', kind: 'container', boardRef: 'boardA' }],
      { boxA: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'boardA', x: 1, y: 0 }, 'up', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 1, y: 0 }, relativeCoord: HALF })
  })

  it('produces a non-center fraction when exiting from an off-center column', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('boardA', 3)],
      [{ id: 'boxA', kind: 'container', boardRef: 'boardA' }],
      { boxA: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'boardA', x: 0, y: 0 }, 'up', HALF)
    expect(result).toEqual({
      kind: 'location',
      location: { board: 'root', x: 1, y: 0 },
      relativeCoord: makeFraction(1, 6),
    })
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
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 0, y: 1 }, relativeCoord: HALF })
  })

  it('classifies as infinite when the recursive exit repeats the same out-of-bounds board', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root' }],
      { loopBox: { board: 'root', x: 0, y: 1 } }, // flush against the left edge
    )
    const result = computeTarget(world, { board: 'root', x: 0, y: 0 }, 'left', HALF)
    expect(result).toEqual({ kind: 'infinite', board: 'root', ownerId: 'loopBox' })
  })

  it('infinite result names the board that actually repeats, even when it is not the moved piece\'s own starting board', () => {
    // branchBoard hangs off root (owned by branchPiece, sitting flush on root).
    // root<->redInterior is a genuine 2-node cycle (redPiece/yellowPiece), both
    // also flush. A piece starting on branchBoard climbs branchBoard -> root ->
    // redInterior -> root again — the repeat is on root (owned by yellowPiece),
    // three hops from where the piece actually started, not on branchBoard itself.
    const root = makeFloorBoard('root', 4)
    const redInterior = makeFloorBoard('redInterior', 4)
    const branchBoard = makeFloorBoard('branchBoard', 2)
    const world = makeWorld(
      [root, redInterior, branchBoard],
      [
        { id: 'branchPiece', kind: 'container', boardRef: 'branchBoard' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'root' },
      ],
      {
        branchPiece: { board: 'root', x: 3, y: 0 }, // flush right on root
        redPiece: { board: 'root', x: 3, y: 1 },    // flush right on root
        yellowPiece: { board: 'redInterior', x: 3, y: 1 }, // flush right on redInterior
      },
    )
    const result = computeTarget(world, { board: 'branchBoard', x: 1, y: 0 }, 'right', HALF)
    expect(result).toEqual({ kind: 'infinite', board: 'root', ownerId: 'yellowPiece' })
  })

  it('a non-cyclic boundary (no owner to climb through) is blocked, not infinite', () => {
    const world = makeWorld([makeFloorBoard('root', 2)], [], {})
    const result = computeTarget(world, { board: 'root', x: 0, y: 0 }, 'left', HALF)
    expect(result).toBeNull()
  })

  it('resolves as a normal wrap when the recursive owner position lands in bounds', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root' }],
      { loopBox: { board: 'root', x: 0, y: 1 } }, // flush left, but not flush top/bottom
    )
    const result = computeTarget(world, { board: 'root', x: 0, y: 0 }, 'up', HALF)
    expect(result).toEqual({
      kind: 'location',
      location: { board: 'root', x: 0, y: 0 },
      relativeCoord: makeFraction(1, 6),
    })
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
    // short-circuit line, not a black-box test through applyMove — nothing
    // that calls tryEnter naturally re-enters the same container within one
    // move today, so there's no organic way to reach this line through
    // applyMove alone. Call tryEnter directly with a beingEntered set that
    // already contains the target container's id, and assert the guard's
    // own `if (beingEntered.has(intoId)) return null` line fires
    // immediately — no push, no board traversal.
    //
    // This guard is unrelated to computeTarget's own cycle detection (its
    // `visited` set, added for self-referencing "loop" boxes — see the
    // computeTarget tests above): that detects a board-EXIT climb repeating
    // a board it already left, not a re-entry. A self-referencing
    // container's own board-exit climb is now handled correctly (it
    // resolves to `{ kind: 'infinite' }` rather than hanging), so the
    // original reason this test avoided that construction no longer
    // applies — but calling the guard directly is still the more precise
    // test of this specific line, so the approach is unchanged.
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

describe('tryMovePiece — inMotion loop guard', () => {
  it('treats a piece already moving the same direction as a consistent no-op success', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 1 } },
    )
    const inMotion = new Map([['box1', 'right' as const]])
    const result = tryMovePiece(world, 'box1', 'right', inMotion, new Set())
    expect(result).toBe(world) // unchanged world, returned as-is
  })

  it('fails when a piece already moving is asked to move in a conflicting direction', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 1 } },
    )
    const inMotion = new Map([['box1', 'right' as const]])
    const result = tryMovePiece(world, 'box1', 'up', inMotion, new Set())
    expect(result).toBeNull()
  })
})

describe('checkWin', () => {
  it('is true when there are no requirements anywhere', () => {
    const world = makeWorld([makeFloorBoard('root', 2)], [], {})
    expect(checkWin(world)).toBe(true)
  })

  it('accepts a normal box on a box requirement', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'box')
    const world = makeWorld(
      [root],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(world)).toBe(true)
  })

  it('accepts a container box on a box requirement', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'box')
    const world = makeWorld(
      [root, makeFloorBoard('inside', 1)],
      [{ id: 'box1', kind: 'container', boardRef: 'inside' }],
      { box1: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(world)).toBe(true)
  })

  it('rejects the player on a box requirement', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'box')
    const world = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(world)).toBe(false)
  })

  it('accepts only the player on a player requirement', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'player')
    const worldWithPlayer = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(worldWithPlayer)).toBe(true)

    const worldWithBox = makeWorld(
      [root],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(worldWithBox)).toBe(false)
  })

  it('is false when a requirement anywhere is unmet, even if others are satisfied', () => {
    const root = makeFloorBoard('root', 3)
    setRequirement(root, 1, 0, 'box')
    setRequirement(root, 2, 0, 'box')
    const world = makeWorld(
      [root],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 0 } }, // (2,0) has no occupant
    )
    expect(checkWin(world)).toBe(false)
  })

  it('checks requirements across every board, not just the root', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    setRequirement(inside, 1, 0, 'box')
    const world = makeWorld(
      [root, inside],
      [
        { id: 'outerBox', kind: 'container', boardRef: 'inside' },
        { id: 'innerBox', kind: 'normal' },
      ],
      {
        outerBox: { board: 'root', x: 0, y: 0 },
        innerBox: { board: 'inside', x: 1, y: 0 },
      },
    )
    expect(checkWin(world)).toBe(true)
  })
})

describe('tryMovePiece / applyMove — infinite regress', () => {
  it('sends the player directly to the Void when its own move resolves to infinite', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        loopBox: { board: 'root', x: 0, y: 0 }, // flush corner
      },
    )
    const next = applyMove(world, 'left')
    expect(next).not.toBeNull()
    expect(next?.pieces['void-infinite:loopBox']).toEqual({ id: 'void-infinite:loopBox', kind: 'normal', infiniteFor: 'loopBox' })
    expect(next?.locations['void-infinite:loopBox']).toEqual({ board: 'void', x: 2, y: 2 })
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'void', x: 1, y: 2 }) // left of the destination — pushed left, exits left
    expect(next?.pieces[PLAYER_ID]).toEqual({ id: PLAYER_ID, kind: 'player' })
  })

  it('exiting a board via a non-flush self-loop owner wraps to a different cell of the same board, without crashing', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        loopBox: { board: 'root', x: 1, y: 1 }, // center — not flush against any edge
      },
    )
    const next = applyMove(world, 'up')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
    expect(next?.locations.loopBox).toEqual({ board: 'root', x: 1, y: 1 })
  })

  it('sends a self-loop box to the Void when pushed flush against the board it owns, letting the pusher complete its move', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 1, y: 1 },
        loopBox: { board: 'root', x: 2, y: 1 }, // already flush against the right edge
      },
    )
    const next = applyMove(world, 'right')
    expect(next).not.toBeNull()
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 2, y: 1 })
    expect(next?.pieces['void-infinite:loopBox']).toEqual({ id: 'void-infinite:loopBox', kind: 'normal', infiniteFor: 'loopBox' })
    expect(next?.locations['void-infinite:loopBox']).toEqual({ board: 'void', x: 2, y: 2 })
    expect(next?.locations.loopBox).toEqual({ board: 'void', x: 3, y: 2 }) // right of its own destination — pushed right, exits right
    expect(next?.pieces.loopBox).toEqual({ id: 'loopBox', kind: 'container', boardRef: 'root' })
  })

  it('resolveBlocked sends the player to the Void when pushing it resolves to infinite, treating it the same as any other piece', () => {
    // Constructing an organic applyMove scenario where the player ends up as
    // a *pushed* occupant (rather than the move's own top-level mover) needs
    // a multi-board container-entry setup elaborate enough to obscure the
    // actual thing being tested. Call resolveBlocked directly instead, with
    // the player as the occupant being pushed into a self-loop trap.
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: 'pusher', kind: 'normal' },
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        pusher: { board: 'root', x: 1, y: 0 },
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, // flush against the left edge
        loopBox: { board: 'root', x: 0, y: 1 },     // also flush left — same climb, same result
      },
    )
    const target = computeTarget(world, world.locations.pusher, 'left', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup: pusher must have a valid target')
    const result = resolveBlocked(world, 'pusher', PLAYER_ID, target, 'left', new Map(), new Set())
    expect(result?.locations.pusher).toEqual({ board: 'root', x: 0, y: 0 })
    expect(result?.pieces['void-infinite:loopBox']).toEqual({ id: 'void-infinite:loopBox', kind: 'normal', infiniteFor: 'loopBox' })
    expect(result?.locations['void-infinite:loopBox']).toEqual({ board: 'void', x: 2, y: 2 })
    expect(result?.locations[PLAYER_ID]).toEqual({ board: 'void', x: 1, y: 2 }) // left of the destination — pushed left, exits left
    expect(result?.pieces[PLAYER_ID]).toEqual({ id: PLAYER_ID, kind: 'player' })
    expect(result?.locations.loopBox).toEqual({ board: 'root', x: 0, y: 1 })
  })
})

describe('resolveInfiniteExit — exits in the same direction it was pushed, chaining a push if blocked', () => {
  it('a piece pushed right exits to the right of its destination', () => {
    const world = makeWorld([makeFloorBoard('root', 2)], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'root', x: 0, y: 0 } })
    const result = resolveInfiniteExit(world, 'box1', 'ownerA', 'right', new Map())!
    expect(result.locations['void-infinite:ownerA']).toEqual({ board: 'void', x: 2, y: 2 })
    expect(result.locations.box1).toEqual({ board: 'void', x: 3, y: 2 })
  })

  it('a piece pushed up exits above its destination', () => {
    const world = makeWorld([makeFloorBoard('root', 2)], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'root', x: 0, y: 0 } })
    const result = resolveInfiniteExit(world, 'box1', 'ownerA', 'up', new Map())!
    expect(result.locations.box1).toEqual({ board: 'void', x: 2, y: 1 })
  })

  it('a second arrival through the same owner and direction pushes the first exited piece further, rather than landing elsewhere', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 2)],
      [
        { id: 'box1', kind: 'normal' },
        { id: 'box2', kind: 'normal' },
      ],
      {
        box1: { board: 'root', x: 0, y: 0 },
        box2: { board: 'root', x: 1, y: 0 },
      },
    )
    const after1 = resolveInfiniteExit(world, 'box1', 'ownerA', 'right', new Map())!
    const after2 = resolveInfiniteExit(after1, 'box2', 'ownerA', 'right', new Map())!
    expect(after2.locations.box1).toEqual({ board: 'void', x: 4, y: 2 }) // pushed one further right
    expect(after2.locations.box2).toEqual({ board: 'void', x: 3, y: 2 }) // takes the freed cell right next to the destination
  })

  it('returns null when the exit direction points off the Void\'s own edge', () => {
    const voidBoard = { id: 'void', size: 5, cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'floor' as const }))) }
    const world = makeWorld(
      [makeFloorBoard('root', 2), voidBoard],
      [
        { id: 'destOwner', kind: 'normal', infiniteFor: 'ownerB' },
        { id: 'box3', kind: 'normal' },
      ],
      {
        destOwner: { board: 'void', x: 4, y: 2 }, // already flush against the Void's right edge
        box3: { board: 'root', x: 0, y: 0 },
      },
    )
    expect(resolveInfiniteExit(world, 'box3', 'ownerB', 'right', new Map())).toBeNull()
  })

  it('returns null, mutating nothing, when the exit cell is occupied and cannot be pushed further', () => {
    const voidBoard = { id: 'void', size: 5, cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'floor' as const }))) }
    const world = makeWorld(
      [makeFloorBoard('root', 2), voidBoard],
      [
        { id: 'destOwner', kind: 'normal', infiniteFor: 'ownerC' },
        { id: 'blocker', kind: 'normal' }, // flush against the Void's own edge — can't be pushed further right
        { id: 'box4', kind: 'normal' },
      ],
      {
        destOwner: { board: 'void', x: 3, y: 2 },
        blocker: { board: 'void', x: 4, y: 2 },
        box4: { board: 'root', x: 0, y: 0 },
      },
    )
    expect(resolveInfiniteExit(world, 'box4', 'ownerC', 'right', new Map())).toBeNull()
    expect(world.locations.box4).toEqual({ board: 'root', x: 0, y: 0 }) // untouched
  })
})

describe('applyMove — entering a self-loop box directly', () => {
  it('enters a self-loop box (forced by a wall behind it) landing on a cell of the same board it owns', () => {
    // A wall directly behind loopBox in the push direction means pushing it
    // fails, forcing tryEnter to be attempted instead of tryMovePiece's
    // push path — this is the genuinely-uncovered path (unlike the
    // "non-flush edge wraps" test above, which never calls tryEnter at
    // all). Board size 4, and the player NOT flush against the left edge,
    // so the computed entry cell (0,1) is distinguishable from the
        // player's own starting cell (1,1) — proving an actual move happened.
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 1) // directly behind loopBox in the push direction
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 1, y: 1 },
        loopBox: { board: 'root', x: 2, y: 1 },
      },
    )
    const next = applyMove(world, 'right')
    expect(next).not.toBeNull()
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 1 })
    expect(next?.locations.loopBox).toEqual({ board: 'root', x: 2, y: 1 }) // unmoved — the push failed
  })
})

describe('resolveBlocked — locked pieces push only, never enter or eat, on either side', () => {
  // "Locked" is now derived from physically standing on the Void board (see
  // isInVoid in types.ts), not a separately-tracked flag — so these fixtures
  // place pieces directly on a plain 5x5 'void' board (identical in shape to
  // the real one, now that it has no wall cells) rather than tagging them
  // `locked: true`. resolveBlocked is called directly with a hand-built
  // target rather than derived via computeTarget, since these are low-level
  // unit tests of the guard itself, not full realistic move simulations.
  it('an unlocked pusher can push a locked occupant when the destination beyond it is free', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 2), makeFloorBoard('void', 5)],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'locked1', kind: 'normal' },
      ],
      {
        pusher: { board: 'root', x: 0, y: 0 }, // not in the Void — the "unlocked" side
        locked1: { board: 'void', x: 2, y: 2 },
      },
    )
    const target = { location: { board: 'void', x: 2, y: 2 }, relativeCoord: HALF }
    const result = resolveBlocked(world, 'pusher', 'locked1', target, 'right', new Map(), new Set())
    expect(result?.locations.pusher).toEqual({ board: 'void', x: 2, y: 2 })
    expect(result?.locations.locked1).toEqual({ board: 'void', x: 3, y: 2 })
  })

  it('an unlocked pusher cannot enter or eat a locked occupant when the push fails', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 4), makeFloorBoard('void', 5)],
      [
        { id: 'pusher', kind: 'container', boardRef: 'root' }, // a container, so "eaten" would otherwise be viable
        { id: 'locked1', kind: 'normal' },
      ],
      {
        pusher: { board: 'root', x: 0, y: 0 },
        locked1: { board: 'void', x: 4, y: 2 }, // flush against the Void's own edge — push fails
      },
    )
    const target = { location: { board: 'void', x: 4, y: 2 }, relativeCoord: HALF }
    const result = resolveBlocked(world, 'pusher', 'locked1', target, 'right', new Map(), new Set())
    expect(result).toBeNull()
  })

  it('a locked moving piece can push an unlocked occupant when the push succeeds', () => {
    const world = makeWorld(
      [makeFloorBoard('void', 5)],
      [
        { id: 'locked1', kind: 'normal' },
        { id: 'normalBox', kind: 'normal' },
      ],
      {
        locked1: { board: 'void', x: 2, y: 2 },
        normalBox: { board: 'void', x: 3, y: 2 },
      },
    )
    const target = { location: { board: 'void', x: 3, y: 2 }, relativeCoord: HALF }
    const result = resolveBlocked(world, 'locked1', 'normalBox', target, 'right', new Map(), new Set())
    expect(result?.locations.locked1).toEqual({ board: 'void', x: 3, y: 2 })
    expect(result?.locations.normalBox).toEqual({ board: 'void', x: 4, y: 2 })
  })

  it('a locked moving piece cannot enter or eat an unlocked occupant when its push fails', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('void', 5)],
      [
        { id: 'locked1', kind: 'normal' },
        { id: 'normalBox', kind: 'container', boardRef: 'root' }, // a container, so "entered" would otherwise be viable
      ],
      {
        locked1: { board: 'void', x: 2, y: 2 },
        normalBox: { board: 'void', x: 4, y: 2 }, // flush against the Void's own edge — push fails
      },
    )
    const target = { location: { board: 'void', x: 4, y: 2 }, relativeCoord: HALF }
    const result = resolveBlocked(world, 'locked1', 'normalBox', target, 'right', new Map(), new Set())
    expect(result).toBeNull()
  })

  it('two locked pieces: a successful push chain is still allowed', () => {
    const world = makeWorld(
      [makeFloorBoard('void', 5)],
      [
        { id: 'locked1', kind: 'normal' },
        { id: 'locked2', kind: 'normal' },
      ],
      {
        locked1: { board: 'void', x: 1, y: 2 },
        locked2: { board: 'void', x: 2, y: 2 },
      },
    )
    const target = { location: { board: 'void', x: 2, y: 2 }, relativeCoord: HALF }
    const result = resolveBlocked(world, 'locked1', 'locked2', target, 'right', new Map(), new Set())
    expect(result?.locations.locked1).toEqual({ board: 'void', x: 2, y: 2 })
    expect(result?.locations.locked2).toEqual({ board: 'void', x: 3, y: 2 })
  })

  it('two locked pieces: a failed push returns null, no enter/eat fallback on either side', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('void', 5)],
      [
        { id: 'locked1', kind: 'container', boardRef: 'root' },
        { id: 'locked2', kind: 'container', boardRef: 'root' },
      ],
      {
        locked1: { board: 'void', x: 3, y: 2 },
        locked2: { board: 'void', x: 4, y: 2 }, // flush against the Void's own edge — push fails
      },
    )
    const target = { location: { board: 'void', x: 4, y: 2 }, relativeCoord: HALF }
    const result = resolveBlocked(world, 'locked1', 'locked2', target, 'right', new Map(), new Set())
    expect(result).toBeNull()
  })

  it('control: two unlocked pieces at the same coordinates still resolve via ordinary enter/eat, proving the guard is keyed on locked, not on position', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 0) // directly behind the occupant — push fails, forcing entry
    const world = makeWorld(
      [root],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'container1', kind: 'container', boardRef: 'root' }, // self-loop, so entry lands back on 'root'
      ],
      {
        pusher: { board: 'root', x: 0, y: 0 },
        container1: { board: 'root', x: 1, y: 0 },
      },
    )
    const target = computeTarget(world, world.locations.pusher, 'right', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup')
    const result = resolveBlocked(world, 'pusher', 'container1', target, 'right', new Map(), new Set())
    expect(result).not.toBeNull() // entry succeeded — not blocked the way a locked occupant would be
  })
})

describe('tryMovePiece — infinite resolution when the Void is full', () => {
  it('fails the whole move cleanly, leaving the pusher and the piece being pushed into infinite untouched', () => {
    const voidCells: { x: number; y: number }[] = [
      { x: 2, y: 2 },
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 1, y: 2 },                 { x: 3, y: 2 },
      { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
      { x: 0, y: 1 },                                                 { x: 4, y: 1 },
      { x: 0, y: 2 },                                                 { x: 4, y: 2 },
      { x: 0, y: 3 },                                                 { x: 4, y: 3 },
      { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
    ]
    const voidBoard = {
      id: 'void',
      size: 5,
      cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'floor' as const }))),
    }
    const fillerPieces = voidCells.map((_, i) => ({ id: `filler${i}`, kind: 'normal' as const }))
    const fillerLocations = Object.fromEntries(
      voidCells.map(({ x, y }, i) => [`filler${i}`, { board: 'void', x, y }]),
    )
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root, voidBoard],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
        ...fillerPieces,
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        loopBox: { board: 'root', x: 0, y: 0 }, // flush corner — pushing left resolves to infinite
        ...fillerLocations,
      },
    )
    const next = applyMove(world, 'left')
    expect(next).toBeNull()
  })
})
