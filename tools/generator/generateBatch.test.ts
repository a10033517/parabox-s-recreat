import { checkWin } from '../../src/game/engine/rules'
import { parseLevel } from '../../src/game/engine/levelSchema'
import { canonicalKey } from './canonical'
import { World } from '../../src/game/engine/types'
import { DifficultyVector } from './difficultyAnalyzer'
import { GeneratorConfig } from './generatorConfig'
import {
  HardCandidate, generateLevelBatch, profileDistance, selectDiverseTopN,
} from './generateBatch'

function seededRng(startSeed: number): () => number {
  let s = startSeed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s % 10000) / 10000
  }
}

// A generous, unrestricted test config: the shipped GENERATOR_CONFIG's
// tiers start empty on purpose (see generatorConfig.ts's own comment) —
// that already means "accept anything, classify as hard" by default, so
// these tests use their own small/fast generator ranges rather than the
// shipped wider ranges, to keep the test suite fast.
function testConfig(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    generator: {
      widthRange: [6, 6], heightRange: [6, 6], wallDensityRange: [0.15, 0.3],
      boxCountRange: [1, 2], containerProbability: 0.2, crossBoardGoalProbability: 0.2,
      interiorSizeRange: [3, 3], maxNestingDepth: 1,
    },
    maxSolveDepth: 100,
    maxSolverExpandedStates: 20000,
    tiers: { easy: {}, medium: {}, hard: {} },
    hardCandidatePoolSize: 10,
    diversityWeight: 10,
    maxAttempts: 500,
    ...overrides,
  }
}

test('generateLevelBatch reports whether it actually met its tier quotas', () => {
  const result = generateLevelBatch(1, seededRng(42), 500, testConfig())
  if (result.complete) {
    expect(result.counts.easy).toBeGreaterThanOrEqual(1)
    expect(result.counts.medium).toBeGreaterThanOrEqual(1)
    expect(result.counts.hard).toBeGreaterThanOrEqual(1)
  } else {
    expect(result.counts.easy < 1 || result.counts.medium < 1 || result.counts.hard < 1).toBe(true)
  }
})

test('every accepted level is unsolved and parses back through parseLevel', () => {
  // Empty tiers mean everything solvable classifies as 'hard' — force at
  // least one hard slot to be reachable within a small pool.
  const result = generateLevelBatch(1, seededRng(1), 500, testConfig({ hardCandidatePoolSize: 3 }))
  expect(result.levels.length).toBeGreaterThan(0)
  for (const entry of result.levels) {
    const parsed = parseLevel(JSON.parse(entry.json))
    expect(checkWin(parsed)).toBe(false)
  }
})

test('no two accepted levels in one batch share a canonical state', () => {
  const result = generateLevelBatch(2, seededRng(7), 500, testConfig({ hardCandidatePoolSize: 5 }))
  const keys = result.levels.map((entry) => canonicalKey(entry.world))
  expect(new Set(keys).size).toBe(keys.length)
})

test('batch stats account for every attempt', () => {
  const result = generateLevelBatch(1, seededRng(99), 300, testConfig())
  const accountedFor =
    result.stats.discardedGenerationFailed +
    result.stats.discardedInvalid +
    result.stats.discardedAlreadySolved +
    result.stats.discardedUnsolvable +
    result.stats.discardedDuplicate +
    result.stats.discardedTierFull +
    result.stats.discardedTierReject +
    result.levels.length
  // Hard candidates that are found but NOT selected into the final
  // levels list are counted neither in `levels.length` nor in any
  // discarded-* bucket at attempt time (they're pool members, resolved
  // only at the very end by selectDiverseTopN) — account for them too.
  const unselectedHardCandidates = result.hardCandidatesFound - result.counts.hard
  expect(accountedFor + unselectedHardCandidates).toBe(result.stats.attempts)
})

test('hardCandidatesFound reflects the pool size independent of how many were finally selected', () => {
  const result = generateLevelBatch(1, seededRng(11), 500, testConfig({ hardCandidatePoolSize: 8 }))
  expect(result.hardCandidatesFound).toBeLessThanOrEqual(8)
  expect(result.counts.hard).toBeLessThanOrEqual(result.hardCandidatesFound)
})

function makeVector(overrides: Partial<DifficultyVector> = {}): DifficultyVector {
  return {
    solutionLength: 10, expandedStates: 100, generatedStates: 150, maxQueueSize: 20,
    avgBranching: 2, maxBranching: 3, deadEndRatio: 0.1, criticalDecisions: 1,
    spaceTransitions: 0, nestedBoxUsed: false, nestedBoxRequired: false, maxContainerDepthUsed: 0,
    ...overrides,
  }
}

function makeCandidate(vector: Partial<DifficultyVector>, score: number): HardCandidate {
  return { world: {} as World, json: '{}', vector: makeVector(vector), score }
}

test('profileDistance is 0 for identical vectors and grows with any difference', () => {
  const a = makeVector()
  expect(profileDistance(a, a)).toBe(0)
  const b = makeVector({ solutionLength: 30 })
  expect(profileDistance(a, b)).toBeGreaterThan(0)
})

test('selectDiverseTopN prefers a lower-score-but-distinct candidate over a near-duplicate of a higher one', () => {
  const highA = makeCandidate({ solutionLength: 30, criticalDecisions: 3 }, 50)
  const highB = makeCandidate({ solutionLength: 31, criticalDecisions: 3 }, 49) // near-duplicate of highA
  const distinct = makeCandidate({ solutionLength: 15, criticalDecisions: 0, avgBranching: 4 }, 40)
  const selected = selectDiverseTopN([highA, highB, distinct], 2)
  expect(selected).toHaveLength(2)
  expect(selected).toContain(highA)
  expect(selected).toContain(distinct)
})

test('selectDiverseTopN returns fewer than N if fewer candidates are available', () => {
  const only = makeCandidate({}, 10)
  expect(selectDiverseTopN([only], 5)).toHaveLength(1)
})
