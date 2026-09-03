import { describe, it, expect } from 'vitest'
import { BUILTIN_LEVELS, CUSTOM_LEVEL_ID_PREFIX, loadCustomLevels, loadGeneratedLevels } from './index'
import { checkWin } from '../game/engine/rules'
import { PLAYER_ID } from '../game/engine/types'

describe('BUILTIN_LEVELS', () => {
  it('has one entry per shipped level file, each parsing to an unsolved world', () => {
    expect(BUILTIN_LEVELS).toHaveLength(5)
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
    ])
  })
})

describe('loadGeneratedLevels', () => {
  it('returns an empty array (sub-project 4 rebuilds the generator against the new format)', () => {
    expect(loadGeneratedLevels()).toEqual([])
  })
})

describe('loadCustomLevels', () => {
  it('returns an empty array (sub-project 3 rebuilds the editor against the new format)', () => {
    expect(loadCustomLevels()).toEqual([])
  })
})

it('still exports CUSTOM_LEVEL_ID_PREFIX for future use', () => {
  expect(CUSTOM_LEVEL_ID_PREFIX).toBe('custom:')
})
