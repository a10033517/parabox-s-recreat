import { describe, it, expect } from 'vitest'
import { generateInfiniteEnterCandidate, generateInfiniteEnterLevels, IE_ARCHETYPE_CONFIG } from './infiniteEnterArchetype'
import { validateInfiniteEnter } from './infiniteEnterValidator'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { GameState } from '../../src/game/engine/GameState'
import { solve } from './solver'

describe('Infinite Enter archetype generator', () => {
  it('yields levels that pass the infiniteEnterRequired gate and survive a save/load round trip', () => {
    const batch = generateInfiniteEnterLevels(4, Math.random, 300)
    expect(batch.levels.length).toBe(4)
    for (const world of batch.levels) {
      const loaded = parseLevel(JSON.parse(JSON.stringify(serializeLevel(world))))
      const verdict = validateInfiniteEnter(loaded, true, 200, 20000)
      expect(verdict).toMatchObject({ foundRef: true, reachable: true, triggered: true, necessary: true, valid: true })
    }
  })

  it('every accepted level is really solved by replaying its solution, ending on the goal', () => {
    const { levels } = generateInfiniteEnterLevels(3, Math.random, 300)
    expect(levels.length).toBe(3)
    for (const world of levels) {
      const solution = solve(world, 200, 20000)!
      const state = new GameState(world)
      for (const move of solution.moves) expect(state.move(move)).toBe(true)
      expect(state.isWon).toBe(true)
      expect(state.current.boards.void).toBeUndefined() // authored destination: no null-space ε
    }
  })

  it('a candidate the gate accepts is always "necessary" (the pocket is sealed)', () => {
    let checked = 0
    for (let i = 0; i < 200 && checked < 5; i++) {
      const candidate = generateInfiniteEnterCandidate(IE_ARCHETYPE_CONFIG, Math.random)
      if (candidate === null) continue
      const verdict = validateInfiniteEnter(candidate, true, 200, 20000)
      if (verdict.valid) {
        expect(verdict.necessary).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('is deterministic for a fixed rng', () => {
    const seeded = () => {
      let s = 7
      return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 10000) / 10000
    }
    const a = generateInfiniteEnterLevels(2, seeded(), 200).levels.map((w) => JSON.stringify(serializeLevel(w)))
    const b = generateInfiniteEnterLevels(2, seeded(), 200).levels.map((w) => JSON.stringify(serializeLevel(w)))
    expect(a).toEqual(b)
  })
})
