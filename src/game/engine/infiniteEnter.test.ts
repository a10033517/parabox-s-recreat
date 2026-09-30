import { describe, it, expect } from 'vitest'
import { applyMove } from './rules'
import { GameState } from './GameState'
import { makeFloorBoard, makeWorld, setWall } from './testFixtures'
import { PLAYER_ID, VOID_BOARD_ID, VOID_CENTER, World, ensureEpsilonDestination, epsilonBoardIdFor, isInVoid } from './types'
import { canonicalKey } from '../../../tools/generator/canonical'

// IE-expected-from-public-evidence: these encode the contract in
// patricks_parabox_infinite_enter_epsilon_official_research.md. None is an original-game
// golden trace (IE-golden-original does not exist yet). Anything marked PROVISIONAL is an
// engine choice the public evidence does not pin down.
//
// Fixture: entering A lands on A's interior entry cell (0,1). That cell holds O, a clone of A
// with a wall behind it, so it cannot be pushed; entering O lands on the very same entry cell
// again — a pure inward loop with no finite terminator.

function loopWorld(opts: { wallBehindO: boolean } = { wallBehindO: true }): World {
  const root = makeFloorBoard('root', 3)
  setWall(root, 2, 1) // behind A: forces enter over push
  const a = makeFloorBoard('a', 3)
  if (opts.wallBehindO) setWall(a, 1, 1) // behind O
  return makeWorld(
    [root, a],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'A', kind: 'container', boardRef: 'a' },
      { id: 'O', kind: 'container', cloneOf: 'A' },
    ],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, A: { board: 'root', x: 1, y: 1 }, O: { board: 'a', x: 0, y: 1 } },
  )
}

const epsilons = (w: World) => Object.values(w.pieces).filter((p) => p.epsilonFor !== undefined)

describe('IE01 clone into parent detects infinite entry', () => {
  it('an enter chain that repeats the same structural transition ends in a null-space ε, not a null move', () => {
    const next = applyMove(loopWorld(), 'right')
    expect(next).not.toBeNull()
    expect(epsilons(next!)).toHaveLength(1)
  })

  it('observed in the original (case 6): the ε is created at the Void center and the mover ends up INSIDE it, on the middle of its left edge', () => {
    const next = applyMove(loopWorld(), 'right')!
    const eps = epsilons(next)[0]
    expect(next.locations[eps.id]).toEqual({ board: VOID_BOARD_ID, x: VOID_CENTER, y: VOID_CENTER })
    expect(next.locations[PLAYER_ID]).toEqual({ board: epsilonBoardIdFor('A'), x: 0, y: 2 })
    expect(next.boards[epsilonBoardIdFor('A')].size).toBe(5) // DEFAULT_EPSILON_SIZE (customizable per ensureEpsilonDestination call)
    expect(next.boards[epsilonBoardIdFor('A')].cells.flat().every((c) => c.type === 'floor')).toBe(true)
  })

  it('the ε in the Void is locked like every Void box: a piece standing in the Void cannot enter it, only push it', () => {
    let world = applyMove(loopWorld(), 'right')!
    const eps = epsilons(world)[0]
    // Leave through the right edge: the player is now in the Void, beside the ε.
    for (let i = 0; i < 5; i++) world = applyMove(world, 'right') ?? world
    expect(isInVoid(world, PLAYER_ID)).toBe(true)
    expect(world.locations[PLAYER_ID]).toEqual({ board: VOID_BOARD_ID, x: VOID_CENTER + 1, y: VOID_CENTER })
    // Walking back left is a push of the ε (it moves), never an entry.
    const back = applyMove(world, 'left')!
    expect(back.locations[PLAYER_ID].board).toBe(VOID_BOARD_ID)
    expect(back.locations[eps.id]).toEqual({ board: VOID_BOARD_ID, x: VOID_CENTER - 1, y: VOID_CENTER })
  })
})

describe('IE02 an existing ε is reused, never duplicated', () => {
  it('does not create a second ε or consume another Void cell', () => {
    const start = loopWorld()
    const pre = ensureEpsilonDestination(start, 'A')!.world
    const epsBefore = pre.locations[epsilons(pre)[0].id]
    const next = applyMove(pre, 'right')!
    expect(epsilons(next)).toHaveLength(1)
    expect(next.locations[epsilons(next)[0].id]).toEqual(epsBefore) // the same ε, not moved or re-spawned
    expect(next.locations[PLAYER_ID].board).toBe(epsilonBoardIdFor('A')) // enters the existing ε
  })

  it('ensureEpsilonDestination is idempotent per seed and distinct per seed', () => {
    const w = loopWorld()
    const one = ensureEpsilonDestination(w, 'A')!
    const again = ensureEpsilonDestination(one.world, 'A')!
    expect(again.epsilonId).toBe(one.epsilonId)
    const other = ensureEpsilonDestination(again.world, 'O')!
    expect(other.epsilonId).not.toBe(one.epsilonId)
    expect(other.world.locations[other.epsilonId]).not.toEqual(other.world.locations[one.epsilonId])
  })
})

