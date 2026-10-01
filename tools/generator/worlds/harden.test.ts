import { describe, expect, it } from 'vitest'
import { TUTORIAL, buildTutorialWorld } from '../tutorial'
import { mulberry32 } from './build'
import { hardenLevel, rearrange } from './harden'
import { INTRO } from './profiles'
import { difficultyScore } from './score'
import { verifyWorldLevel } from './verify'

const BUDGET = { maxDepth: 40, maxExpanded: 20_000, maxAblationExpanded: 40_000 }

describe('rearrange', () => {
  it('keeps every piece on its own board, off goals, with nothing stacked', () => {
    const world = buildTutorialWorld(TUTORIAL.find((l) => l.id === '03-push-in')!)
    const next = rearrange(world, mulberry32(1))!
    expect(Object.keys(next.locations).sort()).toEqual(Object.keys(world.locations).sort())
    const cells = new Set<string>()
    for (const [id, loc] of Object.entries(next.locations)) {
      expect(loc.board).toBe(world.locations[id].board)
      const cell = next.boards[loc.board].cells[loc.y][loc.x]
      expect(cell.type).toBe('floor')
      expect(cell.requirement).toBeUndefined()
      cells.add(`${loc.board}:${loc.x},${loc.y}`)
    }
    expect(cells.size).toBe(Object.keys(next.locations).length)
  })
})

describe('hardenLevel', () => {
  it('never returns an easier level, and what it returns still passes the World checks', () => {
    const world = buildTutorialWorld(TUTORIAL.find((l) => l.id === '03-push-in')!)
    const profile = { ...INTRO, minSolutionLength: 1 }
    const start = verifyWorldLevel(profile, world, 7, BUDGET)
    if (!start.accepted) throw new Error(start.reason)
    const out = hardenLevel(profile, world, start.record, mulberry32(7), { tries: 40, seconds: 20, budget: BUDGET })
    expect(difficultyScore(out.record)).toBeGreaterThanOrEqual(difficultyScore(start.record))
    expect(verifyWorldLevel(profile, out.world, 7, BUDGET).accepted).toBe(true)
  })
})
