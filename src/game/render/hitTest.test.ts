import { describe, it, expect } from 'vitest'
import { hitTestChain } from './hitTest'
import { peekTargetAt } from './peek'
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

const ROOT = { originX: 0, originY: 0, scale: 4 } // the root room, in camera units
const peekAt = (w: World, sx: number, sy: number, view = ROOT) => {
  const v = view as { originX: number; originY: number; scale: number }
  return peekTargetAt(w, view0.camera, view0.viewport, hitTestChain({ ...view0, world: w }, sx, sy), v, sx, sy)
}
const view0 = view(nested())

describe('hitTestChain', () => {
  it('finds the piece under the finger, outermost first, with where each is drawn', () => {
    // A covers x 200..300, y 100..200; its room's cells are 25px: B is at 200..225, 100..125.
    const chain = hitTestChain(view(nested()), 210, 110)
    expect(chain.map((h) => h.pieceId)).toEqual(['A', 'B'])
    expect(chain[0].rect).toEqual({ originX: 2, originY: 1, scale: 1 })
    expect(chain[1].rect).toEqual({ originX: 2, originY: 1, scale: 0.25 })
  })

  it('inside a flipped box, the mirrored column is what is under the finger', () => {
    // Mirrored, B (interior column 0) is drawn at the right: 275..300.
    expect(hitTestChain(view(nested(true)), 210, 110).map((h) => h.pieceId)).toEqual(['A'])
    expect(hitTestChain(view(nested(true)), 290, 110).map((h) => h.pieceId)).toEqual(['A', 'B'])
  })

  it('a box drawn too small to point at ends the search', () => {
    const tiny = { ...view(nested()), camera: { anchor: 'root' as const, centerX: 2, centerY: 2, pixelsPerRootUnit: 40 }, viewport: { width: 160, height: 160 } }
    expect(hitTestChain(tiny, 82, 42).map((h) => h.pieceId)).toEqual(['A']) // B is 10px
  })
})

describe('peekTargetAt', () => {
  it('tapping a box in the room peeks into that box — the outermost one, one level at a time', () => {
    expect(peekAt(nested(), 210, 110)).toEqual({ pieceId: 'A', rect: { originX: 2, originY: 1, scale: 1 } })
  })

  it('while peeking into A, a box inside it goes one level deeper', () => {
    const inA = { originX: 2, originY: 1, scale: 1 }
    expect(peekAt(nested(), 210, 110, inA)).toEqual({ pieceId: 'B', rect: { originX: 2, originY: 1, scale: 0.25 } })
  })

  it('outside the box being peeked into means "come back out"', () => {
    expect(peekAt(nested(), 50, 350, { originX: 2, originY: 1, scale: 1 })).toBe('outside')
  })

  it('empty floor and boxes without a room are nothing to peek into', () => {
    expect(peekAt(nested(), 350, 350)).toBeNull()
    expect(peekAt(nested(), 50, 50)).toBeNull() // the player
    expect(peekAt(nested(), 290, 190, { originX: 2, originY: 1, scale: 1 })).toBeNull() // 'small' inside A
  })
})
