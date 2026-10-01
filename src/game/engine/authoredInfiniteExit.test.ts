import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { applyMove, infiniteExitDegreeOf, resolveInfiniteExit } from './rules'
import { GameState } from './GameState'
import { makeFloorBoard, makeWorld } from './testFixtures'
import { PLAYER_ID, VOID_BOARD_ID, VOID_CENTER, World, findAuthoredInfiniteExitCandidates } from './types'
import { parseOfficialLevel } from './officialFormat'
import { canonicalKey } from '../../../tools/generator/canonical'

// Third-party example levels (docs/differential/community-samples, no licence) are kept out of
// the public repository; tests that need one skip when it is not present locally.
const SAMPLE_DIR = join(__dirname, '../../../docs/differential/community-samples')
const hasSample = (name: string) => existsSync(join(SAMPLE_DIR, name))


// Infinite Exit degree is decided by WHAT is escaping (user correction, 2026-09-23): an ordinary
// piece always comes out of the degree-0 ∞ box; an ∞ box of degree d comes out of the degree d+1
// box (∞∞, ∞∞∞, ...). The level-authored box of EXACTLY that degree catches it; only when the
// level has none does a box of that degree appear in the Void center. (An earlier "the same
// piece advances one degree per escape" rule was never verified and is retracted.)

function familyWorld(): World {
  // A: self-loop, the canonical owner of 'root' (exitBlock). B, C: also self-loop Refs to root,
  // flagged infExit at degree 0 and 1 respectively — the level-authored ∞ / ∞∞ boxes.
  const root = makeFloorBoard('root', 6)
  return makeWorld(
    [root],
    [
      { id: 'A', kind: 'container', boardRef: 'root', exitBlock: true },
      { id: 'B', kind: 'container', boardRef: 'root', infExit: true, infExitNum: 0 },
      { id: 'C', kind: 'container', boardRef: 'root', infExit: true, infExitNum: 1 },
    ],
    { A: { board: 'root', x: 0, y: 2 }, B: { board: 'root', x: 3, y: 3 }, C: { board: 'root', x: 3, y: 1 } },
  )
}

describe('an infExit-flagged ∞ box can never be entered, wherever it stands', () => {
  it('walking into it pushes it when there is room (never enters)', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'infBox', kind: 'container', boardRef: 'root', infExit: true },
      ],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, infBox: { board: 'root', x: 1, y: 1 } },
    )
    const pushed = applyMove(world, 'right')!
    expect(pushed.locations.infBox).toEqual({ board: 'root', x: 2, y: 1 })
    expect(pushed.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
  })

  it('with no room to push it, entering it is not tried as a fallback — the move fails entirely', () => {
    const root = makeFloorBoard('root', 3)
    root.cells[1][2] = { type: 'wall' } // directly behind infBox: push fails
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'infBox', kind: 'container', boardRef: 'root', infExit: true },
      ],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, infBox: { board: 'root', x: 1, y: 1 } },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })
})

describe('findAuthoredInfiniteExitCandidates', () => {
  it('lists same-family infExit Refs ascending by degree, excluding the owner itself', () => {
    expect(findAuthoredInfiniteExitCandidates(familyWorld(), 'A')).toEqual(['B', 'C'])
  })

  it('is empty when the owner has no target, or no infExit sibling shares its target', () => {
    const world = familyWorld()
    world.pieces.C.infExit = false
    expect(findAuthoredInfiniteExitCandidates(world, 'A')).toEqual(['B'])
    expect(findAuthoredInfiniteExitCandidates(world, 'nonexistent')).toEqual([])
  })
})

