import { describe, it, expect } from 'vitest'
import { inBounds, opposite, step, occupantAt, findContainerFor, moveTo, sendToVoid, isInVoid, VOID_BOARD_ID, PLAYER_ID, World } from './types'
import { makeFloorBoard, makeWorld } from './testFixtures'

describe('inBounds', () => {
  it('is true within the board and false outside it', () => {
    const board = makeFloorBoard('root', 3)
    expect(inBounds(board, 0, 0)).toBe(true)
    expect(inBounds(board, 2, 2)).toBe(true)
    expect(inBounds(board, 3, 0)).toBe(false)
    expect(inBounds(board, 0, 3)).toBe(false)
    expect(inBounds(board, -1, 0)).toBe(false)
  })
})

describe('opposite', () => {
  it('reverses each direction', () => {
    expect(opposite('up')).toBe('down')
    expect(opposite('down')).toBe('up')
    expect(opposite('left')).toBe('right')
    expect(opposite('right')).toBe('left')
  })
})

describe('step', () => {
  it('computes the delta for each direction', () => {
    expect(step(1, 1, 'up')).toEqual({ x: 1, y: 0 })
    expect(step(1, 1, 'down')).toEqual({ x: 1, y: 2 })
    expect(step(1, 1, 'left')).toEqual({ x: 0, y: 1 })
    expect(step(1, 1, 'right')).toEqual({ x: 2, y: 1 })
  })
})

describe('occupantAt', () => {
  it('finds the piece at a location, or undefined if empty', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 1 } },
    )
    expect(occupantAt(world, { board: 'root', x: 1, y: 1 })).toBe(PLAYER_ID)
    expect(occupantAt(world, { board: 'root', x: 0, y: 0 })).toBeUndefined()
  })
})

describe('findContainerFor', () => {
  it('finds the container piece whose boardRef matches, or undefined', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('inside', 2)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'box', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        box: { board: 'root', x: 1, y: 1 },
      },
    )
    expect(findContainerFor(world, 'inside')).toBe('box')
    expect(findContainerFor(world, 'root')).toBeUndefined()
  })

  it('finds a self-referencing container as its own board\'s owner', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root' }],
      { loopBox: { board: 'root', x: 0, y: 0 } },
    )
    expect(findContainerFor(world, 'root')).toBe('loopBox')
  })
})

describe('moveTo', () => {
  it('returns a new world with the piece relocated, leaving the original untouched', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    const next = moveTo(world, PLAYER_ID, { board: 'root', x: 1, y: 0 })
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
    expect(world.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 0 })
  })
})

