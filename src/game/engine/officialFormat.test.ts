import { describe, it, expect } from 'vitest'
import { parseOfficialLevel, infiniteEnterRegistry } from './officialFormat'
import { GameState } from './GameState'
import { applyMove } from './rules'
import { PLAYER_ID } from './types'

const HEADER = 'version 4\n#\n'
const T = '\t'

// Root 3x3. A (id 1) sits at (1,1) with a wall behind it; A's interior holds a Ref to itself
// (a clone, O) at its entry cell with a wall behind O — so entering A loops inward forever.
// F (id 9) is a floating Block whose interior holds the goal; R is the exitblock Ref to F
// carrying the infenter metadata for level 1, walled off from the player.
const OFFICIAL = `${HEADER}Block 0 0 0 3 3 0 0 1 1 0 0 0 0 0 0 0
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

describe('official loader: floating Block / exitblock Ref / infenter', () => {
  it('Test 1: an ordinary Block gets a placed instance and an outer level', () => {
    const w = parseOfficialLevel(OFFICIAL)
    expect(w.boards.b1.floatInSpace).toBeUndefined()
    expect(w.pieces.p1).toEqual({ id: 'p1', kind: 'container', boardRef: 'b1' })
    expect(w.locations.p1).toEqual({ board: 'b0', x: 1, y: 1 })
  })

  it('Test 2: a floating Block is a Definition only — flagged floating, never placed in a parent', () => {
    const w = parseOfficialLevel(OFFICIAL)
    expect(w.boards.b9.floatInSpace).toBe(true)
    expect(w.pieces.p9).toBeUndefined()
    expect(w.locations.p9).toBeUndefined()
  })

  it('Test 3: an exitblock Ref is flagged and resolves to the floating Block, sharing it (no copy)', () => {
    const w = parseOfficialLevel(OFFICIAL)
    const ref = Object.values(w.pieces).find((p) => p.exitBlock)!
    expect(ref.boardRef).toBe('b9')
    expect(Object.keys(w.boards).filter((b) => b === 'b9')).toHaveLength(1)
  })

  it('Test 4: infenter keeps enabled / degree / infenterid raw', () => {
    const w = parseOfficialLevel(OFFICIAL)
    const ref = Object.values(w.pieces).find((p) => p.infEnter)!
    expect(ref.infEnter).toBe(true)
    expect(ref.infEnterNum).toBe(1)
    expect(ref.infEnterId).toBe(1)
  })

  it('Test 5: the full official structure loads and lands in the registry', () => {
    const w = parseOfficialLevel(OFFICIAL)
    const registry = infiniteEnterRegistry(w)
    expect(registry).toHaveLength(1)
    expect(registry[0]).toMatchObject({ degree: 1, levelId: 1, floatingBoard: 'b9', isExitBlock: true })
  })

  it('a Ref may appear before the Block it points at (two-pass resolution)', () => {
    const text = `${HEADER}Block 0 0 0 3 3 0 0 1 1 0 0 0 0 0 0 0
${T}Ref 2 2 9 1 0 0 0 0 -1 0 0 0 0 0 0
${T}Block 0 1 2 1 1 0.9 0.8 1 1 0 1 0 0 0 0 0
${T}Block 0 0 9 1 1 0.5 0.8 1 1 0 0 0 0 0 1 0
`
    expect(() => parseOfficialLevel(text)).not.toThrow()
  })

  it('a Ref to a normal (non-floating) Block shares its board — a second instance of one Definition, not a cloneOf redirect', () => {
    const text = `${HEADER}Block 0 0 0 4 4 0 0 1 1 0 0 0 0 0 0 0
${T}Block 0 0 2 1 1 0.9 0.8 1 1 0 1 0 0 0 0 0
${T}Block 1 1 1 3 3 0.4 0.8 1 1 0 0 0 0 0 0 0
${T}Ref 3 3 1 0 0 0 0 0 -1 0 0 0 0 0 0
`
    const w = parseOfficialLevel(text)
    expect(w.pieces.ref0).toEqual({ id: 'ref0', kind: 'container', boardRef: 'b1' })
    expect(w.pieces.p1.boardRef).toBe('b1') // same Definition as the original Block instance
  })

  it('a Ref pointing at its OWN containing Block (self-loop) works: no cloneOf to a non-existent piece', () => {
    // Root has no placed piece of its own (cloneOf: "p<rootId>" would be broken) — confirmed
    // against a real Parafox example level (iiexit_intro.txt) that uses exactly this shape for
    // an Infinite Exit demo: three Refs inside root, each pointing back at root's own id.
    const text = `${HEADER}Block 0 0 0 3 3 0 0 1 1 0 0 0 0 0 0 0
