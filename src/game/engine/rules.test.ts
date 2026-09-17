import { describe, it, expect } from 'vitest'
import { computeTarget, getEntryCell, applyMove, tryEnter, tryMovePiece, resolveBlocked, checkWin, checkLose } from './rules'
import { HALF, makeFraction, ZERO, ONE } from './fraction'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from './testFixtures'
import { PLAYER_ID, removePiece } from './types'

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
    expect(result).toEqual({ kind: 'infinite' })
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

describe('computeTarget — two-owner board (external owner + self-referencing owner)', () => {
  // 'elsewhere' is owned both by extBox (an external container sitting in
  // root) and by loopBox (a self-referencing container standing inside
  // 'elsewhere' itself, flush against its top-left corner). Exiting
  // 'elsewhere' upward should always climb out through extBox into root —
  // never resolve to infinite via loopBox's self-reference — regardless of
  // which piece appears first in the pieces map.
  function buildWorld(order: 'loopFirst' | 'extFirst') {
    const root = makeFloorBoard('root', 3)
    const elsewhere = makeFloorBoard('elsewhere', 3)
    const extBox: { id: string; kind: 'container'; boardRef: string } =
      { id: 'extBox', kind: 'container', boardRef: 'elsewhere' }
    const loopBox: { id: string; kind: 'container'; boardRef: string } =
      { id: 'loopBox', kind: 'container', boardRef: 'elsewhere' }
    const pieces = order === 'loopFirst' ? [loopBox, extBox] : [extBox, loopBox]
    return makeWorld(
      [root, elsewhere],
      pieces,
      {
        extBox: { board: 'root', x: 1, y: 1 }, // center of root — an in-bounds wrap target
        loopBox: { board: 'elsewhere', x: 0, y: 0 }, // flush top-left corner of its own board
      },
    )
  }

  it('resolves normally through the external owner when the self-referencing piece is declared first', () => {
    const world = buildWorld('loopFirst')
    const result = computeTarget(world, { board: 'elsewhere', x: 1, y: 0 }, 'up', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 1, y: 0 }, relativeCoord: HALF })
  })

  it('resolves normally through the external owner when the self-referencing piece is declared second', () => {
    const world = buildWorld('extFirst')
    const result = computeTarget(world, { board: 'elsewhere', x: 1, y: 0 }, 'up', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 1, y: 0 }, relativeCoord: HALF })
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
  it('removes the player directly when its own move resolves to infinite', () => {
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
    expect(next?.locations[PLAYER_ID]).toBeUndefined()
    expect(next?.pieces[PLAYER_ID]).toBeUndefined()
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

  it('removes a self-loop box pushed flush against the board it owns, letting the pusher complete its move', () => {
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
    expect(next?.locations.loopBox).toBeUndefined()
    expect(next?.pieces.loopBox).toBeUndefined()
  })

  it('resolveBlocked removes the player when pushing it resolves to infinite, treating it the same as any other piece', () => {
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
    expect(result?.locations[PLAYER_ID]).toBeUndefined()
    expect(result?.pieces[PLAYER_ID]).toBeUndefined()
    expect(result?.locations.loopBox).toEqual({ board: 'root', x: 0, y: 1 })
  })
})

describe('tryMovePiece — piece already removed from the world', () => {
  it('applyMove returns null instead of throwing when the player has already been removed', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    const lost = removePiece(world, PLAYER_ID)
    expect(() => applyMove(lost, 'up')).not.toThrow()
    expect(applyMove(lost, 'up')).toBeNull()
    expect(applyMove(lost, 'down')).toBeNull()
    expect(applyMove(lost, 'left')).toBeNull()
    expect(applyMove(lost, 'right')).toBeNull()
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

describe('checkLose', () => {
  it('is true only when the player has no location', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    expect(checkLose(world)).toBe(false)
    const next = removePiece(world, PLAYER_ID)
    expect(checkLose(next)).toBe(true)
  })
})
