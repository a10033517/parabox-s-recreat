import { describe, it, expect } from 'vitest'
import { applyMove } from './rules'
import { makeFloorBoard, makeWorld } from './testFixtures'
import {
  PLAYER_ID, VOID_BOARD_ID, VOID_CENTER, World, ensureInfiniteDestination, findContainerFor, isInVoid, occupantAt,
} from './types'
import { parseLevel, serializeLevel } from './levelSchema'
import { GameState } from './GameState'

function selfLoopFlushRight(): World {
  return makeWorld(
    [makeFloorBoard('root', 3)],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'loopBox', kind: 'container', boardRef: 'root' },
    ],
    { [PLAYER_ID]: { board: 'root', x: 1, y: 1 }, loopBox: { board: 'root', x: 2, y: 1 } },
  )
}

interface VoidPiece { id: string; kind: 'normal'; infiniteFor?: string; x: number }

// A hand-built world whose player already stands in the Void (row y=2), next
// to whatever the test places there.
function voidWorld(extra: VoidPiece[], playerX: number): World {
  return makeWorld(
    [makeFloorBoard('root', 2), makeFloorBoard(VOID_BOARD_ID, 5)],
    [
      { id: PLAYER_ID, kind: 'player' },
      ...extra.map((p) => ({ id: p.id, kind: p.kind, infiniteFor: p.infiniteFor })),
    ],
    {
      [PLAYER_ID]: { board: VOID_BOARD_ID, x: playerX, y: 2 },
      ...Object.fromEntries(extra.map((p) => [p.id, { board: VOID_BOARD_ID, x: p.x, y: 2 }])),
    },
  )
}

describe('V01 — Void is a real space with no outer level, distinct from root', () => {
  it('has no owning container, unlike every ordinary interior', () => {
    const next = applyMove(selfLoopFlushRight(), 'right')!
    expect(next.boards[VOID_BOARD_ID]).toBeDefined()
    expect(findContainerFor(next, VOID_BOARD_ID)).toBeUndefined()
    expect(isInVoid(next, 'loopBox')).toBe(true)
    expect(isInVoid(next, PLAYER_ID)).toBe(false)
  })

  it('a piece standing in the Void cannot walk out past its edge (nothing to climb into)', () => {
    const world = voidWorld([], 4)
    expect(applyMove(world, 'right')).toBeNull()
    expect(applyMove(world, 'left')?.locations[PLAYER_ID]).toEqual({ board: VOID_BOARD_ID, x: 3, y: 2 })
  })

  it('a level cannot author the reserved Void board id', () => {
    const data = serializeLevel(selfLoopFlushRight()) as { boards: Record<string, unknown> }
    data.boards[VOID_BOARD_ID] = { id: VOID_BOARD_ID, size: 3, cells: makeFloorBoard(VOID_BOARD_ID, 3).cells }
    expect(() => parseLevel(data)).toThrow(/reserved/)
  })
})

describe('V02 — a self-loop box pushed out of itself spawns Infinite(A) in the Void and is ejected from it', () => {
  it('spawns exactly one destination and ejects the box in the push direction', () => {
    const next = applyMove(selfLoopFlushRight(), 'right')!
    expect(next.pieces['void-infinite:loopBox'].infiniteFor).toBe('loopBox')
    expect(next.locations['void-infinite:loopBox']).toEqual({ board: VOID_BOARD_ID, x: VOID_CENTER, y: VOID_CENTER }) // Infinite box at the Void center
    expect(next.locations.loopBox).toEqual({ board: VOID_BOARD_ID, x: VOID_CENTER + 1, y: VOID_CENTER })
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 2, y: 1 }) // pusher still completes its move
  })

  it('the ejected box keeps its identity and interior (not destroyed)', () => {
    const next = applyMove(selfLoopFlushRight(), 'right')!
    expect(next.pieces.loopBox).toEqual({ id: 'loopBox', kind: 'container', boardRef: 'root' })
  })
})