describe('sendToVoid', () => {
  it('synthesizes the Void board on first use: a plain 5x5 floor board, no walls', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    const next = sendToVoid(world, 'box1', 'ownerA')
    expect(next).not.toBeNull()
    const voidBoard = next!.boards[VOID_BOARD_ID]
    expect(voidBoard.id).toBe(VOID_BOARD_ID)
    expect(voidBoard.size).toBe(5)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        expect(voidBoard.cells[y][x].type).toBe('floor')
      }
    }
  })

  it('isInVoid is false for a piece not standing on the Void board', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    expect(isInVoid(world, 'box1')).toBe(false)
    expect(isInVoid(world, 'unknownPiece')).toBe(false)
  })

  it('creates a destination for the owner at the center, and ejects the piece into a genuinely adjacent free cell', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    const next = sendToVoid(world, 'box1', 'ownerA')!
    expect(next.pieces['void-infinite:ownerA']).toEqual({ id: 'void-infinite:ownerA', kind: 'normal', infiniteFor: 'ownerA' })
    expect(next.locations['void-infinite:ownerA']).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 })
    expect(next.locations.box1).toEqual({ board: VOID_BOARD_ID, x: 2, y: 1 }) // directly above the destination
    expect(next.pieces.box1).toEqual({ id: 'box1', kind: 'normal' }) // unchanged — no field added to the piece itself
    expect(isInVoid(next, 'box1')).toBe(true)
    expect(isInVoid(next, 'void-infinite:ownerA')).toBe(true)
  })

  it('reuses the same destination for a second piece through the same owner, landing in the next free adjacent cell', () => {
    const world: World = makeWorld(
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
    const afterFirst = sendToVoid(world, 'box1', 'ownerA')!
    const afterSecond = sendToVoid(afterFirst, 'box2', 'ownerA')!
    expect(afterSecond.locations['void-infinite:ownerA']).toEqual(afterFirst.locations['void-infinite:ownerA']) // unmoved
    expect(afterSecond.locations.box1).toEqual(afterFirst.locations.box1) // undisturbed
    expect(afterSecond.locations.box2).toEqual({ board: VOID_BOARD_ID, x: 3, y: 2 }) // next free neighbor (up is taken by box1)
    expect(Object.keys(afterSecond.pieces).filter((id) => id.startsWith('void-infinite:'))).toEqual(['void-infinite:ownerA']) // only one destination
  })

  it('a different owner gets its own, separate destination', () => {
    const world: World = makeWorld(
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
    const afterFirst = sendToVoid(world, 'box1', 'ownerA')!
    const afterSecond = sendToVoid(afterFirst, 'box2', 'ownerB')!
    expect(afterSecond.locations['void-infinite:ownerA']).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 })
    expect(afterSecond.locations['void-infinite:ownerB']).toEqual({ board: VOID_BOARD_ID, x: 1, y: 1 })
    expect(afterSecond.locations.box2).toEqual({ board: VOID_BOARD_ID, x: 1, y: 0 }) // adjacent to ownerB's own destination
  })

  it('if the real owner piece is already in the Void, it is used directly — no destination is synthesized', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), makeFloorBoard(VOID_BOARD_ID, 5)],
      [
        { id: 'realOwner', kind: 'normal' },
        { id: 'box3', kind: 'normal' },
      ],
      {
        realOwner: { board: VOID_BOARD_ID, x: 4, y: 4 },
        box3: { board: 'root', x: 0, y: 0 },
      },
    )
    const next = sendToVoid(world, 'box3', 'realOwner')!
    expect(next.pieces['void-infinite:realOwner']).toBeUndefined() // no placeholder created
    expect(next.locations.box3).toEqual({ board: VOID_BOARD_ID, x: 4, y: 3 }) // adjacent to the real owner's own location
    expect(next.locations.realOwner).toEqual({ board: VOID_BOARD_ID, x: 4, y: 4 }) // real owner itself never moves
  })

  it('a hand-placed piece with infiniteFor already set is found and reused like a synthesized destination', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), makeFloorBoard(VOID_BOARD_ID, 5)],
      [
        { id: 'authoredDest', kind: 'normal', infiniteFor: 'ownerC' },
        { id: 'box4', kind: 'normal' },
      ],
      {
        authoredDest: { board: VOID_BOARD_ID, x: 0, y: 0 },
        box4: { board: 'root', x: 0, y: 0 },
      },
    )
    const next = sendToVoid(world, 'box4', 'ownerC')!
    expect(next.pieces['void-infinite:ownerC']).toBeUndefined() // no second destination created
    expect(next.locations.box4).toEqual({ board: VOID_BOARD_ID, x: 1, y: 0 }) // adjacent to the authored destination
  })

  it('rejects an unknown pieceId with null, mutating nothing', () => {
    const world: World = makeWorld([makeFloorBoard('root', 2)], [], {})
    expect(sendToVoid(world, 'nope', 'ownerA')).toBeNull()
  })

  it('rejects a piece already in the Void with null and does not move it', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), makeFloorBoard(VOID_BOARD_ID, 5)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: VOID_BOARD_ID, x: 2, y: 2 } },
    )
    expect(sendToVoid(world, 'box1', 'ownerA')).toBeNull()
    expect(world.locations.box1).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 }) // unchanged
  })

  it('returns null and leaves the original world untouched when a destination has no free adjacent cell to eject into', () => {
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 5)
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), voidBoard],
      [
        { id: 'dest', kind: 'normal', infiniteFor: 'ownerX' },
        { id: 'n1', kind: 'normal' }, { id: 'n2', kind: 'normal' },
        { id: 'n3', kind: 'normal' }, { id: 'n4', kind: 'normal' },
        { id: 'box5', kind: 'normal' },
      ],
      {
        dest: { board: VOID_BOARD_ID, x: 2, y: 2 }, // all 4 neighbors occupied below
        n1: { board: VOID_BOARD_ID, x: 2, y: 1 },
        n2: { board: VOID_BOARD_ID, x: 3, y: 2 },
        n3: { board: VOID_BOARD_ID, x: 2, y: 3 },
        n4: { board: VOID_BOARD_ID, x: 1, y: 2 },
        box5: { board: 'root', x: 0, y: 0 },
      },
    )
    const result = sendToVoid(world, 'box5', 'ownerX')
    expect(result).toBeNull()
    expect(world.locations.box5).toEqual({ board: 'root', x: 0, y: 0 }) // untouched
  })

  it('returns null and leaves the original world untouched when the Void is full (no cell for a new destination)', () => {
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
      id: VOID_BOARD_ID,
      size: 5,
      cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'floor' as const }))),
    }
    const fillerPieces = voidCells.map((_, i) => ({ id: `filler${i}`, kind: 'normal' as const }))
    const fillerLocations = Object.fromEntries(
      voidCells.map(({ x, y }, i) => [`filler${i}`, { board: VOID_BOARD_ID, x, y }]),
    )
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), voidBoard],
      [{ id: 'box1', kind: 'normal' }, ...fillerPieces],
      { box1: { board: 'root', x: 0, y: 0 }, ...fillerLocations },
    )
    // 'ownerA' has no existing destination, so this must try to synthesize one — and fail, since the Void is full.
    const result = sendToVoid(world, 'box1', 'ownerA')
    expect(result).toBeNull()
    expect(world.locations.box1).toEqual({ board: 'root', x: 0, y: 0 }) // untouched
    expect(world.pieces.box1).toEqual({ id: 'box1', kind: 'normal' })
  })
})
