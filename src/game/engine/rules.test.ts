import { describe, it, expect } from 'vitest'
import { computeTarget, getEntryCell, applyMove, tryEnter, tryMovePiece, resolveBlocked, resolveInfiniteExit, resolveCloneTeleport, checkWin } from './rules'
import { HALF, makeFraction, ZERO, ONE } from './fraction'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from './testFixtures'
import { PLAYER_ID, Attempt, World } from './types'

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
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 1, y: 0 }, relativeCoord: HALF, viaOwner: 'boxA' })
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
      viaOwner: 'boxA',
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
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 0, y: 1 }, relativeCoord: HALF, viaOwner: 'boxC' })
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
    // Attribution is by the FIRST room exited (branchPiece), not by the owner that happens
    // to close the cycle (yellowPiece) — per the spec, a paradox keeps its first-transition seed.
    expect(result).toEqual({ kind: 'infinite', board: 'root', ownerId: 'branchPiece' })
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
      viaOwner: 'loopBox',
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
    expect(next?.locations['void-infinite:loopBox']).toEqual({ board: 'void', x: 3, y: 3 })
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'void', x: 2, y: 3 }) // left of the destination — pushed left, exits left
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
    expect(next?.locations['void-infinite:loopBox']).toEqual({ board: 'void', x: 3, y: 3 })
    expect(next?.locations.loopBox).toEqual({ board: 'void', x: 4, y: 3 }) // right of its own destination — pushed right, exits right
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
    expect(result?.locations['void-infinite:loopBox']).toEqual({ board: 'void', x: 3, y: 3 })
    expect(result?.locations[PLAYER_ID]).toEqual({ board: 'void', x: 2, y: 3 }) // left of the destination — pushed left, exits left
    expect(result?.pieces[PLAYER_ID]).toEqual({ id: PLAYER_ID, kind: 'player' })
    expect(result?.locations.loopBox).toEqual({ board: 'root', x: 0, y: 1 })
  })
})

describe('resolveInfiniteExit — exits in the same direction it was pushed, chaining a push if blocked', () => {
  it('a piece pushed right exits to the right of its destination', () => {
    const world = makeWorld([makeFloorBoard('root', 2)], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'root', x: 0, y: 0 } })
    const result = resolveInfiniteExit(world, 'box1', 'ownerA', 'right', new Map())!
    expect(result.locations['void-infinite:ownerA']).toEqual({ board: 'void', x: 3, y: 3 })
    expect(result.locations.box1).toEqual({ board: 'void', x: 4, y: 3 })
  })

  it('a piece pushed up exits above its destination', () => {
    const world = makeWorld([makeFloorBoard('root', 2)], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'root', x: 0, y: 0 } })
    const result = resolveInfiniteExit(world, 'box1', 'ownerA', 'up', new Map())!
    expect(result.locations.box1).toEqual({ board: 'void', x: 3, y: 2 })
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
    expect(after2.locations.box1).toEqual({ board: 'void', x: 5, y: 3 }) // pushed one further right
    expect(after2.locations.box2).toEqual({ board: 'void', x: 4, y: 3 }) // takes the freed cell right next to the destination
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