describe('IE03 first-room attribution is preserved', () => {
  it('the ε is keyed to the FIRST entered piece (A), not the piece that closed the loop (O)', () => {
    const next = applyMove(loopWorld(), 'right')!
    expect(epsilons(next).map((p) => p.epsilonFor)).toEqual(['A'])
    expect(next.pieces['void-epsilon:O']).toBeUndefined()
  })
})

describe('IE04 a finite cycle does not spawn an ε', () => {
  it('when O can simply be pushed aside, entering A is an ordinary finite move', () => {
    const next = applyMove(loopWorld({ wallBehindO: false }), 'right')!
    expect(epsilons(next)).toHaveLength(0)
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations[PLAYER_ID].board).toBe('a')
  })
})

describe('IE05 a self-loop is not automatically an ε', () => {
  it('entering a self-loop box normally creates neither ε nor Void', () => {
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 1)
    const world = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'loop', kind: 'container', boardRef: 'root' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 1 }, loop: { board: 'root', x: 2, y: 1 } },
    )
    const next = applyMove(world, 'right')!
    expect(epsilons(next)).toHaveLength(0)
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
  })
})

describe('IE06 resolution is deterministic', () => {
  it('two identical runs produce identical worlds', () => {
    expect(JSON.stringify(applyMove(loopWorld(), 'right'))).toBe(JSON.stringify(applyMove(loopWorld(), 'right')))
  })
})

describe('IE07 the Void is a 7x7 space; pieces leaving the ε become locked Void boxes', () => {
  it('a piece pushed on through the ε leaves it into the Void and is locked there; the 7x7 edge is an unpushable, undrawn wall', () => {
    let world = applyMove(loopWorld(), 'right')!
    expect(world.boards[VOID_BOARD_ID].size).toBe(7)
    expect(isInVoid(world, PLAYER_ID)).toBe(false) // inside the ε: not yet a Void resident
    for (let i = 0; i < 5; i++) world = applyMove(world, 'right') ?? world
    expect(isInVoid(world, PLAYER_ID)).toBe(true) // out of the ε: locked
    for (let i = 0; i < 10; i++) world = applyMove(world, 'right') ?? world
    expect(world.locations[PLAYER_ID].x).toBeLessThanOrEqual(6)
    expect(applyMove(world, 'right')).toBeNull()
  })

  it('an ε that lives in the play area is an enterable, walless ghost cube: leaving climbs out beside it', () => {
    const root = makeFloorBoard('root', 5)
    setWall(root, 3, 2)
    const eps = makeFloorBoard('eps', 3)
    const world = makeWorld(
      [root, eps],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'eps', kind: 'container', boardRef: 'eps', epsilonFor: 'seed' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 2 }, eps: { board: 'root', x: 2, y: 2 } },
    )
    const inside = applyMove(world, 'right')!
    expect(inside.locations[PLAYER_ID]).toEqual({ board: 'eps', x: 0, y: 1 })
    expect(applyMove(inside, 'left')!.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 2 })
  })
})

describe('IE08 undo and canonical state', () => {
  it('undo restores the exact pre-ε World, and a second ε is really recreated (no singleton)', () => {
    const start = loopWorld()
    const before = JSON.stringify(start)
    const state = new GameState(start)
    expect(state.move('right')).toBe(true)
    expect(epsilons(state.current)).toHaveLength(1)
    expect(state.undo()).toBe(true)
    expect(JSON.stringify(state.current)).toBe(before)
    expect(epsilons(state.current)).toHaveLength(0)
    expect(state.move('right')).toBe(true)
    expect(epsilons(state.current)).toHaveLength(1)
  })

  it('canonicalKey distinguishes the world before and after the ε exists', () => {
    const start = loopWorld()
    expect(canonicalKey(start)).not.toBe(canonicalKey(applyMove(start, 'right')!))
  })
})

