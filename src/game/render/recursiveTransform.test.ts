import { describe, it, expect } from 'vitest'
import { childTransform, resolveAnchorBoardId, resolveCanonicalBoardTransform, resolveDrawRoot } from './recursiveTransform'
import { makeFloorBoard, makeWorld } from '../engine/testFixtures'
import { PLAYER_ID, VOID_BOARD_ID } from '../engine/types'

describe('childTransform', () => {
  it('places a child board inside one cell of its parent, scaled by 1/childSize', () => {
    const identity = { boardId: 'root', originX: 0, originY: 0, scale: 1 }
    const interior = makeFloorBoard('interior', 2)
    const t = childTransform(identity, { board: 'root', x: 2, y: 1 }, interior)
    expect(t).toEqual({ boardId: 'interior', originX: 2, originY: 1, scale: 0.5 })
  })

  it('composes across two levels of nesting', () => {
    const rootT = { boardId: 'root', originX: 0, originY: 0, scale: 1 }
    const inside = makeFloorBoard('inside', 4)
    const insideT = childTransform(rootT, { board: 'root', x: 1, y: 1 }, inside)
    // insideT = { originX: 1, originY: 1, scale: 0.25 }
    const deepest = makeFloorBoard('deepest', 2)
    const deepestT = childTransform(insideT, { board: 'inside', x: 2, y: 3 }, deepest)
    // deepest's own (0,0) sits at insideT.origin + (2,3)*insideT.scale
    expect(deepestT).toEqual({
      boardId: 'deepest',
      originX: 1 + 2 * 0.25,
      originY: 1 + 3 * 0.25,
      scale: 0.25 / 2,
    })
  })

  it('throws for an invalid (zero) board size', () => {
    const identity = { boardId: 'root', originX: 0, originY: 0, scale: 1 }
    const bad = { id: 'bad', size: 0, cells: [] }
    expect(() => childTransform(identity, { board: 'root', x: 0, y: 0 }, bad)).toThrow(/invalid board size/i)
  })
})

describe('resolveAnchorBoardId', () => {
  it('returns the sole zero-owner board for a normal tree level', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(resolveAnchorBoardId(world, 'root')).toBe('root')
  })

  it('returns the player\'s own board for a pure-cycle level with no zero-owner board, regardless of its name', () => {
    // Two-node cycle through 'start': redPiece owns redInterior, yellowPiece (inside
    // redInterior) owns 'start' — reproduces the general-cycles spec's own worked
    // example, renamed to prove this isn't a hardcoded 'root' check.
    const start = makeFloorBoard('start', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [start, redInterior],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'start' },
      ],
      {
        [PLAYER_ID]: { board: 'start', x: 0, y: 0 },
        redPiece: { board: 'start', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )
    expect(resolveAnchorBoardId(world, 'root')).toBe('start')
  })

  it('returns VOID_BOARD_ID for the void anchor when the Void board exists', () => {
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 5)
    const world = makeWorld([voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: VOID_BOARD_ID, x: 2, y: 2 } })
    expect(resolveAnchorBoardId(world, 'void')).toBe(VOID_BOARD_ID)
  })

  it('returns null for the void anchor when the Void board has never been synthesized', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(resolveAnchorBoardId(world, 'void')).toBeNull()
  })

  it('C1 regression: a pure-cycle level still anchors on the player\'s real board once the Void board exists, even though nothing owns it', () => {
    // Mirrors the shipped 08-two-node-cycle's shape: every real board is owned by some
    // container (a pure cycle, no zero-owner board at all) — 'yellowPiece' owns 'start',
    // 'redPiece' owns 'redInterior'. Then, simulating "a piece already fell into the Void
    // earlier in the playthrough" (ensureInfiniteDestination), VOID_BOARD_ID is present in
    // world.boards but nothing has a boardRef pointing at it. Before the fix, 'void' was
    // the only zero-owner board and hijacked the anchor even though the player is on
    // 'start'.
    const start = makeFloorBoard('start', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 5)
    const world = makeWorld(
      [start, redInterior, voidBoard],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'start' },
        { id: 'void-infinite:someOtherPiece', kind: 'normal', infiniteFor: 'someOtherPiece' },
      ],
      {
        [PLAYER_ID]: { board: 'start', x: 0, y: 0 },
        redPiece: { board: 'start', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
        'void-infinite:someOtherPiece': { board: VOID_BOARD_ID, x: 2, y: 2 },
      },
    )
    expect(resolveAnchorBoardId(world, 'root')).toBe('start')
  })
})