describe('resolveCloneTeleport — entering a clone redirects to its main body\'s current location', () => {
  it('teleports the entrant directly there when the main body\'s own board is not registered in the world (degrade-safe fallback, not a reachable "free cell" state)', () => {
    // occupantAt(world, world.locations[mainBodyId]) is provably always mainBodyId
    // itself in any valid world — a main body's own cell can never genuinely be
    // "free". This fixture instead exercises the degrade-safe fallback added for
    // when mainBodyId's own board isn't registered in `world.boards`: a
    // structurally odd but not unsafe shape that can't arise from a level
    // parseLevel accepts, but is handled cleanly rather than crashing.
    const world = makeWorld(
      [makeFloorBoard('root', 4)],
      [{ id: 'A', kind: 'normal' }, { id: 'entrant', kind: 'normal' }],
      { A: { board: 'somewhereElse', x: 0, y: 0 }, entrant: { board: 'root', x: 2, y: 0 } },
    )
    // A is on a board this fixture never declares in `boards` — deliberately: its
    // own board never needs to be walked, only its Location is read.
    const result = resolveCloneTeleport(world, 'entrant', 'A', 'right', new Map())
    expect(result?.locations.entrant).toEqual({ board: 'somewhereElse', x: 0, y: 0 })
  })

  it('pushes the main body one step further in the entrant\'s direction when its own cell is occupied (the common case — reproduces the confirmed worked example)', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld(
      [root],
      [
        { id: 'A', kind: 'container', boardRef: 'root' }, // self-loop main body
        { id: 'B', kind: 'container', cloneOf: 'A', boardRef: 'root' },
        { id: 'entrant', kind: 'normal' },
      ],
      {
        A: { board: 'root', x: 0, y: 0 },
        B: { board: 'root', x: 3, y: 0 },
        entrant: { board: 'root', x: 2, y: 0 },
      },
    )
    const result = resolveCloneTeleport(world, 'entrant', 'A', 'right', new Map())!
    expect(result.locations.A).toEqual({ board: 'root', x: 1, y: 0 }) // pushed one step right
    expect(result.locations.entrant).toEqual({ board: 'root', x: 0, y: 0 }) // takes A's old cell
  })

  it('fails the whole move when the main body cannot be pushed further', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld(
      [root],
      [{ id: 'A', kind: 'normal' }, { id: 'entrant', kind: 'normal' }],
      { A: { board: 'root', x: 0, y: 0 }, entrant: { board: 'root', x: 2, y: 0 } }, // A flush against the left edge
    )
    const result = resolveCloneTeleport(world, 'entrant', 'A', 'left', new Map())
    expect(result).toBeNull()
    expect(world.locations.A).toEqual({ board: 'root', x: 0, y: 0 }) // untouched
    expect(world.locations.entrant).toEqual({ board: 'root', x: 2, y: 0 }) // untouched
  })

  it('fails cleanly (does not throw) when cloneOf names a piece with no location', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: 'entrant', kind: 'normal' }],
      { entrant: { board: 'root', x: 0, y: 0 } },
    )
    expect(resolveCloneTeleport(world, 'entrant', 'nonexistent', 'right', new Map())).toBeNull()
  })
})

describe('tryEnter — a clone redirects before normal container entry', () => {
  it('an ordinary box (not the player) pushed into a clone of a container enters the SOURCE interior, exactly like entering the source', () => {
    // A sits well away from pusher's own row so the push-chain that follows (pusher
    // -> tries to enter B -> redirects to A -> pushes A) can't loop back onto pusher
    // itself — hand-traced against the exact resolveBlocked/resolveCloneTeleport
    // logic before writing this down: pusher ends up at A's OLD location (A's cell,
    // vacated), A ends up pushed one step further right.
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 1) // directly behind B — push fails, forcing tryEnter
    const world = makeWorld(
      [root],
      [
        { id: 'A', kind: 'container', boardRef: 'root' },
        { id: 'B', kind: 'container', cloneOf: 'A' }, // no boardRef needed (Task 1)
        { id: 'pusher', kind: 'normal' },
      ],
      {
        A: { board: 'root', x: 0, y: 3 },
        B: { board: 'root', x: 2, y: 1 },
        pusher: { board: 'root', x: 1, y: 1 },
      },
    )
    const direct = tryMovePiece(world, 'pusher', 'right', new Map(), new Set())!
    // A's interior is 'root' itself (self-loop): entering from the left at the row's
    // center lands on root's left edge, row 1. Neither A nor B moves.
    expect(direct.locations.pusher).toEqual({ board: 'root', x: 0, y: 1 })
    expect(direct.locations.A).toEqual({ board: 'root', x: 0, y: 3 })
    expect(direct.locations.B).toEqual({ board: 'root', x: 2, y: 1 })
  })

  it('control: entering an ordinary (non-clone) container is unaffected', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 1)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'C', kind: 'container', boardRef: 'inside' },
      ],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, C: { board: 'root', x: 1, y: 1 } },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID].board).toBe('inside') // entered normally, unaffected by Clone
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

