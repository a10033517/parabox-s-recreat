import { checkWin } from '../../src/game/engine/rules'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedWorld } from './seed'

test('the seed world is already solved', () => {
  expect(checkWin(createSeedWorld())).toBe(true)
})

test('the seed world is internally consistent', () => {
  const seed = createSeedWorld()
  expect(() => parseLevel(serializeLevel(seed))).not.toThrow()
})