describe('V03 — an existing Infinite destination is reused, never duplicated', () => {
  it('ensureInfiniteDestination is idempotent for the same owner', () => {
    const first = ensureInfiniteDestination(selfLoopFlushRight(), 'loopBox')!
    const second = ensureInfiniteDestination(first.world, 'loopBox')!
    expect(second.location).toEqual(first.location)
    const destinations = Object.values(second.world.pieces).filter((p) => p.infiniteFor === 'loopBox')
    expect(destinations).toHaveLength(1)
  })

  it('a hand-authored destination (infiniteFor) already in the Void is used instead of synthesizing one', () => {
    const world = voidWorld([{ id: 'authored', kind: 'normal', infiniteFor: 'loopBox', x: 1 }], 0)
    const result = ensureInfiniteDestination(world, 'loopBox')!
    expect(result.location).toEqual({ board: VOID_BOARD_ID, x: 1, y: 2 })
    expect(Object.keys(result.world.pieces).filter((id) => id.startsWith('void-infinite:'))).toHaveLength(0)
  })

  it('different owners get different destinations', () => {
    const a = ensureInfiniteDestination(selfLoopFlushRight(), 'ownerA')!
    const b = ensureInfiniteDestination(a.world, 'ownerB')!
    expect(b.location).not.toEqual(a.location)
  })
})

describe('V04 — pushing toward Infinite(A) inside the Void pushes it; the Void is a space, not a trash can', () => {
  it('a piece pushed into the destination is not consumed: the whole chain shifts', () => {
    const world = voidWorld(
      [
        { id: 'X', kind: 'normal', x: 1 },
        { id: 'dest', kind: 'normal', infiniteFor: 'A', x: 2 },
      ],
      0,
    )
    const next = applyMove(world, 'right')!
    expect(next.locations[PLAYER_ID]).toEqual({ board: VOID_BOARD_ID, x: 1, y: 2 })
    expect(next.locations.X).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 })
    expect(next.locations.dest).toEqual({ board: VOID_BOARD_ID, x: 3, y: 2 })
    expect(Object.keys(next.locations).sort()).toEqual(Object.keys(world.locations).sort())
  })

  it('with no room to push, the move fails (destination cannot be entered) and nothing changes', () => {
    const world = voidWorld(
      [
        { id: 'X', kind: 'normal', x: 3 },
        { id: 'dest', kind: 'normal', infiniteFor: 'A', x: 4 },
      ],
      2,
    )
    expect(applyMove(world, 'right')).toBeNull()
  })
})

describe('V05 — several pieces in the Void: collision, chain push, no overlap', () => {
  const row = () =>
    voidWorld(
      [
        { id: 'dest', kind: 'normal', infiniteFor: 'A', x: 1 },
        { id: 'X', kind: 'normal', x: 2 },
        { id: 'Y', kind: 'normal', x: 3 },
      ],
      0,
    )

  it('a chain of three shifts together by one cell', () => {
    const next = applyMove(row(), 'right')!
    expect([next.locations.dest.x, next.locations.X.x, next.locations.Y.x]).toEqual([2, 3, 4])
    expect(next.locations[PLAYER_ID].x).toBe(1)
  })

  it('the chain is rejected as a whole when its far end hits the Void edge', () => {
    const once = applyMove(row(), 'right')!
    expect(applyMove(once, 'right')).toBeNull()
  })

  it('no two pieces ever share a cell after a successful move', () => {
    const next = applyMove(row(), 'right')!
    const cells = Object.values(next.locations).map((l) => `${l.board}:${l.x}:${l.y}`)
    expect(new Set(cells).size).toBe(cells.length)
    expect(occupantAt(next, { board: VOID_BOARD_ID, x: 1, y: 2 })).toBe(PLAYER_ID)
  })

  it('a locked container in the Void is never entered as a fallback when it cannot be pushed', () => {
    const world = voidWorld(
      [
        { id: 'X', kind: 'normal', x: 3 },
        { id: 'Y', kind: 'normal', x: 4 },
      ],
      2,
    )
    world.pieces.X = { id: 'X', kind: 'container', boardRef: 'root' }
    expect(applyMove(world, 'right')).toBeNull()
  })
})

describe('IE11 / F09 — undo restores topology and paradox state exactly', () => {
  it('undoing the move that spawned Infinite(A) removes the Void, the destination and the ejection', () => {
    const start = selfLoopFlushRight()
    const before = JSON.stringify(start)
    const state = new GameState(start)
    expect(state.move('right')).toBe(true)
    expect(state.current.boards[VOID_BOARD_ID]).toBeDefined()
    expect(state.current.pieces['void-infinite:loopBox']).toBeDefined()
    expect(state.undo()).toBe(true)
    expect(JSON.stringify(state.current)).toBe(before)
    expect(state.current.boards[VOID_BOARD_ID]).toBeUndefined()
  })
})