describe('fliph — entry direction is horizontally mirrored', () => {
  it('entering a fliph container pushing right computes the same cell as pushing left into an identical non-flipped container', () => {
    const root = makeFloorBoard('root', 3)
    // no wall needed: the container sits at the board's edge (x=2 on a size-3
    // board), so pushing it further right is already out of bounds — the push
    // fails naturally, forcing entry
    const insideFlipped = makeFloorBoard('insideFlipped', 4)
    const insidePlain = makeFloorBoard('insidePlain', 4)
    const world = makeWorld(
      [root, insideFlipped, insidePlain],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'flipped', kind: 'container', boardRef: 'insideFlipped', fliph: true },
      ],
      { pusher: { board: 'root', x: 1, y: 1 }, flipped: { board: 'root', x: 2, y: 1 } },
    )
    const next = tryMovePiece(world, 'pusher', 'right', new Map(), new Set())
    expect(next?.locations.pusher).toEqual({ board: 'insideFlipped', x: 3, y: 1 }) // mirrored entry cell — verified: getEntryCell(board,'left',HALF) = (3,1)
  })

  it('up/down entries are unaffected by fliph', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 1, 0) // directly behind the container in the push direction (pushing up)
    const insideFlipped = makeFloorBoard('insideFlipped', 4)
    const world = makeWorld(
      [root, insideFlipped],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'flipped', kind: 'container', boardRef: 'insideFlipped', fliph: true },
      ],
      { pusher: { board: 'root', x: 1, y: 2 }, flipped: { board: 'root', x: 1, y: 1 } },
    )
    const next = tryMovePiece(world, 'pusher', 'up', new Map(), new Set())
    expect(next?.locations.pusher).toEqual({ board: 'insideFlipped', x: 2, y: 3 }) // same as a non-flipped 'up' entry — verified: getEntryCell(board,'up',HALF) = (2,3)
  })

  it('control: entering a non-fliph container is unaffected', () => {
    const root = makeFloorBoard('root', 3)
    // no wall needed: the container sits at the board's edge (x=2 on a size-3
    // board), so pushing it further right is already out of bounds — the push
    // fails naturally, forcing entry
    const inside = makeFloorBoard('inside', 4)
    const world = makeWorld(
      [root, inside],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'plain', kind: 'container', boardRef: 'inside' },
      ],
      { pusher: { board: 'root', x: 1, y: 1 }, plain: { board: 'root', x: 2, y: 1 } },
    )
    const next = tryMovePiece(world, 'pusher', 'right', new Map(), new Set())
    expect(next?.locations.pusher).toEqual({ board: 'inside', x: 0, y: 1 }) // the ORIGINAL (non-mirrored) entry cell
  })
})

describe('fliph — exit direction is horizontally mirrored', () => {
  it('exiting a fliph container continues the climb in the mirrored direction (reproduces the derived example from the spec)', () => {
    const root = makeFloorBoard('root', 4)
    const xInterior = makeFloorBoard('Xinterior', 2)
    const world = makeWorld(
      [root, xInterior],
      [{ id: 'X', kind: 'container', boardRef: 'Xinterior', fliph: true }],
      { X: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'Xinterior', x: 1, y: 0 }, 'right', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 0, y: 1 }, relativeCoord: expect.anything(), viaOwner: 'X', dir: 'left', flipped: true })
  })

  it('control: exiting a non-fliph container is unaffected (same fixture, no fliph)', () => {
    const root = makeFloorBoard('root', 4)
    const xInterior = makeFloorBoard('Xinterior', 2)
    const world = makeWorld(
      [root, xInterior],
      [{ id: 'X', kind: 'container', boardRef: 'Xinterior' }],
      { X: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'Xinterior', x: 1, y: 0 }, 'right', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 2, y: 1 }, relativeCoord: expect.anything(), viaOwner: 'X' })
  })
})

