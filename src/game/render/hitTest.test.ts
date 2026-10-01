import { describe, it, expect } from 'vitest'
import { containerAt, hitTestChain } from './hitTest'
import { makeFloorBoard, makeWorld } from '../engine/testFixtures'
import { PLAYER_ID, World } from '../engine/types'

// root 4x4 drawn at 100px per cell from the top-left (camera centred on the board, 400px view).
const view = (world: World) => ({
  world,
  camera: { anchor: 'root' as const, centerX: 2, centerY: 2, pixelsPerRootUnit: 100 },
  viewport: { width: 400, height: 400 },
  root: { boardId: 'root', originX: 0, originY: 0, scale: 1 },
})

function nested(fliph = false): World {
  // box A at root (2,1) with a 4x4 room; inside it, at (0,0), a box B with its own room and a
  // plain box at (3,3).
  return makeWorld(
    [makeFloorBoard('root', 4), makeFloorBoard('aIn', 4), makeFloorBoard('bIn', 3)],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'A', kind: 'container', boardRef: 'aIn', fliph },
      { id: 'B', kind: 'container', boardRef: 'bIn' },
      { id: 'small', kind: 'normal' },
    ],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, A: { board: 'root', x: 2, y: 1 }, B: { board: 'aIn', x: 0, y: 0 }, small: { board: 'aIn', x: 3, y: 3 } },
  )
}

describe('hitTestChain / containerAt', () => {
  it('finds the piece under the finger, outermost first, through the box it is drawn in', () => {
    // A covers x 200..300, y 100..200; its room's cells are 25px: B is at 200..225, 100..125.
    expect(hitTestChain(view(nested()), 210, 110).map((h) => h.pieceId)).toEqual(['A', 'B'])
    expect(containerAt(view(nested()), 210, 110)).toBe('B')
  })

  it('tapping a plain box inside a box means the box around it', () => {
    expect(containerAt(view(nested()), 290, 190)).toBe('A') // 'small' at aIn (3,3)
  })

  it('empty floor and plain boxes outside any box are not boxes to look into', () => {
    expect(containerAt(view(nested()), 350, 350)).toBeNull()
    expect(containerAt(view(nested()), 50, 50)).toBeNull() // the player (no interior)
  })

  it('inside a flipped box, the mirrored column is what is under the finger', () => {
    // Mirrored, B (interior column 0) is drawn at the right: 275..300.
    expect(containerAt(view(nested(true)), 210, 110)).toBe('A')
    expect(containerAt(view(nested(true)), 290, 110)).toBe('B')
  })

  it('a box drawn too small to point at is skipped', () => {
    const tiny = { ...view(nested()), camera: { anchor: 'root' as const, centerX: 2, centerY: 2, pixelsPerRootUnit: 40 }, viewport: { width: 160, height: 160 } }
    // A is 40px (big enough); B is 10px (too small) -> A.
    expect(containerAt(tiny, 82, 42)).toBe('A')
  })
})
