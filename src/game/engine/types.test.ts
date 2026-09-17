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
    const next = sendToVoid(world, 'box1')
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

  it('places the first piece sent to the Void at the center cell, and it counts as in the Void', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    const next = sendToVoid(world, 'box1')
    expect(next?.locations.box1).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 })
    expect(next?.pieces.box1).toEqual({ id: 'box1', kind: 'normal' })
    expect(next && isInVoid(next, 'box1')).toBe(true)
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

  it('reuses the existing Void board and places a second piece at the next free cell, without disturbing the first', () => {
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
    const afterFirst = sendToVoid(world, 'box1')!
    const afterSecond = sendToVoid(afterFirst, 'box2')!
    expect(afterSecond.locations.box1).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 }) // unchanged
    expect(afterSecond.locations.box2).toEqual({ board: VOID_BOARD_ID, x: 1, y: 1 }) // next in VOID_CELL_ORDER
    expect(afterSecond.pieces.box2).toEqual({ id: 'box2', kind: 'normal' })
    expect(afterSecond.boards[VOID_BOARD_ID]).toEqual(afterFirst.boards[VOID_BOARD_ID]) // same board, not recreated
  })

  it('rejects an unknown pieceId with null, mutating nothing', () => {
    const world: World = makeWorld([makeFloorBoard('root', 2)], [], {})
    expect(sendToVoid(world, 'nope')).toBeNull()
  })

  it('rejects a piece already in the Void with null and does not move it', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), { id: VOID_BOARD_ID, size: 5, cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'floor' as const }))) }],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: VOID_BOARD_ID, x: 2, y: 2 } },
    )
    expect(sendToVoid(world, 'box1')).toBeNull()
    expect(world.locations.box1).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 }) // unchanged
  })

  it('returns null and leaves the original world untouched when all 25 cells are already occupied', () => {
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
    const result = sendToVoid(world, 'box1')
    expect(result).toBeNull()
    expect(world.locations.box1).toEqual({ board: 'root', x: 0, y: 0 }) // untouched
    expect(world.pieces.box1).toEqual({ id: 'box1', kind: 'normal' }) // not marked locked
  })
})