${T}Ref 1 1 0 0 0 0 0 0 -1 0 0 0 0 0 0
${T}Block 0 1 2 1 1 0.9 0.8 1 1 0 1 0 0 0 0 0
`
    const w = parseOfficialLevel(text)
    expect(w.pieces.ref0).toEqual({ id: 'ref0', kind: 'container', boardRef: 'b0' })
    expect(() => applyMove(w, 'left')).not.toThrow()
  })

  it('rejects an infenter Ref with no target', () => {
    const text = `${HEADER}Block 0 0 0 3 3 0 0 1 1 0 0 0 0 0 0 0
${T}Block 0 1 2 1 1 0.9 0.8 1 1 0 1 0 0 0 0 0
${T}Ref 2 2 7 1 0 0 1 1 1 0 0 0 0 0 0
`
    expect(() => parseOfficialLevel(text)).toThrow(/infenter Ref needs a target/)
  })

  it('rejects an infenter Ref whose target is not a floating Block', () => {
    const text = `${HEADER}Block 0 0 0 3 3 0 0 1 1 0 0 0 0 0 0 0
${T}Block 0 1 2 1 1 0.9 0.8 1 1 0 1 0 0 0 0 0
${T}Block 1 1 1 3 3 0.4 0.8 1 1 0 0 0 0 0 0 0
${T}Ref 2 2 1 1 0 0 1 1 1 0 0 0 0 0 0
`
    expect(() => parseOfficialLevel(text)).toThrow(/must target a floating Block/)
  })

  it('rejects non-square blocks and unknown versions instead of guessing', () => {
    expect(() => parseOfficialLevel(`${HEADER}Block 0 0 0 3 4 0 0 1 1 0 0 0 0 0 0 0\n`)).toThrow(/square/)
    expect(() => parseOfficialLevel('version 3\n#\nBlock 0 0 0 3 3 0 0 1 1 0 0 0 0 0 0 0\n')).toThrow(/version 4/)
  })
})

describe('end to end: load -> infinite enter -> authored destination -> SpawnEpsilonEvent -> win', () => {
  it('the walled-off floating Block is reachable only through the Infinite Enter', () => {
    const state = new GameState(parseOfficialLevel(OFFICIAL))
    expect(state.isWon).toBe(false)
    expect(state.move('right')).toBe(true)
    expect(state.current.locations[PLAYER_ID].board).toBe('b9')
    expect(state.isWon).toBe(true)
    const epsilonEvents = state.lastEvents.filter((e) => e.type === 'SpawnEpsilonEvent')
    expect(epsilonEvents).toHaveLength(1)
    expect(epsilonEvents[0]).toMatchObject({ type: 'SpawnEpsilonEvent', seedId: 'p1', authored: true, created: false, board: 'b9', degree: 1 })
    // An authored destination exists already: no null-space ε and no Void were materialized.
    expect(state.current.boards.void).toBeUndefined()
  })

  it('undo clears the one-shot events and restores the exact world', () => {
    const start = parseOfficialLevel(OFFICIAL)
    const before = JSON.stringify(start)
    const state = new GameState(start)
    state.move('right')
    expect(state.undo()).toBe(true)
    expect(state.lastEvents).toEqual([])
    expect(JSON.stringify(state.current)).toBe(before)
  })

  it('regression: an ordinary recursion that terminates emits no epsilon event', () => {
    const text = `${HEADER}Block 0 0 0 3 3 0 0 1 1 0 0 0 0 0 0 0
${T}Wall 2 1 0 0 0
${T}Block 0 1 2 1 1 0.9 0.8 1 1 0 1 0 0 0 0 0
${T}Block 1 1 1 3 3 0.4 0.8 1 1 0 0 0 0 0 0 0
`
    const state = new GameState(parseOfficialLevel(text))
    expect(state.move('right')).toBe(true)
    expect(state.lastEvents.filter((e) => e.type === 'SpawnEpsilonEvent')).toEqual([])
  })
})
