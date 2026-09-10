import { DifficultyMetrics, checkHardRequirements, difficultyTier, scoreDifficulty } from './difficultyScorer'

function baseMetrics(overrides: Partial<DifficultyMetrics> = {}): DifficultyMetrics {
  return {
    moveCount: 10,
    crossingMoveCount: 0,
    eatCount: 0,
    survivingGroupCount: 0,
    groupsUsed: 0,
    expandedStates: 0,
    maxFrontierSize: 0,
    ...overrides,
  }
}

test('scoreDifficulty weighs each metric as an independent additive contribution', () => {
  const base = scoreDifficulty(baseMetrics())
  expect(scoreDifficulty(baseMetrics({ eatCount: 1 }))).toBeGreaterThan(base)
  expect(scoreDifficulty(baseMetrics({ survivingGroupCount: 1 }))).toBeGreaterThan(base)
  expect(scoreDifficulty(baseMetrics({ groupsUsed: 1 }))).toBeGreaterThan(base)
  expect(scoreDifficulty(baseMetrics({ crossingMoveCount: 1 }))).toBeGreaterThan(base)
  expect(scoreDifficulty(baseMetrics({ expandedStates: 100 }))).toBeGreaterThan(base)
})

test('checkHardRequirements reports exactly which requirement a near-miss candidate failed', () => {
  // Clears minScore and minEatCount but misses minSurvivingGroupCount.
  const metrics = baseMetrics({
    moveCount: 25,
    eatCount: 3,
    survivingGroupCount: 1, // hard.minSurvivingGroupCount is 2
    groupsUsed: 2,
  })
  const check = checkHardRequirements(metrics)
  expect(check.isHard).toBe(false)
  expect(check.meetsMinSurvivingGroupCount).toBe(false)
  expect(check.meetsMinMoveCount).toBe(true)
  expect(check.meetsMinEatCount).toBe(true)
  expect(check.meetsMinGroupsUsed).toBe(true)
  expect(check.meetsMinScore).toBe(true)
})

test('checkHardRequirements.isHard is true only when every requirement is met', () => {
  const metrics = baseMetrics({ moveCount: 25, eatCount: 3, survivingGroupCount: 2, groupsUsed: 2 })
  expect(checkHardRequirements(metrics).isHard).toBe(true)
})

test('difficultyTier never returns hard unless every hard requirement is met', () => {
  const nearMiss = baseMetrics({ moveCount: 25, eatCount: 3, survivingGroupCount: 1, groupsUsed: 2 })
  expect(checkHardRequirements(nearMiss).isHard).toBe(false)
  expect(difficultyTier(nearMiss)).not.toBe('hard')
})

test('difficultyTier falls to medium, not easy, on a near-miss with a high score', () => {
  const nearMiss = baseMetrics({ moveCount: 25, eatCount: 3, survivingGroupCount: 1, groupsUsed: 2 })
  expect(scoreDifficulty(nearMiss)).toBeGreaterThanOrEqual(45)
  expect(difficultyTier(nearMiss)).toBe('medium')
})

test('difficultyTier returns easy for a low, non-hard score', () => {
  expect(difficultyTier(baseMetrics({ moveCount: 2 }))).toBe('easy')
})

test('difficultyTier returns hard when every requirement clears', () => {
  const metrics = baseMetrics({ moveCount: 25, eatCount: 3, survivingGroupCount: 2, groupsUsed: 2 })
  expect(difficultyTier(metrics)).toBe('hard')
})