describe('linkedTo — exiting a linked container lands at the mirrored-offset cell in the linked container\'s interior', () => {
  it('reproduces the confirmed example: exiting (3,1) of a 4x4 linked interior pushing right lands at (0,1) of the linked interior', () => {
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const c2Interior = makeFloorBoard('c2Interior', 4)
    const world = makeWorld(
      [c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 5, y: 0 } },
    )
    const result = computeTarget(world, { board: 'c1Interior', x: 3, y: 1 }, 'right', HALF)
    expect(result?.kind).toBe('location')
    expect(result && result.kind === 'location' ? result.location : null).toEqual({ board: 'c2Interior', x: 0, y: 1 })
  })

  it('all four directions map to the opposite edge at the matching offset', () => {
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const c2Interior = makeFloorBoard('c2Interior', 4)
    const world = makeWorld(
      [c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 5, y: 0 } },
    )
    const left = computeTarget(world, { board: 'c1Interior', x: 0, y: 2 }, 'left', HALF)
    const up = computeTarget(world, { board: 'c1Interior', x: 2, y: 0 }, 'up', HALF)
    const down = computeTarget(world, { board: 'c1Interior', x: 1, y: 3 }, 'down', HALF)
    expect(left?.kind === 'location' ? left.location : null).toEqual({ board: 'c2Interior', x: 3, y: 2 })
    expect(up?.kind === 'location' ? up.location : null).toEqual({ board: 'c2Interior', x: 2, y: 3 })
    expect(down?.kind === 'location' ? down.location : null).toEqual({ board: 'c2Interior', x: 1, y: 0 })
  })

  it('a one-directional link only affects exiting the linked side — C2 (unlinked) still climbs to its own owner normally', () => {
    const root = makeFloorBoard('root', 6)
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const c2Interior = makeFloorBoard('c2Interior', 4)
    const world = makeWorld(
      [root, c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior' }, // no linkedTo back
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 2, y: 2 } },
    )
    const result = computeTarget(world, { board: 'c2Interior', x: 3, y: 1 }, 'right', HALF)
    // Normal climb-to-owner: exits toward wherever C2 itself is (root), NOT toward C1.
    expect(result?.kind).toBe('location')
    expect(result && result.kind === 'location' ? result.location.board : null).toBe('root')
  })

  it('a malformed link (target has no boardRef) fails the move rather than falling back to normal climbing', () => {
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const world = makeWorld(
      [c1Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'ghost' },
        { id: 'ghost', kind: 'normal' }, // exists, but not a container — no boardRef
      ],
      { C1: { board: 'root', x: 0, y: 0 }, ghost: { board: 'root', x: 9, y: 9 } },
    )
    const result = computeTarget(world, { board: 'c1Interior', x: 3, y: 1 }, 'right', HALF)
    expect(result).toBeNull()
  })

  it('a size-mismatched link that maps out of bounds fails the move', () => {
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const c2InteriorSmaller = makeFloorBoard('c2Interior', 2) // mismatched size
    const world = makeWorld(
      [c1Interior, c2InteriorSmaller],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 5, y: 0 } },
    )
    // Exiting at y=3 (valid in a size-4 board) maps to y=3 in the linked board too
    // (linkedEntryCell preserves the offset unchanged) — out of bounds for a size-2 board.
    const result = computeTarget(world, { board: 'c1Interior', x: 3, y: 3 }, 'right', HALF)
    expect(result).toBeNull()
  })

  it('a link never triggers infinite-exit detection, even for a shape that would otherwise be a textbook cycle', () => {
    // C1 and C2 linked to each other, closing what WOULD be an infinite regress if
    // resolved via the normal climb — but a link resolution is terminal and never
    // touches `visited`, so this must resolve as an ordinary location, not infinite.
    const c1Interior = makeFloorBoard('c1Interior', 2)
    const c2Interior = makeFloorBoard('c2Interior', 2)
    const world = makeWorld(
      [c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior', linkedTo: 'C1' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 5, y: 0 } },
    )
    const result = computeTarget(world, { board: 'c1Interior', x: 1, y: 0 }, 'right', HALF)
    expect(result?.kind).toBe('location')
  })

  it('control: a container with no linkedTo climbs to its own owner exactly as before', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [{ id: 'C', kind: 'container', boardRef: 'inside' }],
      { C: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'inside', x: 2, y: 1 }, 'right', HALF)
    expect(result?.kind === 'location' ? result.location : null).toEqual({ board: 'root', x: 2, y: 1 })
  })
})