describe('resolveInfiniteExit: degree comes from the escaping piece, destination must match exactly', () => {
  it('an ordinary self-loop A comes out beside the degree-0 box B; no Void', () => {
    const next = resolveInfiniteExit(familyWorld(), 'A', 'A', 'left', new Map())!
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations.A).toEqual({ board: 'root', x: 2, y: 3 }) // one step left of B
  })

  it('the SAME ordinary piece escaping again still comes out of the degree-0 box (never advances by itself)', () => {
    const afterFirst = resolveInfiniteExit(familyWorld(), 'A', 'A', 'left', new Map())!
    afterFirst.locations.A = { board: 'root', x: 0, y: 5 }
    const afterSecond = resolveInfiniteExit(afterFirst, 'A', 'A', 'left', new Map())!
    expect(afterSecond.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(afterSecond.locations.A).toEqual({ board: 'root', x: 2, y: 3 }) // beside B again, not C
  })

  it('the degree-0 ∞ box B escaping comes out of the degree-1 box C (∞ -> ∞∞)', () => {
    const next = resolveInfiniteExit(familyWorld(), 'B', 'A', 'left', new Map())!
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations.B).toEqual({ board: 'root', x: 2, y: 1 }) // one step left of C
  })

  it('the degree-1 box C escaping needs degree 2; the level has none, so an ∞∞∞ box spawns at the Void center', () => {
    const next = resolveInfiniteExit(familyWorld(), 'C', 'A', 'left', new Map())!
    expect(next.pieces['void-infinite:A:2']).toEqual({ id: 'void-infinite:A:2', kind: 'normal', infiniteFor: 'A', infExitNum: 2 })
    expect(next.locations['void-infinite:A:2']).toEqual({ board: VOID_BOARD_ID, x: VOID_CENTER, y: VOID_CENTER })
    expect(next.locations.C).toEqual({ board: VOID_BOARD_ID, x: VOID_CENTER - 1, y: VOID_CENTER })
    expect(next.pieces['void-infinite:A']).toBeUndefined() // no degree-0 Void box invented
  })

  it('a Void ∞ box of a given degree is reused for that degree, never duplicated', () => {
    const once = resolveInfiniteExit(familyWorld(), 'C', 'A', 'left', new Map())!
    once.locations.C = { board: 'root', x: 0, y: 5 }
    const twice = resolveInfiniteExit(once, 'C', 'A', 'up', new Map())!
    expect(Object.values(twice.pieces).filter((p) => p.infiniteFor === 'A')).toHaveLength(1)
  })

  it('a family with no authored box at all falls straight to a degree-0 Void box (existing behavior unchanged)', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [{ id: 'A', kind: 'container', boardRef: 'root' }], { A: { board: 'root', x: 0, y: 1 } })
    const next = resolveInfiniteExit(world, 'A', 'A', 'left', new Map())!
    expect(next.pieces['void-infinite:A']).toEqual({ id: 'void-infinite:A', kind: 'normal', infiniteFor: 'A' })
  })

  it('infiniteExitDegreeOf: ordinary 0, authored ∞ of degree d -> d+1, Void ∞ of degree d -> d+1', () => {
    const w = familyWorld()
    expect(infiniteExitDegreeOf(w, 'A', 'A')).toBe(0)
    expect(infiniteExitDegreeOf(w, 'B', 'A')).toBe(1)
    expect(infiniteExitDegreeOf(w, 'C', 'A')).toBe(2)
    w.pieces.V = { id: 'V', kind: 'normal', infiniteFor: 'A', infExitNum: 2 }
    expect(infiniteExitDegreeOf(w, 'V', 'A')).toBe(3)
  })
})

