import { describe, expect, it } from 'vitest'
import { makeFloorBoard, makeWorld } from '../engine/testFixtures'
import { PLAYER_ID, World } from '../engine/types'
import { peekRects, playerInPeekedRoom } from './peek'

// root 4x4 holds box A (room aIn, 4x4) at (2,1); A's room holds box B (room bIn) at (1,0).
function nested(opts: { fliph?: boolean; player?: { board: string; x: number; y: number } } = {}): World {
  return makeWorld(
    [makeFloorBoard('root', 4), makeFloorBoard('aIn', 4), makeFloorBoard('bIn', 3)],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'A', kind: 'container', boardRef: 'aIn', fliph: opts.fliph },
      { id: 'B', kind: 'container', boardRef: 'bIn' },
    ],
    { [PLAYER_ID]: opts.player ?? { board: 'root', x: 0, y: 0 }, A: { board: 'root', x: 2, y: 1 }, B: { board: 'aIn', x: 1, y: 0 } },
  )
}

describe('peekRects', () => {
  it('places each box of the path where it is drawn: the first on the room, the next inside it', () => {
    expect(peekRects(nested(), 'root', ['A', 'B'])).toEqual([
      { originX: 2, originY: 1, scale: 1 },
      { originX: 2.25, originY: 1, scale: 0.25 },
    ])
  })

  it('inside a flipped box the next box sits at the mirrored column', () => {
    expect(peekRects(nested({ fliph: true }), 'root', ['A', 'B'])?.[1]).toEqual({ originX: 2.5, originY: 1, scale: 0.25 })
  })

  it('follows a box that has moved, and gives up when the path no longer holds', () => {
    const moved = nested()
    moved.locations.A = { board: 'root', x: 3, y: 1 }
    expect(peekRects(moved, 'root', ['A'])).toEqual([{ originX: 3, originY: 1, scale: 1 }])
    const gone = nested()
    gone.locations.B = { board: 'root', x: 0, y: 3 } // B no longer inside A
    expect(peekRects(gone, 'root', ['A', 'B'])).toBeNull()
  })
})

describe('playerInPeekedRoom', () => {
  it('a box that contains the room the player is in: the peek stays when moving', () => {
    const selfLoop = makeWorld(
      [makeFloorBoard('root', 5)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'L', kind: 'container', boardRef: 'root' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, L: { board: 'root', x: 2, y: 2 } },
    )
    expect(playerInPeekedRoom(selfLoop, 'L')).toBe(true)
  })

  it('a box the player is not in: the camera comes back', () => {
    expect(playerInPeekedRoom(nested(), 'A')).toBe(false)
    expect(playerInPeekedRoom(nested({ player: { board: 'aIn', x: 0, y: 3 } }), 'A')).toBe(true)
    expect(playerInPeekedRoom(nested(), undefined)).toBe(false)
  })
})