describe('resolveCanonicalBoardTransform', () => {
  it('matches childTransform for a real two-level World', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'container', boardRef: 'inside' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 1 } },
    )
    expect(resolveCanonicalBoardTransform(world, 'inside', 'root')).toEqual({
      boardId: 'inside', originX: 2, originY: 1, scale: 0.5,
    })
  })

  it('resolves the anchor board itself to the identity transform', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(resolveCanonicalBoardTransform(world, 'root', 'root')).toEqual({ boardId: 'root', originX: 0, originY: 0, scale: 1 })
  })

  it('resolves a real position for a board on a pure cycle, not just the anchor itself', () => {
    const start = makeFloorBoard('start', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [start, redInterior],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'start' },
      ],
      {
        [PLAYER_ID]: { board: 'start', x: 0, y: 0 },
        redPiece: { board: 'start', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )
    // anchor is 'start' (per the resolveAnchorBoardId test above). redInterior is owned
    // by redPiece, which sits on 'start' at (1,0) — one level in.
    expect(resolveCanonicalBoardTransform(world, 'redInterior', 'root')).toEqual({
      boardId: 'redInterior', originX: 1, originY: 0, scale: 1, // redInterior is size 1, scale = 1/1
    })
  })

  it('terminates instead of hanging when walking up from a self-loop board that is not the anchor', () => {
    // loopBoard is a 1x1 self-loop (C owns loopBoard and sits on it), completely
    // disconnected from 'root' — proves the upward walk's visited-set guard fires
    // rather than looping forever, regardless of board.size.
    const root = makeFloorBoard('root', 3)
    const loopBoard = makeFloorBoard('loopBoard', 1)
    const world = makeWorld(
      [root, loopBoard],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'C', kind: 'container', boardRef: 'loopBoard' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        C: { board: 'loopBoard', x: 0, y: 0 }, // self-referencing
      },
    )
    expect(resolveCanonicalBoardTransform(world, 'loopBoard', 'root')).toBeNull()
  })

  it('returns null for a board on a cycle fully disconnected from the requested anchor', () => {
    const root = makeFloorBoard('root', 2)
    const a = makeFloorBoard('a', 2)
    const b = makeFloorBoard('b', 2)
    const world = makeWorld(
      [root, a, b],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'ca', kind: 'container', boardRef: 'a' },
        { id: 'cb', kind: 'container', boardRef: 'b' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        ca: { board: 'b', x: 0, y: 0 }, // ca sits inside b
        cb: { board: 'a', x: 0, y: 0 }, // cb sits inside a — a<->b mutual cycle, no link to root
      },
    )
    expect(resolveCanonicalBoardTransform(world, 'a', 'root')).toBeNull()
  })

  it('returns null when boardId does not exist in the world', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(resolveCanonicalBoardTransform(world, 'nonexistent', 'root')).toBeNull()
  })

  it('I3 regression: a cachedRootAnchorBoardId keeps a pure-cycle level\'s pre-move and post-move transforms in the same coordinate space', () => {
    // Same pure-cycle shape as the 'start'/'redInterior' fixture above: yellowPiece owns
    // 'start', redPiece owns 'redInterior' — no zero-owner board, so resolveAnchorBoardId's
    // fallback is the player's OWN current board. Pre-move, the player is on 'start'
    // (anchor resolves to 'start'); post-move (having entered redPiece's container), the
    // player is on 'redInterior' (anchor would naively resolve to 'redInterior' instead) —
    // reproducing the exact hazard final-review I3 describes: two World snapshots for one
    // animated move silently anchoring on two DIFFERENT real boards while both are tagged
    // anchor: 'root'.
    const start = makeFloorBoard('start', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const makePieces = () => [
      { id: PLAYER_ID, kind: 'player' as const },
      { id: 'redPiece', kind: 'container' as const, boardRef: 'redInterior' },
      { id: 'yellowPiece', kind: 'container' as const, boardRef: 'start' },
    ]
    const preWorld = makeWorld(
      [start, redInterior],
      makePieces(),
      {
        [PLAYER_ID]: { board: 'start', x: 0, y: 0 },
        redPiece: { board: 'start', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )
    const postWorld = makeWorld(
      [start, redInterior],
      makePieces(),
      {
        [PLAYER_ID]: { board: 'redInterior', x: 0, y: 0 }, // player has entered redPiece
        redPiece: { board: 'start', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )

    // Confirms the fixture actually reproduces the hazard: uncached resolution diverges.
    expect(resolveAnchorBoardId(preWorld, 'root')).toBe('start')
    expect(resolveAnchorBoardId(postWorld, 'root')).toBe('redInterior')

    // The fix: resolve the anchor ONCE (as GameScreen does, from the level's initial
    // World at mount) and thread it into every subsequent call, regardless of which
    // World snapshot is passed in.
    const cachedRootAnchorBoardId = resolveAnchorBoardId(preWorld, 'root')! // 'start'
    const preTransform = resolveCanonicalBoardTransform(preWorld, 'start', 'root', cachedRootAnchorBoardId)
    const postTransform = resolveCanonicalBoardTransform(postWorld, 'start', 'root', cachedRootAnchorBoardId)
    // Both resolve 'start' itself (the cached anchor) to the identity transform — same
    // coordinate space, regardless of which World snapshot was passed in.
    expect(preTransform).toEqual({ boardId: 'start', originX: 0, originY: 0, scale: 1 })
    expect(postTransform).toEqual({ boardId: 'start', originX: 0, originY: 0, scale: 1 })

    // And 'redInterior' resolves to the SAME position (one cell into 'start', where
    // redPiece sits) whichever World snapshot supplies it — proving the two snapshots
    // now compose in one shared coordinate space instead of two independent ones.
    const preRedInterior = resolveCanonicalBoardTransform(preWorld, 'redInterior', 'root', cachedRootAnchorBoardId)
    const postRedInterior = resolveCanonicalBoardTransform(postWorld, 'redInterior', 'root', cachedRootAnchorBoardId)
    expect(preRedInterior).toEqual(postRedInterior)
    expect(preRedInterior).toEqual({ boardId: 'redInterior', originX: 1, originY: 0, scale: 1 })
  })

  it('a clone pointing at a board does not affect that board\'s own canonical transform', () => {
    // mainBody canonically owns mainInside; a separate clone (cloneOf: mainBody, no
    // boardRef of its own) also exists elsewhere. Resolving mainInside's canonical
    // transform must walk mainBody's real ownership only — the clone must never be
    // consulted, confirming findContainerFor (which resolveCanonicalBoardTransform's
    // walk uses) has no cloneOf-awareness at all to accidentally trip over.
    const root = makeFloorBoard('root', 3)
    const mainInside = makeFloorBoard('mainInside', 2)
    const world = makeWorld(
      [root, mainInside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'mainBody', kind: 'container', boardRef: 'mainInside' },
        { id: 'clone', kind: 'container', cloneOf: 'mainBody' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        mainBody: { board: 'root', x: 1, y: 1 },
        clone: { board: 'root', x: 2, y: 2 },
      },
    )
    expect(resolveCanonicalBoardTransform(world, 'mainInside', 'root')).toEqual({
      boardId: 'mainInside', originX: 1, originY: 1, scale: 0.5, // mainInside is size 2
    })
  })
})

describe('resolveDrawRoot', () => {
  it('a tree root (no owner) is drawn from itself', () => {
    const world = makeWorld([makeFloorBoard('root', 3)], [], {})
    expect(resolveDrawRoot(world, 'root')).toEqual({ boardId: 'root', originX: 0, originY: 0, scale: 1 })
  })

  it('a self-loop root is drawn from its own box one (and two) levels out, so the box cell covers the board exactly', () => {
    const world = makeWorld(
      [makeFloorBoard('b0', 5)],
      [{ id: 'loop', kind: 'container', boardRef: 'b0' }],
      { loop: { board: 'b0', x: 1, y: 3 } },
    )
    const one = resolveDrawRoot(world, 'b0', 1)
    expect(one).toEqual({ boardId: 'b0', originX: -5, originY: -15, scale: 5 })
    // The loop cell in that outer copy spans exactly [0, 5) x [0, 5): the anchor board itself.
    expect(one.originX + 1 * one.scale).toBe(0)
    expect(one.originY + 3 * one.scale).toBe(0)
    const two = resolveDrawRoot(world, 'b0', 2)
    expect(two.scale).toBe(25)
    expect(two.originX + 1 * two.scale).toBe(one.originX)
  })

  it('does not climb through a fliph owner', () => {
    const world = makeWorld(
      [makeFloorBoard('b0', 5)],
      [{ id: 'loop', kind: 'container', boardRef: 'b0', fliph: true }],
      { loop: { board: 'b0', x: 1, y: 3 } },
    )
    expect(resolveDrawRoot(world, 'b0').scale).toBe(1)
  })
})

describe('resolveDrawRoot while the owner is moving', () => {
  it('uses the in-between position of the owner, so the outer ring glides with it', () => {
    const world = makeWorld(
      [makeFloorBoard('b0', 5)],
      [{ id: 'loop', kind: 'container', boardRef: 'b0' }],
      { loop: { board: 'b0', x: 1, y: 3 } },
    )
    const halfway = resolveDrawRoot(world, 'b0', 1, (id) => (id === 'loop' ? { board: 'b0', x: 1.5, y: 3 } : undefined))
    expect(halfway.originX).toBeCloseTo(-7.5) // between -5 (x=1) and -10 (x=2)
    expect(halfway.originY).toBeCloseTo(-15)
  })
})
