import { DifficultyVector } from './difficultyAnalyzer'
import { accept, classifyTier } from './filter'

function vector(overrides: Partial<DifficultyVector> = {}): DifficultyVector {
  return {
    solutionLength: 10, expandedStates: 100, generatedStates: 150, maxQueueSize: 20,
    avgBranching: 2, maxBranching: 3, deadEndRatio: 0.1, criticalDecisions: 1,
    spaceTransitions: 0, nestedBoxUsed: false, nestedBoxRequired: false, maxContainerDepthUsed: 0,
    ...overrides,
  }
}

test('accept passes when every present range is satisfied', () => {
  expect(accept(vector({ solutionLength: 15 }), { solutionLength: { min: 10, max: 20 } })).toBe(true)
})

test('accept fails when a value is below min', () => {
  expect(accept(vector({ solutionLength: 5 }), { solutionLength: { min: 10 } })).toBe(false)
})

test('accept fails when a value is above max', () => {
  expect(accept(vector({ solutionLength: 25 }), { solutionLength: { max: 20 } })).toBe(false)
})

test('accept ignores fields with no range configured', () => {
  expect(accept(vector({ solutionLength: 99999 }), {})).toBe(true)
})

test('accept enforces requireNestedBox', () => {
  expect(accept(vector({ nestedBoxRequired: false }), { requireNestedBox: true })).toBe(false)
  expect(accept(vector({ nestedBoxRequired: true }), { requireNestedBox: true })).toBe(true)
})

test('classifyTier checks hard first, then medium, then easy, then rejects', () => {
  const tiers = {
    hard: { solutionLength: { min: 20 } },
    medium: { solutionLength: { min: 10 } },
    easy: { solutionLength: { min: 0 } },
  }
  expect(classifyTier(vector({ solutionLength: 25 }), tiers)).toBe('hard')
  expect(classifyTier(vector({ solutionLength: 15 }), tiers)).toBe('medium')
  expect(classifyTier(vector({ solutionLength: 5 }), tiers)).toBe('easy')
  expect(classifyTier(vector({ solutionLength: -1 }), tiers)).toBe('reject')
})
