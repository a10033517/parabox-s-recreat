import { describe, it, expect } from 'vitest'
import { inBounds, opposite, step, occupantAt, findContainerFor, moveTo, ensureInfiniteDestination, isInVoid, VOID_BOARD_ID, PLAYER_ID, World } from './types'
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

describe('isInVoid', () => {
  it('is false for a piece not standing on the Void board', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    expect(isInVoid(world, 'box1')).toBe(false)
    expect(isInVoid(world, 'unknownPiece')).toBe(false)
  })
})

describe('ensureInfiniteDestination', () => {
  // Where the ejected piece actually lands relative to the destination (a
  // genuinely adjacent cell in the ORIGINAL push direction, chaining a push
  // if that cell is occupied) is resolveInfiniteExit's job in rules.ts —
  // these tests cover only the destination-resolution half.
  it('synthesizes the Void board on first use: a plain 5x5 floor board, no walls', () => {
    const world: World = makeWorld([makeFloorBoard('root', 2)], [], {})
    const result = ensureInfiniteDestination(world, 'ownerA')
    expect(result).not.toBeNull()
    const voidBoard = result!.world.boards[VOID_BOARD_ID]
    expect(voidBoard.id).toBe(VOID_BOARD_ID)
    expect(voidBoard.size).toBe(5)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        expect(voidBoard.cells[y][x].type).toBe('floor')
      }
    }
  })

  it('creates a destination for a new owner at the Void center', () => {
    const world: World = makeWorld([makeFloorBoard('root', 2)], [], {})
    const result = ensureInfiniteDestination(world, 'ownerA')!
    expect(result.location).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 })
    expect(result.world.pieces['void-infinite:ownerA']).toEqual({ id: 'void-infinite:ownerA', kind: 'normal', infiniteFor: 'ownerA' })
    expect(result.world.locations['void-infinite:ownerA']).toEqual(result.location)
    expect(isInVoid(result.world, 'void-infinite:ownerA')).toBe(true)
  })

  it('reuses the existing destination for the same owner, without recreating the Void board or a second destination', () => {
    const world: World = makeWorld([makeFloorBoard('root', 2)], [], {})
    const first = ensureInfiniteDestination(world, 'ownerA')!
    const second = ensureInfiniteDestination(first.world, 'ownerA')!
    expect(second.location).toEqual(first.location)
    expect(second.world.boards[VOID_BOARD_ID]).toEqual(first.world.boards[VOID_BOARD_ID])
    expect(Object.keys(second.world.pieces).filter((id) => id.startsWith('void-infinite:'))).toEqual(['void-infinite:ownerA'])
  })

  it('a different owner gets its own, separate destination at the next free cell', () => {
    const world: World = makeWorld([makeFloorBoard('root', 2)], [], {})
    const first = ensureInfiniteDestination(world, 'ownerA')!
    const second = ensureInfiniteDestination(first.world, 'ownerB')!
    expect(second.world.locations['void-infinite:ownerA']).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 })
    expect(second.location).toEqual({ board: VOID_BOARD_ID, x: 1, y: 1 }) // next free cell in the placement search
  })

  it('if the real owner piece is already in the Void, its own location is returned directly — no destination is synthesized', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), makeFloorBoard(VOID_BOARD_ID, 5)],
      [{ id: 'realOwner', kind: 'normal' }],
      { realOwner: { board: VOID_BOARD_ID, x: 4, y: 4 } },
    )
    const result = ensureInfiniteDestination(world, 'realOwner')!
    expect(result.location).toEqual({ board: VOID_BOARD_ID, x: 4, y: 4 })
    expect(result.world.pieces['void-infinite:realOwner']).toBeUndefined()
  })

  it('a hand-placed piece with infiniteFor already set is found and returned like a synthesized destination', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), makeFloorBoard(VOID_BOARD_ID, 5)],
      [{ id: 'authoredDest', kind: 'normal', infiniteFor: 'ownerC' }],
      { authoredDest: { board: VOID_BOARD_ID, x: 0, y: 0 } },
    )
    const result = ensureInfiniteDestination(world, 'ownerC')!
    expect(result.location).toEqual({ board: VOID_BOARD_ID, x: 0, y: 0 })
    expect(result.world.pieces['void-infinite:ownerC']).toBeUndefined() // no second destination created
  })

  it('returns null and leaves the original world untouched when the Void is full and a new destination is needed', () => {
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
      fillerPieces,
      fillerLocations,
    )
    // 'ownerA' has no existing destination, so this must try to synthesize one — and fail, since the Void is full.
    expect(ensureInfiniteDestination(world, 'ownerA')).toBeNull()
    expect(Object.keys(world.pieces)).toHaveLength(25) // original world untouched, no partial destination added
  })
})
