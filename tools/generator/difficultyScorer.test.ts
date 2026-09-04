import { difficultyTier, scoreDifficulty } from './difficultyScorer'

test('scoreDifficulty weighs crossing moves much higher than plain moves', () => {
  const noCrossing = scoreDifficulty(10, 0)
  const oneCrossing = scoreDifficulty(10, 1)
  expect(oneCrossing).toBeGreaterThan(noCrossing)
})

test('difficultyTier buckets scores into easy/medium/hard', () => {
  expect(difficultyTier(5)).toBe('easy')
  expect(difficultyTier(15)).toBe('medium')
  expect(difficultyTier(30)).toBe('hard')
})
