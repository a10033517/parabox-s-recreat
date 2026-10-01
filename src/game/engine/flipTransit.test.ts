import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { applyMove, checkWin, tryMovePiece } from './rules'
import { parseOfficialLevel } from './officialFormat'
import { makeFloorBoard, makeWorld, setWall } from './testFixtures'
import { Direction, PLAYER_ID } from './types'

// Third-party example levels (docs/differential/community-samples, no licence) are kept out of
// the public repository; tests that need one skip when it is not present locally.
const SAMPLE_DIR = join(__dirname, '../../../docs/differential/community-samples')
const hasSample = (name: string) => existsSync(join(SAMPLE_DIR, name))


// Passing through a flipped (fliph) box mirrors the piece that passes (user-reported on
// hungry_flip, 2026-09-25): an asymmetric box comes out mirrored.

describe('passing through a flipped box flips the piece', () => {
  function world() {
    // root 4x4: the player at (0,1), a fliph container F at (1,1) with a 3x3 interior, a box B at (3,1).
    return makeWorld(
      [makeFloorBoard('root', 4), makeFloorBoard('fIn', 3)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'F', kind: 'container', boardRef: 'fIn', fliph: true }, { id: 'B', kind: 'normal' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, F: { board: 'root', x: 1, y: 1 }, B: { board: 'root', x: 3, y: 1 } },
    )
  }

  it('entering it: the piece arrives mirrored, at the mirrored entry side', () => {
    const w = world()
    setWall(w.boards.root, 2, 1) // F cannot be pushed, so the player enters it
    const next = applyMove(w, 'right')!
    // Moving right into a mirrored interior = moving left inside it: enters from its right edge.
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'fIn', x: 2, y: 1 })
    expect(next.pieces[PLAYER_ID].fliph).toBe(true)
  })

  it('leaving it: mirrored again, back to normal', () => {
    const w = world()
    w.locations[PLAYER_ID] = { board: 'fIn', x: 0, y: 1 }
    w.pieces[PLAYER_ID] = { ...w.pieces[PLAYER_ID], fliph: true }
    // Moving left inside the mirrored interior = moving right outside: out of F's right side.
    const next = applyMove(w, 'left')!
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 2, y: 1 })
    expect(next.pieces[PLAYER_ID].fliph).toBeUndefined()
  })

  it('leaving it, the piece keeps moving in the mirrored direction and pushes what it meets that way', () => {
    const w = world()
    w.locations[PLAYER_ID] = { board: 'fIn', x: 0, y: 1 }
    w.locations.B = { board: 'root', x: 2, y: 1 }
    const next = applyMove(w, 'left')!
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 2, y: 1 })
    expect(next.locations.B).toEqual({ board: 'root', x: 3, y: 1 }) // pushed right, not left
  })

  it('a vertical exit comes out at the mirrored column', () => {
    const w = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('fIn', 3), makeFloorBoard('gIn', 3)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'F', kind: 'container', boardRef: 'fIn', fliph: true },
        { id: 'G', kind: 'container', boardRef: 'gIn' },
      ],
      { [PLAYER_ID]: { board: 'fIn', x: 0, y: 0 }, F: { board: 'root', x: 1, y: 1 }, G: { board: 'root', x: 1, y: 0 } },
    )
    // G sits above F against the top edge: the player enters G from below.
    const next = tryMovePiece(w, PLAYER_ID, 'up', new Map(), new Set())!
    // Interior column 0 of a mirrored F is its right-hand column seen from outside, so the
    // player enters G at G's right-hand column.
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'gIn', x: 2, y: 2 })
  })
})

describe.skipIf(!hasSample('hungry_flip.txt'))('hungry_flip.txt', () => {
  it('is solvable: the player box flips going through the flipped self-loop, then eats from the other side', () => {
    const text = readFileSync(join(__dirname, '../../../docs/differential/community-samples/hungry_flip.txt'), 'utf8')
    let w = parseOfficialLevel(text)
    const path = 'down,down,right,right,left,up,left,left,left,left,right,down,down,down,right,right,right,left,up,left,left,left,left,up,down,right,down,right,right,right,right,right,left,left,left,up,up,up,right,up,left,right,right,right,right'.split(',') as Direction[]
    path.forEach((dir, i) => {
      const next = applyMove(w, dir)
      expect(next, `move ${i + 1} (${dir})`).not.toBeNull()
      w = next!
      if (i === 3) expect(w.pieces[PLAYER_ID].fliph).toBe(true)
    })
    expect(checkWin(w)).toBe(true)
  })
})
