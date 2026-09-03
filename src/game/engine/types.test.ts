import { describe, it, expect } from 'vitest'
import { inBounds, opposite, step, occupantAt, findContainerFor, moveTo, PLAYER_ID, World } from './types'
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
