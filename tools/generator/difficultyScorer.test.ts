import { difficultyTier, scoreDifficulty } from './difficultyScorer'

test('scoreDifficulty weighs nesting events much higher than plain moves', () => {
  const noNesting = scoreDifficulty(10, 0)
  const oneNesting = scoreDifficulty(10, 1)
  expect(oneNesting).toBeGreaterThan(noNesting)
})

test('difficultyTier buckets scores into easy/medium/hard', () => {
  expect(difficultyTier(5)).toBe('easy')
  expect(difficultyTier(15)).toBe('medium')
  expect(difficultyTier(30)).toBe('hard')
})
