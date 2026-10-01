import { describe, it, expect } from 'vitest'
import { parseOfficialLevel } from '../../src/game/engine/officialFormat'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from '../../src/game/engine/testFixtures'
import { PLAYER_ID } from '../../src/game/engine/types'
import { validateInfiniteEnter } from './infiniteEnterValidator'

const T = '\t'
const H = 'version 4\n#\n'

// Same structure as officialFormat.test.ts: the goal sits in a floating Block reachable ONLY
// through the Infinite Enter (its Ref is walled off from the player).
const REQUIRES_INFINITE_ENTER = `${H}Block 0 0 0 3 3 0 0 1 1 0 0 0 0 0 0 0
${T}Wall 2 1 0 0 0
${T}Wall 1 2 0 0 0
${T}Block 0 1 2 1 1 0.9 0.8 1 1 0 1 0 0 0 0 0
${T}Block 1 1 1 3 3 0.4 0.8 1 1 0 0 0 0 0 0 0
${T}${T}Wall 1 1 0 0 0
${T}${T}Ref 0 1 1 0 0 0 0 0 -1 0 0 0 0 0 0
${T}Block 0 0 9 1 1 0.5 0.8 1 1 0 0 0 0 0 1 0
${T}${T}Floor 0 0 PlayerButton
${T}Ref 2 2 9 1 0 0 1 1 1 0 0 0 0 0 0
`

describe('infiniteEnterRequired validation', () => {
  it('Test 1: not required -> any level passes without running the analysis', () => {
    const w = makeWorld([makeFloorBoard('root', 3)], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(validateInfiniteEnter(w, false, 50, 5000)).toMatchObject({ required: false, valid: true })
  })

  it('Test 2: required, but the level has no Infinite Enter at all -> reject', () => {
    const root = makeFloorBoard('root', 3)
    setRequirement(root, 2, 2, 'player')
    const w = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    const r = validateInfiniteEnter(w, true, 50, 5000)
    expect(r.valid).toBe(false)
    expect(r.foundRef).toBe(false)
    expect(r.triggered).toBe(false)
    expect(r.error).toMatch(/never triggers/)
  })

  it('Test 3: an infenter Ref EXISTS but the solution never uses it -> reject (existing != required)', () => {
    // The goal is reachable by walking; the walled-off infenter Ref is decoration.
    const root = makeFloorBoard('root', 3)
    setRequirement(root, 1, 0, 'player')
    setWall(root, 1, 2)
    setWall(root, 2, 1)
    const floating = makeFloorBoard('b9', 1)
    const w = makeWorld(
      [root, floating],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'R', kind: 'container', boardRef: 'b9', infEnter: true, infEnterNum: 1, infEnterId: 1, exitBlock: true },
      ],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, R: { board: 'root', x: 2, y: 2 } },
    )
    floating.floatInSpace = true
    const r = validateInfiniteEnter(w, true, 50, 5000)
    expect(r.foundRef).toBe(true)
    expect(r.reachable).toBe(true)
    expect(r.triggered).toBe(false)
    expect(r.valid).toBe(false)
  })

  it('Test 4: a legal Ref whose solution really triggers the Infinite Enter, and cannot be solved without it -> accept', () => {
    const r = validateInfiniteEnter(parseOfficialLevel(REQUIRES_INFINITE_ENTER), true, 50, 5000)
    expect(r).toMatchObject({ required: true, foundRef: true, reachable: true, triggered: true, necessary: true, valid: true, degree: 1 })
  })

  it('a level that triggers an Infinite Enter but is solvable without it is not "required"', () => {
    // Same structure but the goal is ALSO on the root board, reachable by walking.
    const text = REQUIRES_INFINITE_ENTER.replace(`${T}Wall 2 1 0 0 0`, `${T}Wall 2 1 0 0 0\n${T}Floor 0 0 PlayerButton`)
    const w = parseOfficialLevel(text)
    // The player starts ON the root goal, so the level is trivially solved; move it off.
    w.locations[PLAYER_ID] = { board: 'b0', x: 0, y: 1 }
    const r = validateInfiniteEnter(w, true, 50, 5000)
    expect(r.valid).toBe(false)
  })
})
