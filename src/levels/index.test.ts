import { BUILTIN_LEVELS } from './index'
import { checkWin } from '../game/engine/rules'

test('every builtin level parses and starts unsolved', () => {
  expect(BUILTIN_LEVELS).toHaveLength(3)
  for (const level of BUILTIN_LEVELS) {
    expect(level.grid.player).toBeDefined()
    expect(checkWin(level.grid)).toBe(false)
  }
})
