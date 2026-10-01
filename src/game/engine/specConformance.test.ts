import { describe, it, expect } from 'vitest'
import { applyMove } from './rules'
import { GameState } from './GameState'
import { makeFloorBoard, makeWorld, setWall } from './testFixtures'
import { PLAYER_ID, VOID_BOARD_ID } from './types'

// Conformance tests for parabox_recursive_clone_infinite_void_implementation_spec.md
// (sections cited in each title). None of these depend on original-game captures.

describe('§57 self-loop: finite recursion is not a paradox', () => {
  const build = (loopX: number) =>
    makeWorld(
      [makeFloorBoard('root', 4)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'A', kind: 'container', boardRef: 'root' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, A: { board: 'root', x: loopX, y: 1 } },
    )

  it('T3: pushing a non-flush self-loop box outward only moves it (no Void, no ∞)', () => {
    const next = applyMove(build(1), 'right')!
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(next.locations.A).toEqual({ board: 'root', x: 2, y: 1 })
  })

  it('T3: pushing it flush against the edge and again outward is the infinite exit', () => {
    const state = new GameState(build(2))
    expect(state.move('right')).toBe(true) // player walks up to A
    expect(state.move('right')).toBe(true) // A 2 -> 3, flush
    expect(state.current.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(state.move('right')).toBe(true) // now infinite
    expect(state.current.locations.A.board).toBe(VOID_BOARD_ID)
  })
})

describe('§58 clone is a one-way entry, never a portal pair', () => {
  // Original A at (1,1), clone C at (1,3); walls behind both force "enter" over "push".
  const build = (playerY: number) => {
    const root = makeFloorBoard('root', 5)
    setWall(root, 2, 1)
    setWall(root, 2, 3)
    return makeWorld(
      [root, makeFloorBoard('inside', 3)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'A', kind: 'container', boardRef: 'inside' },
        { id: 'C', kind: 'container', cloneOf: 'A' },
      ],
      { [PLAYER_ID]: { board: 'root', x: 0, y: playerY }, A: { board: 'root', x: 1, y: 1 }, C: { board: 'root', x: 1, y: 3 } },
    )
  }

  it('C1/C2: enter the original and exit — the player comes out beside the ORIGINAL, not the clone', () => {
    const state = new GameState(build(1))
    state.move('right')
    expect(state.current.locations[PLAYER_ID].board).toBe('inside')
    state.move('left')
    expect(state.current.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 1 })
  })

  it('C3/C4: enter via the clone (same interior) — leaving does not route back through the clone', () => {
    const state = new GameState(build(3))
    state.move('right')
    expect(state.current.locations[PLAYER_ID].board).toBe('inside')
    state.move('left')
    expect(state.current.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 1 })
  })

  it('C6: original and clone are distinct instances that share one definition and copy nothing', () => {
    const world = build(1)
    expect(world.pieces.A).not.toBe(world.pieces.C)
    expect(world.pieces.C.boardRef).toBeUndefined() // no deep-copied interior
    expect(Object.keys(world.boards)).toEqual(['root', 'inside']) // no second interior board
  })
})

describe('§59 clone inside its original terminates (no stack overflow)', () => {
  it('CI1–CI5: entering a clone that sits in its own source interior resolves in finitely many steps', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 1)
    const a = makeFloorBoard('a', 3)
    setWall(a, 2, 1) // behind the clone, forcing enter
    const world = makeWorld(
      [root, a],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'A', kind: 'container', boardRef: 'a' },
        { id: 'C', kind: 'container', cloneOf: 'A' },
      ],
      { [PLAYER_ID]: { board: 'a', x: 0, y: 1 }, A: { board: 'root', x: 1, y: 1 }, C: { board: 'a', x: 1, y: 1 } },
    )
    let result: ReturnType<typeof applyMove> | undefined
    expect(() => { result = applyMove(world, 'right') }).not.toThrow()
    // Enter the clone -> the source interior 'a' at the same entry cell: a finite recursion.
    expect(result?.locations[PLAYER_ID].board).toBe('a')
  })
})

describe('§25 / §36 / §61 an existing ∞ destination catches the paradox', () => {
  const build = () => {
    const root = makeFloorBoard('root', 4)
    return makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loop', kind: 'container', boardRef: 'root' },
        { id: 'inf', kind: 'normal', infiniteFor: 'loop' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 2, y: 1 },
        loop: { board: 'root', x: 3, y: 1 }, // flush right
        inf: { board: 'root', x: 1, y: 3 },
      },
    )
  }

  it('ejects next to the existing ∞ in ITS space and never materializes the Void or a second ∞', () => {
    const next = applyMove(build(), 'right')!
    expect(next.boards[VOID_BOARD_ID]).toBeUndefined()
    expect(Object.keys(next.pieces).filter((id) => id.startsWith('void-infinite:'))).toEqual([])
    expect(next.locations.loop).toEqual({ board: 'root', x: 2, y: 3 }) // right of ∞, pushed in the push direction
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 3, y: 1 }) // pusher still completes its move
  })

  it('undo restores the pre-paradox world exactly', () => {
    const start = build()
    const before = JSON.stringify(start)
    const state = new GameState(start)
    expect(state.move('right')).toBe(true)
    expect(state.undo()).toBe(true)
    expect(JSON.stringify(state.current)).toBe(before)
  })

  it('an ∞ standing in an ordinary board cannot be entered', () => {
    const world = build()
    world.locations[PLAYER_ID] = { board: 'root', x: 0, y: 3 }
    // Player walks right into ∞ at (1,3): pushed like any box, never entered.
    const next = applyMove(world, 'right')!
    expect(next.locations.inf).toEqual({ board: 'root', x: 2, y: 3 })
    expect(next.locations[PLAYER_ID].board).toBe('root')
  })
})

describe('§31 / §63 the Void is lazy: created only when a paradox has no finite destination', () => {
  it('a level that never triggers a paradox never has a Void board', () => {
    const state = new GameState(
      makeWorld(
        [makeFloorBoard('root', 3)],
        [{ id: PLAYER_ID, kind: 'player' }],
        { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
      ),
    )
    state.move('right')
    state.move('down')
    expect(state.current.boards[VOID_BOARD_ID]).toBeUndefined()
  })
})

describe('§39–40 paradox attribution keeps the first-transition seed', () => {
  it('a piece that climbs through a tail before the loop is attributed to the FIRST container it exits', () => {
    // branchBoard is owned by branchPiece, which sits flush on the self-loop root.
    const root = makeFloorBoard('root', 3)
    const branch = makeFloorBoard('branch', 2)
    const world = makeWorld(
      [root, branch],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'branchPiece', kind: 'container', boardRef: 'branch' },
        { id: 'loop', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'branch', x: 1, y: 0 },
        branchPiece: { board: 'root', x: 2, y: 0 }, // flush right of the self-loop root
        loop: { board: 'root', x: 2, y: 2 }, // also flush right, so the climb keeps going
      },
    )
    const next = applyMove(world, 'right')!
    expect(next.pieces['void-infinite:branchPiece']?.infiniteFor).toBe('branchPiece')
    expect(next.pieces['void-infinite:loop']).toBeUndefined()
  })
})