describe('attemptOrder — official "attempt_order" header decides push vs enter vs eat', () => {
  function pushableContainerWorld(attemptOrder?: Attempt[]) {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'C', kind: 'container', boardRef: 'inside' },
      ],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, C: { board: 'root', x: 1, y: 1 } },
    )
    if (attemptOrder) world.attemptOrder = attemptOrder
    return world
  }

  it('default order pushes a pushable container instead of entering it', () => {
    const next = applyMove(pushableContainerWorld(), 'right')!
    expect(next.locations.C).toEqual({ board: 'root', x: 2, y: 1 })
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
  })

  it('enter-first order still PUSHES a container with room behind it (real game, user-reported 2026-09-24)', () => {
    const next = applyMove(pushableContainerWorld(['enter', 'eat', 'push']), 'right')!
    expect(next.locations.C).toEqual({ board: 'root', x: 2, y: 1 })
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
  })

  it('enter-first order enters when the container cannot be pushed', () => {
    const world = pushableContainerWorld(['enter', 'eat', 'push'])
    setWall(world.boards.root, 2, 1)
    const next = applyMove(world, 'right')!
    expect(next.locations[PLAYER_ID].board).toBe('inside')
    expect(next.locations.C).toEqual({ board: 'root', x: 1, y: 1 })
  })

  it('attempt_order decides eat vs enter once push has failed', () => {
    // A (mover, container) into B (container), wall behind B: enter-first puts A inside B,
    // eat-first puts B inside A.
    const make = (order: Attempt[]) => {
      const root = makeFloorBoard('root', 4)
      setWall(root, 3, 1)
      const world = makeWorld(
        [root, makeFloorBoard('aIn', 3), makeFloorBoard('bIn', 3)],
        [
          { id: PLAYER_ID, kind: 'player' },
          { id: 'A', kind: 'container', boardRef: 'aIn' },
          { id: 'B', kind: 'container', boardRef: 'bIn' },
        ],
        { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, A: { board: 'root', x: 1, y: 1 }, B: { board: 'root', x: 2, y: 1 } },
      )
      world.attemptOrder = order
      return world
    }
    // The player itself would enter A first under enter-first, so move A directly.
    expect(tryMovePiece(make(['push', 'enter', 'eat']), 'A', 'right', new Map(), new Set())!.locations.A.board).toBe('bIn')
    expect(tryMovePiece(make(['push', 'eat', 'enter']), 'A', 'right', new Map(), new Set())!.locations.B.board).toBe('aIn')
  })
})

