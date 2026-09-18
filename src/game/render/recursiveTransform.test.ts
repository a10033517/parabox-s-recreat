import { describe, it, expect } from 'vitest'
import { childTransform, resolveAnchorBoardId, resolveCanonicalBoardTransform } from './recursiveTransform'
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
      boardId: 'redInterior', originX: 1, originY: 0, scale: 0.5,
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
