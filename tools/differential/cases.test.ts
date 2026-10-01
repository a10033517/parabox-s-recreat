import { describe, it, expect } from 'vitest'
import { cases } from './cases'
import { replay } from '../../src/game/engine/replayHarness'

describe('differential cases', () => {
  it('all cases build and replay; text cases are real official-format files', () => {
    for (const c of cases()) {
      expect(() => replay(c.world, c.inputs)).not.toThrow()
      if (c.officialText !== undefined) expect(c.officialText.startsWith('version 4\n#\n')).toBe(true)
    }
  })

  it('infinite-enter predictions: authored ε entered, null-space ε created, id-matched candidate chosen', () => {
    const byId = Object.fromEntries(cases().map((c) => [c.id, c]))
    expect(replay(byId['case5-infenter-authored'].world, ['R'])[0].locations.player.board).toBe('b9')
    expect(replay(byId['case6-infinite-enter-null-space'].world, ['R'])[0].locations.player).toEqual({ board: 'epsilon:p1', x: 0, y: 2 })
    expect(replay(byId['case7-infenterid-matching'].world, ['R'])[0].locations.player.board).toBe('b9')
  })
})
