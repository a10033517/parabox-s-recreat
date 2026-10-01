import { describe, it, expect } from 'vitest'
import { finalWorld, replay } from './replayHarness'
import { makeFloorBoard, makeWorld, setWall } from './testFixtures'
import { PLAYER_ID, VOID_BOARD_ID, findContainerFor, instancesOf, targetDefinitionOf } from './types'

// Phase 3 characterization cases for the Definition / Instance layer. Anything marked
// PROVISIONAL is the canonical-instance exit rule (findContainerFor), which is NOT
// verified against the original game — when a differential capture disagrees, replace
// the expectation, not the harness.

describe('1 Definition + 1 Ref', () => {
  const build = () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 1)
    return makeWorld(
      [root, makeFloorBoard('inside', 3)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'a', kind: 'container', boardRef: 'inside' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, a: { board: 'root', x: 1, y: 1 } },
    )
  }

  it('enter then exit returns to the cell beside the Ref', () => {
    const snaps = replay(build(), ['R', 'L'])
    expect(snaps[0].locations[PLAYER_ID]).toEqual({ board: 'inside', x: 0, y: 1 })
    expect(snaps[1].locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 1 })
  })

  it('definition/instance helpers agree', () => {
    const w = build()
    expect(instancesOf(w, 'inside')).toEqual(['a'])
    expect(targetDefinitionOf(w, w.pieces.a)).toBe('inside')
    expect(findContainerFor(w, 'inside')).toBe('a')
  })
})

describe('2 Ref -> same Definition', () => {
  const build = () => {
    const root = makeFloorBoard('root', 5)
    setWall(root, 2, 1)
    setWall(root, 2, 3)
    const inside = makeFloorBoard('inside', 3)
    return makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'box', kind: 'normal' },
        { id: 'a', kind: 'container', boardRef: 'inside' },
        { id: 'b', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 3 },
        a: { board: 'root', x: 1, y: 1 },
        b: { board: 'root', x: 1, y: 3 },
        box: { board: 'inside', x: 2, y: 0 },
      },
    )
  }

  it('entering through either Ref lands in the one shared interior', () => {
    const viaB = finalWorld(build(), ['R'])
    expect(viaB.locations[PLAYER_ID].board).toBe('inside')
    const w = build()
    w.locations[PLAYER_ID] = { board: 'root', x: 0, y: 1 }
    expect(finalWorld(w, ['R']).locations[PLAYER_ID].board).toBe('inside')
  })

  it('interior state is shared: the box is the same piece whichever Ref is used', () => {
    const viaB = finalWorld(build(), ['R'])
    expect(viaB.locations.box).toEqual({ board: 'inside', x: 2, y: 0 })
    expect(Object.keys(viaB.locations).filter((id) => id === 'box')).toHaveLength(1)
  })

  it('PROVISIONAL (no exitblock authored): exiting returns beside the smallest-id Ref, even when entered through the other', () => {
    const snaps = replay(build(), ['R', 'L']) // entered via b at (1,3); canonical owner is a at (1,1)
    expect(snaps[1].locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 1 })
  })

  it('exitBlock (editor-confirmed): the Ref flagged exitBlock is the canonical exit, regardless of id order or entry side', () => {
    // Zygahedron/Parabox-Editor's level.py enforces at most one exitblock=1 Ref per Block id,
    // and treats it as that Block's single recognized exit — see findContainerFor's own comment.
    const w = build()
    w.pieces.b.exitBlock = true
    const snaps = replay(w, ['R', 'L']) // entered via b (the smaller-id 'a' is NOT flagged)
    expect(snaps[1].locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 3 }) // beside b, not a
  })

  it('an exitBlock Ref that is itself an infEnter catcher is not used as the ordinary exit (editor keeps the two roles separate)', () => {
    const w = build()
    w.pieces.b.exitBlock = true
    w.pieces.b.infEnter = true // b is an infinite-enter destination, not an ordinary exit
    expect(findContainerFor(w, 'inside')).toBe('a') // falls back to the smallest-id instance
  })

  it('instances are listed deterministically', () => {
    expect(instancesOf(build(), 'inside')).toEqual(['a', 'b'])
  })
})

describe('nested shared Definition', () => {
  it('two Refs to X inside Y: instances and canonical owner resolve deterministically', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 1)
    const y = makeFloorBoard('y', 5)
    const world = makeWorld(
      [root, y, makeFloorBoard('x', 3)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'toY', kind: 'container', boardRef: 'y' },
        { id: 'r1', kind: 'container', boardRef: 'x' },
        { id: 'r2', kind: 'container', boardRef: 'x' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        toY: { board: 'root', x: 1, y: 1 },
        r1: { board: 'y', x: 1, y: 1 },
        r2: { board: 'y', x: 1, y: 3 },
      },
    )
    expect(instancesOf(world, 'x')).toEqual(['r1', 'r2'])
    expect(findContainerFor(world, 'x')).toBe('r1')
    expect(finalWorld(world, ['R']).locations[PLAYER_ID].board).toBe('y')
  })
})

describe('shared Definition + Clone', () => {
  it('a clone counts as an instance of its source definition but is never the canonical exit owner', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 4), makeFloorBoard('inside', 3)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'z', kind: 'container', boardRef: 'inside' },
        { id: 'a', kind: 'container', cloneOf: 'z' },
        { id: 'b', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        z: { board: 'root', x: 1, y: 0 },
        a: { board: 'root', x: 2, y: 0 },
        b: { board: 'root', x: 3, y: 0 },
      },
    )
    expect(instancesOf(world, 'inside')).toEqual(['a', 'b', 'z'])
    expect(targetDefinitionOf(world, world.pieces.a)).toBe('inside')
    expect(findContainerFor(world, 'inside')).toBe('b') // 'a' is a clone; smallest non-clone id
  })
})

describe('shared Definition + recursion', () => {
  it('two self-loop Refs on one board: replay is deterministic and does not crash', () => {
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 1)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopA', kind: 'container', boardRef: 'root' },
        { id: 'loopB', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 1, y: 1 },
        loopA: { board: 'root', x: 2, y: 1 },
        loopB: { board: 'root', x: 2, y: 3 },
      },
    )
    expect(replay(world, ['R', 'L', 'R'])).toEqual(replay(structuredClone(world), ['R', 'L', 'R']))
    expect(findContainerFor(world, 'root')).toBe('loopA')
  })
})

describe('shared Definition + infinite exit', () => {
  it('the Void destination is keyed to the canonical Ref (single destination)', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopA', kind: 'container', boardRef: 'root' },
        { id: 'loopB', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 1, y: 0 },
        loopA: { board: 'root', x: 2, y: 0 },
        loopB: { board: 'root', x: 2, y: 2 },
      },
    )
    const next = finalWorld(world, ['R']) // pushes loopA flush against the right edge -> infinite
    const destinations = Object.values(next.pieces).filter((p) => p.infiniteFor !== undefined)
    expect(destinations.map((p) => p.infiniteFor)).toEqual(['loopA'])
    expect(next.locations.loopA.board).toBe(VOID_BOARD_ID)
  })
})