describe('ε is an ordinary enterable box (and ∞ is not)', () => {
  // An ε placed in the play area, walled behind so it must be entered rather than pushed.
  const inLevel = (approach: 'right' | 'left' | 'down' | 'up') => {
    const root = makeFloorBoard('root', 5)
    const eps = makeFloorBoard('eps', 3)
    const layout = {
      right: { p: [1, 2], e: [2, 2], wall: [3, 2] },
      left: { p: [3, 2], e: [2, 2], wall: [1, 2] },
      down: { p: [2, 1], e: [2, 2], wall: [2, 3] },
      up: { p: [2, 3], e: [2, 2], wall: [2, 1] },
    }[approach]
    setWall(root, layout.wall[0], layout.wall[1])
    return makeWorld(
      [root, eps],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'eps', kind: 'container', boardRef: 'eps', epsilonFor: 'seed' },
      ],
      { [PLAYER_ID]: { board: 'root', x: layout.p[0], y: layout.p[1] }, eps: { board: 'root', x: layout.e[0], y: layout.e[1] } },
    )
  }

  it('entering an ε directly (no paradox) lands on the same cell an ordinary box gives, per direction', () => {
    const cell = (dir: 'right' | 'left' | 'down' | 'up') => applyMove(inLevel(dir), dir)!.locations[PLAYER_ID]
    expect(cell('right')).toEqual({ board: 'eps', x: 0, y: 1 })
    expect(cell('left')).toEqual({ board: 'eps', x: 2, y: 1 })
    expect(cell('down')).toEqual({ board: 'eps', x: 1, y: 0 })
    expect(cell('up')).toEqual({ board: 'eps', x: 1, y: 2 })
  })

  it('an in-level ε enters exactly like a plain container with the same interior (no special case)', () => {
    const plain = inLevel('right')
    delete plain.pieces.eps.epsilonFor
    expect(applyMove(inLevel('right'), 'right')!.locations[PLAYER_ID]).toEqual(applyMove(plain, 'right')!.locations[PLAYER_ID])
  })

  it('a null-space Infinite Enter lands by the ordinary entry rule (direction of entry picks the edge)', () => {
    // Enter the looping A from below instead of from the left.
    const root = makeFloorBoard('root', 3)
    setWall(root, 1, 2) // behind A when moving down
    const a = makeFloorBoard('a', 3)
    setWall(a, 1, 1) // behind O when moving down (entry cell for "down" is (1,0); O sits on it)
    const world = makeWorld(
      [root, a],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'A', kind: 'container', boardRef: 'a' },
        { id: 'O', kind: 'container', cloneOf: 'A' },
      ],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 0 }, A: { board: 'root', x: 1, y: 1 }, O: { board: 'a', x: 1, y: 0 } },
    )
    const next = applyMove(world, 'down')!
    // Moving down lands on the middle of the ε's TOP edge.
    expect(next.locations[PLAYER_ID]).toEqual({ board: epsilonBoardIdFor('A'), x: 2, y: 0 })
  })

  it('an ∞ is never enterable: entering it fails (it can only be exited or pushed)', () => {
    const root = makeFloorBoard('root', 5)
    setWall(root, 3, 2)
    const world = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'inf', kind: 'normal', infiniteFor: 'x' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 2 }, inf: { board: 'root', x: 2, y: 2 } },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })
})

describe('a piece already occupying the ε\'s entry cell is pushed aside, ordinary rule', () => {
  it('resolveBlocked: entering ε at an already-occupied (0,2) pushes the occupant one cell right, ordinary rule', () => {
    const world = loopWorld()
    const first = applyMove(world, 'right')!
    const epsId = epsilons(first)[0].id
    // Reset: rebuild the pre-entry world, but place a blocker already at the ε's entry cell.
    const withBlocker = structuredClone(world)
    const board = first.pieces[epsId].boardRef as string
    withBlocker.boards[board] = first.boards[board]
    withBlocker.pieces[epsId] = first.pieces[epsId]
    withBlocker.locations[epsId] = first.locations[epsId]
    withBlocker.pieces.blocker = { id: 'blocker', kind: 'normal' }
    withBlocker.locations.blocker = { board, x: 0, y: 2 }
    const next = applyMove(withBlocker, 'right')!
    expect(next.locations[PLAYER_ID]).toEqual({ board, x: 0, y: 2 })
    expect(next.locations.blocker).toEqual({ board, x: 1, y: 2 })
  })
})

describe('ε interior size is a free per-level choice, not a fixed official value', () => {
  it('ensureEpsilonDestination accepts a custom size, independent of DEFAULT_EPSILON_SIZE', () => {
    const world = loopWorld()
    const result = ensureEpsilonDestination(world, 'A', 3)!
    expect(result.world.boards[result.world.pieces[result.epsilonId].boardRef as string].size).toBe(3)
  })
})
