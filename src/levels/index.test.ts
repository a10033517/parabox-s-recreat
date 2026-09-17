import { describe, it, expect } from 'vitest'
import { BUILTIN_LEVELS, CUSTOM_LEVEL_ID_PREFIX, loadCustomLevels, loadGeneratedLevels, parseGeneratedModules } from './index'
import { checkWin } from '../game/engine/rules'
import { PLAYER_ID } from '../game/engine/types'
import { solve } from '../../tools/generator/solver'

describe('BUILTIN_LEVELS', () => {
  it('has one entry per shipped level file, each parsing to an unsolved world', () => {
    expect(BUILTIN_LEVELS).toHaveLength(8)
    for (const level of BUILTIN_LEVELS) {
      expect(level.world.locations[PLAYER_ID]).toBeDefined()
      expect(checkWin(level.world)).toBe(false)
    }
  })

  it('includes the expected level ids in order', () => {
    expect(BUILTIN_LEVELS.map((l) => l.id)).toEqual([
      '01-first-push',
      '02-enter-container',
      '03-chain-push',
      '04-eat',
      '05-double-nested',
      '06-self-loop',
      '07-loop-eats-container',
      '08-nested-loop',
    ])
  })
})

describe('parseGeneratedModules', () => {
  it('returns an empty array for an empty module map', () => {
    expect(parseGeneratedModules({})).toEqual([])
  })

  it('parses a raw JSON module into a LevelMeta with an id derived from its filename', () => {
    const raw = JSON.stringify({
      boards: {
        root: {
          id: 'root',
          size: 3,
          cells: [
            [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
            [{ type: 'floor' }, { type: 'floor' }, { type: 'floor', requirement: 'box' }],
            [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
          ],
        },
      },
      pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
      locations: { player: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 1, y: 1 } },
    })
    const levels = parseGeneratedModules({ './builtin/generated/easy-01.json': raw })
    expect(levels).toHaveLength(1)
    expect(levels[0].id).toBe('easy-01')
    expect(levels[0].name).toBe('easy-01')
    expect(checkWin(levels[0].world)).toBe(false)
  })

  it('derives distinct ids for distinct filenames', () => {
    const raw = JSON.stringify({
      boards: { root: { id: 'root', size: 1, cells: [[{ type: 'floor' }]] } },
      pieces: { player: { id: 'player', kind: 'player' } },
      locations: { player: { board: 'root', x: 0, y: 0 } },
    })
    const levels = parseGeneratedModules({
      './builtin/generated/easy-01.json': raw,
      './builtin/generated/hard-01.json': raw,
    })
    expect(levels.map((l) => l.id).sort()).toEqual(['easy-01', 'hard-01'])
  })
})

describe('loadGeneratedLevels', () => {
  it('loads the committed generated levels, each unsolved with unique ids', () => {
    const levels = loadGeneratedLevels()
    expect(levels.length).toBeGreaterThan(0)
    for (const level of levels) {
      expect(checkWin(level.world)).toBe(false)
    }
    expect(new Set(levels.map((l) => l.id)).size).toBe(levels.length)
  })

  it('every generated level is solvable', () => {
    for (const level of loadGeneratedLevels()) {
      const solution = solve(level.world, 150)
      expect(solution, `level ${level.id} should be solvable`).not.toBeNull()
    }
  })
})

describe('loadCustomLevels', () => {
  it('parses saved custom levels, prefixing the id and keeping the saved name', async () => {
    localStorage.clear()
    const { saveCustomLevel } = await import('../storage/progress')
    const json = JSON.stringify({
      boards: { root: { id: 'root', size: 2, cells: [[{ type: 'floor' }, { type: 'floor', requirement: 'box' }], [{ type: 'floor' }, { type: 'floor' }]] } },
      pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
      locations: { player: { board: 'root', x: 0, y: 0 }, box1: { board: 'root', x: 0, y: 1 } },
    })
    saveCustomLevel('my-level', json)

    const levels = loadCustomLevels()
    expect(levels).toHaveLength(1)
    expect(levels[0].id).toBe(`${CUSTOM_LEVEL_ID_PREFIX}my-level`)
    expect(levels[0].name).toBe('my-level')
    expect(checkWin(levels[0].world)).toBe(false)
  })

  it('skips a corrupt saved level instead of throwing', async () => {
    localStorage.clear()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { saveCustomLevel } = await import('../storage/progress')
    saveCustomLevel('broken', 'not valid json')
    expect(loadCustomLevels()).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('returns an empty array when nothing has been saved', () => {
    localStorage.clear()
    expect(loadCustomLevels()).toEqual([])
  })
})

it('still exports CUSTOM_LEVEL_ID_PREFIX for future use', () => {
  expect(CUSTOM_LEVEL_ID_PREFIX).toBe('custom:')
})