describe.skipIf(!hasSample('iiexit_intro.txt'))('end-to-end regression: iiexit_intro.txt', () => {
  const DIR = join(__dirname, '../../../docs/differential/community-samples')
  const load = () => parseOfficialLevel(readFileSync(join(DIR, 'iiexit_intro.txt'), 'utf8'))
  // Found by BFS over real applyMove calls from the level's start (not hand-authored).
  const SELF_LOOP_OUT = ['up', 'left', 'left', 'left', 'up', 'up', 'up', 'up'] as const
  const INF_OUT = [
    'up', 'left', 'left', 'left', 'up', 'up', 'up', 'right', 'up',
    'up', 'left', 'down', 'down', 'right', 'up', 'up', 'up', 'up',
  ] as const

  it('pushing the self-loop off the open top edge lands it beside the degree-0 ∞ box; no Void', () => {
    const state = new GameState(load())
    for (const dir of SELF_LOOP_OUT) expect(state.move(dir)).toBe(true)
    expect(state.current.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(state.current.locations.ref0).toEqual({ board: 'b0', x: 7, y: 2 })
  })

  it('undo restores the exact pre-escape world', () => {
    const start = load()
    const before = JSON.stringify(start)
    const state = new GameState(start)
    for (const dir of SELF_LOOP_OUT) state.move(dir)
    for (let i = 0; i < SELF_LOOP_OUT.length; i++) state.undo()
    expect(JSON.stringify(state.current)).toBe(before)
  })

  it('pushing the ∞ box (degree 0) off the edge while the self-loop is flush makes it come out of the ∞∞ box; no Void', () => {
    let w = load()
    for (const dir of INF_OUT) {
      const next = applyMove(w, dir)
      expect(next, `move "${dir}" should be legal`).not.toBeNull()
      w = next!
    }
    expect(w.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(w.locations.ref2).toEqual({ board: 'b0', x: 4, y: 6 }) // directly above ref1 (∞∞) at (4,7)
  })

  it('after that, the ordinary self-loop pushed off the edge AGAIN comes out of the ∞ box, not the Void', () => {
    let w = load()
    for (const dir of INF_OUT) w = applyMove(w, dir)!
    w.locations[PLAYER_ID] = { board: 'b0', x: 1, y: 1 } // stand below the flush self-loop ref0 at (1,0)
    const next = applyMove(w, 'up')!
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations.ref0).toEqual({ board: 'b0', x: 4, y: 5 }) // above ref2 (∞) at (4,6)
  })

  it('replaying the same path twice is deterministic', () => {
    const run = () => {
      let w = load()
      for (const dir of INF_OUT) w = applyMove(w, dir)!
      return canonicalKey(w)
    }
    expect(run()).toBe(run())
  })
})

describe.skipIf(!hasSample('iiexit_intro.txt'))('self-loop and ∞ box pushed off the edge together (user-reported, 2026-09-24)', () => {
  const DIR = join(__dirname, '../../../docs/differential/community-samples')
  const column = (bottom: 'ref0' | 'ref2', top: 'ref0' | 'ref2') => {
    const w = parseOfficialLevel(readFileSync(join(DIR, 'iiexit_intro.txt'), 'utf8'))
    w.locations[PLAYER_ID] = { board: 'b0', x: 5, y: 2 }
    w.locations[bottom] = { board: 'b0', x: 5, y: 1 }
    w.locations[top] = { board: 'b0', x: 5, y: 0 } // flush against the open top edge
    return w
  }
  const noOverlap = (w: World) => {
    const cells = Object.values(w.locations).map((l) => `${l.board}:${l.x}:${l.y}`)
    expect(new Set(cells).size).toBe(cells.length)
  }

  it('self-loop below ∞: the ∞ box exits (climbing out lands back on itself) and comes out of ∞∞; no Void, no overlap', () => {
    const next = applyMove(column('ref0', 'ref2'), 'up')!
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations.ref2).toEqual({ board: 'b0', x: 4, y: 6 }) // above ref1 (∞∞) at (4,7)
    expect(next.locations.ref0).toEqual({ board: 'b0', x: 5, y: 0 })
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'b0', x: 5, y: 1 })
    noOverlap(next)
  })

  it('∞ below self-loop (PROVISIONAL which piece lands): the self-loop goes out through an ∞ that is itself going out -> ∞∞; no Void, no overlap', () => {
    const next = applyMove(column('ref2', 'ref0'), 'up')!
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations.ref0).toEqual({ board: 'b0', x: 4, y: 6 })
    expect(next.locations.ref2).toEqual({ board: 'b0', x: 5, y: 0 })
    noOverlap(next)
  })
})

