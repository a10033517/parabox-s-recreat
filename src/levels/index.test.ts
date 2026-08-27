import { BUILTIN_LEVELS, loadGeneratedLevels } from './index'
import { checkWin } from '../game/engine/rules'

test('every builtin level parses and starts unsolved', () => {
  expect(BUILTIN_LEVELS).toHaveLength(3)
  for (const level of BUILTIN_LEVELS) {
    expect(level.grid.player).toBeDefined()
    expect(checkWin(level.grid)).toBe(false)
  }
})

test('every generated level starts unsolved', () => {
  const levels = loadGeneratedLevels()
  expect(levels.length).toBeGreaterThan(0)
  for (const level of levels) {
    expect(level.grid.player).toBeDefined()
    expect(checkWin(level.grid)).toBe(false)
  }
})