describe('eat only when the occupant cannot be pushed (user-observed in the real game, 2026-09-24)', () => {
  // Special case of "push is always tried first" (see resolveBlocked).
  // Player pushes A right into B. A's interior is walled on its left (player side, so the player
  // cannot enter A) but open on its right, so B could be eaten into A. B's interior is solid.
  function eatWorld(behindB: 'floor' | 'wall') {
    const root = makeFloorBoard('root', 5)
    if (behindB === 'wall') setWall(root, 4, 2)
    const aInside = makeFloorBoard('aInside', 3)
    setWall(aInside, 0, 1)
    const bInside = makeFloorBoard('bInside', 3)
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setWall(bInside, x, y)
    const world = makeWorld(
      [root, aInside, bInside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'A', kind: 'container', boardRef: 'aInside' },
        { id: 'B', kind: 'container', boardRef: 'bInside' },
      ],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 2 }, A: { board: 'root', x: 2, y: 2 }, B: { board: 'root', x: 3, y: 2 } },
    )
    world.attemptOrder = ['enter', 'eat', 'push']
    return world
  }

  it('B has free floor behind it: pushed, not eaten, although eat comes before push in the order', () => {
    const next = applyMove(eatWorld('floor'), 'right')!
    expect(next.locations.B).toEqual({ board: 'root', x: 4, y: 2 })
    expect(next.locations.A).toEqual({ board: 'root', x: 3, y: 2 })
  })

  it('B is against a wall: A eats B', () => {
    const next = applyMove(eatWorld('wall'), 'right')!
    expect(next.locations.B.board).toBe('aInside')
    expect(next.locations.A).toEqual({ board: 'root', x: 3, y: 2 })
  })

  it('eat uses the same entry rule as enter: the entry cell of A on the side facing B is a wall, so B cannot be eaten and the move fails', () => {
    // User (2026-09-24): eat is the same as entering a container — B gets in only if the centre
    // cell of A's facing edge is open; a container is just an eat target without walls.
    const world = eatWorld('wall')
    setWall(world.boards.aInside, 2, 1)
    expect(applyMove(world, 'right')).toBeNull()
  })
})

describe('Clone as a reference to its source block (C01–C14 subset)', () => {
  function cloneWorld(): World {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 1) // behind the clone — push fails, forcing enter
    const inside = makeFloorBoard('inside', 3)
    return makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'A', kind: 'container', boardRef: 'inside' },
        { id: 'C', kind: 'container', cloneOf: 'A' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        A: { board: 'root', x: 1, y: 2 },
        C: { board: 'root', x: 1, y: 1 },
      },
    )
  }

  it('C10: entering a clone lands in the source interior at the same cell entering the source would', () => {
    const viaClone = applyMove(cloneWorld(), 'right')!
    // Same scenario entering the SOURCE directly: A blocked by a wall behind it.
    const direct = cloneWorld()
    direct.locations.A = { board: 'root', x: 1, y: 1 }
    direct.locations.C = { board: 'root', x: 1, y: 2 }
    const viaSource = applyMove(direct, 'right')!
    expect(viaClone.locations[PLAYER_ID]).toEqual({ board: 'inside', x: 0, y: 1 })
    expect(viaSource.locations[PLAYER_ID]).toEqual(viaClone.locations[PLAYER_ID])
  })

  it('C02: two clones of the same source both lead into the one shared interior', () => {
    const world = cloneWorld()
    world.pieces.C2 = { id: 'C2', kind: 'container', cloneOf: 'A' }
    world.locations.C2 = { board: 'root', x: 1, y: 0 }
    world.locations[PLAYER_ID] = { board: 'root', x: 0, y: 0 }
    setWall(world.boards.root, 2, 0)
    const next = applyMove(world, 'right')!
    expect(next.locations[PLAYER_ID].board).toBe('inside')
  })

  it('C11: exiting after entering a clone climbs to the SOURCE location, not back to the clone (no reverse portal)', () => {
    const inside = applyMove(cloneWorld(), 'right')!
    // Walk to the left edge of the interior and out.
    const out = applyMove(inside, 'left')!
    expect(out.locations[PLAYER_ID].board).toBe('root')
    expect(out.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 2 }) // left of A (source), not left of C
  })

  it('C09: a clone is pushable like any box when the cell behind it is free (push beats enter)', () => {
    const world = cloneWorld()
    world.boards.root.cells[1][2] = { type: 'floor' }
    const next = applyMove(world, 'right')!
    expect(next.locations.C).toEqual({ board: 'root', x: 2, y: 1 })
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
  })

  it('a clone whose source is a plain piece keeps the legacy redirect-to-location behavior', () => {
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 0)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'src', kind: 'normal' },
        { id: 'C', kind: 'container', cloneOf: 'src' },
      ],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 0 }, C: { board: 'root', x: 2, y: 0 }, src: { board: 'root', x: 0, y: 3 } },
    )
    const next = applyMove(world, 'right')!
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 3 })
  })
})