describe.skipIf(!hasSample('iiexit_intro.txt'))('self-loop and ∞ box both flush against the same edge, not stacked (user-reported, 2026-09-24)', () => {
  const DIR = join(__dirname, '../../../docs/differential/community-samples')
  const load = () => parseOfficialLevel(readFileSync(join(DIR, 'iiexit_intro.txt'), 'utf8'))

  it('self-loop pushed off the top while the ∞ box also sits on the top edge: out of ∞∞, not the Void', () => {
    const w = load()
    w.locations[PLAYER_ID] = { board: 'b0', x: 1, y: 1 }
    w.locations.ref0 = { board: 'b0', x: 1, y: 0 }
    w.locations.ref2 = { board: 'b0', x: 7, y: 0 } // coming out of it would leave the board again
    const next = applyMove(w, 'up')!
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations.ref0).toEqual({ board: 'b0', x: 4, y: 6 }) // above ref1 (∞∞) at (4,7)
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'b0', x: 1, y: 0 })
  })

  it('the ∞ exit cell is the cell the pusher is leaving: the piece lands there, no Void', () => {
    const w = load()
    w.locations[PLAYER_ID] = { board: 'b0', x: 7, y: 1 }
    w.locations.ref0 = { board: 'b0', x: 7, y: 0 }
    w.locations.ref2 = { board: 'b0', x: 7, y: 2 } // out of ref2 going up = (7,1), the player's cell
    const next = applyMove(w, 'up')!
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations.ref0).toEqual({ board: 'b0', x: 7, y: 1 })
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'b0', x: 7, y: 0 })
  })
})

describe.skipIf(!hasSample('iiexit_void3.txt'))('iiexit_void3.txt: ∞∞ box moved one cell up so it can be pushed (user test level, 2026-09-24)', () => {
  const DIR = join(__dirname, '../../../docs/differential/community-samples')
  const load = () => parseOfficialLevel(readFileSync(join(DIR, 'iiexit_void3.txt'), 'utf8'))

  it('∞∞ pushed off the edge while the self-loop is on the same edge: the level has no ∞∞∞, so the Void spawns one', () => {
    const w = load()
    expect(w.locations.ref1).toEqual({ board: 'b0', x: 4, y: 6 })
    w.locations[PLAYER_ID] = { board: 'b0', x: 4, y: 1 }
    w.locations.ref1 = { board: 'b0', x: 4, y: 0 }
    w.locations.ref0 = { board: 'b0', x: 1, y: 0 }
    const next = applyMove(w, 'up')!
    const spawned = 'void-infinite:ref0:2'
    expect(next.pieces[spawned].infExitNum).toBe(2)
    expect(next.locations[spawned]).toEqual({ board: VOID_BOARD_ID, x: VOID_CENTER, y: VOID_CENTER })
    expect(next.locations.ref1).toEqual({ board: VOID_BOARD_ID, x: VOID_CENTER, y: VOID_CENTER - 1 })
  })
})

describe.skipIf(!hasSample('file_format_example.txt'))('walking out beside the self-containing box you are in lands on your own cell (user-reported, 2026-09-26)', () => {
  // file_format_example: inside the green box b1 (3x3) whose exit Ref ref2 sits at its own
  // centre (1,1). From (2,1), walking right leaves b1 through ref2 and lands right of it — (2,1),
  // where the player already stands. A legal move that changes nothing, never the Void.
  const DIR = join(__dirname, '../../../docs/differential/community-samples')
  const inside = () => {
    let w = parseOfficialLevel(readFileSync(join(DIR, 'file_format_example.txt'), 'utf8'))
    for (const dir of ['down', 'down', 'down', 'right', 'down', 'left'] as const) w = applyMove(w, dir)!
    expect(w.locations[PLAYER_ID]).toEqual({ board: 'b1', x: 2, y: 1 })
    expect(w.locations.ref2).toEqual({ board: 'b1', x: 1, y: 1 })
    return w
  }

  it('walking right from beside the centre box: same place, no Void', () => {
    const w = inside()
    const next = applyMove(w, 'right')!
    expect(next).not.toBeNull()
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations).toEqual(w.locations)
  })

  it('walking around the edges and out, never pushing the centre box, never reaches the Void', () => {
    let w = inside()
    for (const dir of ['up', 'up', 'up', 'left', 'left', 'down', 'down', 'right', 'right', 'right'] as const) { // never pushes the centre box
      const next = applyMove(w, dir)
      expect(next, dir).not.toBeNull()
      w = next!
      expect(w.locations.ref2).toEqual({ board: 'b1', x: 1, y: 1 })
      expect(w.boards[VOID_BOARD_ID]).toBeUndefined()
    }
  })
})
