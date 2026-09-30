import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { applyMove, checkWin, possess } from './rules'
import { parseOfficialLevel } from './officialFormat'
import { withEngineContext, EngineEvent } from './events'
import { makeFloorBoard, makeWorld, setWall } from './testFixtures'
import { Direction, PLAYER_ID, World } from './types'

// Third-party example levels (docs/differential/community-samples, no licence) are kept out of
// the public repository; tests that need one skip when it is not present locally.
const SAMPLE_DIR = join(__dirname, '../../../docs/differential/community-samples')
const hasSample = (name: string) => existsSync(join(SAMPLE_DIR, name))


// Possess (user-requested, 2026-09-26; official attempt "possess", always last): walking into a
// possessable block or wall that cannot be pushed / entered / eaten hands control to it.

function world(opts: { wallBehind: boolean; wallBlock?: boolean }): World {
  // root 4x3: the player at (0,1), a possessable block T at (1,1).
  const root = makeFloorBoard('root', 4)
  if (opts.wallBehind) setWall(root, 2, 1)
  return makeWorld(
    [root],
    [
      { id: PLAYER_ID, kind: 'player', color: '#c4006f' },
      { id: 'T', kind: 'normal', possessable: true, ...(opts.wallBlock ? { wall: true } : {}) },
    ],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, T: { board: 'root', x: 1, y: 1 } },
  )
}

describe('possess', () => {
  it('a possessable box that can still be pushed is pushed, not possessed', () => {
    const next = applyMove(world({ wallBehind: false }), 'right')!
    expect(next.locations.T).toEqual({ board: 'root', x: 2, y: 1 })
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
  })

  it('pushed against a wall, it is possessed: control moves to it, nothing moves', () => {
    const events: EngineEvent[] = []
    const next = withEngineContext({ events }, () => applyMove(world({ wallBehind: true }), 'right'))!
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 }) // the possessed block
    expect(next.locations.T).toEqual({ board: 'root', x: 0, y: 1 }) // the old body, left behind
    expect(next.pieces[PLAYER_ID].kind).toBe('player')
    expect(next.pieces.T.kind).toBe('normal')
    expect(next.pieces.T.color).toBe('#c4006f') // the old body keeps its own look
    expect(events).toEqual([{ type: 'PossessEvent', targetId: 'T' }])
  })

  it('a non-possessable box against a wall just blocks', () => {
    const w = world({ wallBehind: true })
    delete w.pieces.T.possessable
    expect(applyMove(w, 'right')).toBeNull()
  })

  it('a wall block never moves on its own, cannot be pushed, and is possessed instead', () => {
    const next = applyMove(world({ wallBehind: false, wallBlock: true }), 'right')!
    expect(next.pieces[PLAYER_ID].wall).toBe(true)
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
  })

  it('once possessed, the wall block walks and pushes like the player', () => {
    let w = applyMove(world({ wallBehind: false, wallBlock: true }), 'right')!
    w = applyMove(w, 'right')!
    expect(w.locations[PLAYER_ID]).toEqual({ board: 'root', x: 2, y: 1 })
  })

  it('possess is its own inverse (swapping back restores the world)', () => {
    const w = world({ wallBehind: true })
    expect(possess(possess(w, 'T'), 'T')).toEqual(w)
  })
})

describe.skipIf(!hasSample('poswall_first.txt'))('poswall_first.txt', () => {
  it('parses the possessable Wall as a wall block, and is solvable by possessing it', () => {
    const text = readFileSync(join(__dirname, '../../../docs/differential/community-samples/poswall_first.txt'), 'utf8')
    let w = parseOfficialLevel(text)
    expect(w.pieces.wall0).toEqual({ id: 'wall0', kind: 'normal', wall: true, possessable: true })
    const path = 'down,down,right,down,down,right,right,right,left,up,left,down,left,up,up,up,right,down,down'.split(',') as Direction[]
    let wasWall = false
    path.forEach((dir, i) => {
      const next = applyMove(w, dir)
      expect(next, `move ${i + 1} (${dir})`).not.toBeNull()
      w = next!
      if (w.pieces[PLAYER_ID].wall === true) wasWall = true
    })
    expect(wasWall).toBe(true) // the solution goes through possessing the wall
    expect(checkWin(w)).toBe(true)
  })
})
