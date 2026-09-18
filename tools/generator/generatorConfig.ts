import { RandomGeneratorConfig } from './randomGenerator'
import { DifficultyFilter } from './filter'

export interface GeneratorConfig {
  generator: RandomGeneratorConfig
  maxSolveDepth: number
  maxSolverExpandedStates: number
  tiers: { easy: DifficultyFilter; medium: DifficultyFilter; hard: DifficultyFilter }
  hardCandidatePoolSize: number
  diversityWeight: number
  maxAttempts: number
}

function assertRange(range: [number, number], name: string): void {
  const [min, max] = range
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new Error(`${name} must be a valid [min, max] range with min <= max, got [${min}, ${max}]`)
  }
}

function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a probability in [0, 1], got ${value}`)
  }
}

// Generator ranges come directly from the design brief's own §5 example
// config — a documented starting point, not a tuned final answer (this
// project's own repeated experience: guessed thresholds turn out
// structurally unreachable; real values come from a diagnostic pass — see
// the redesign spec's Rollout section and the implementation plan's
// Task 9).
//
// Tier filters start EMPTY (accept anything solvable) deliberately: with
// all three empty, classifyTier's hard-first priority means every solved
// candidate classifies as 'hard' and easy/medium never fill — this is
// intentional, not a bug. It forces Task 9's diagnostic-tuning pass to run
// before generateBatch.ts can produce a meaningful three-tier split, rather
// than silently shipping guessed numbers.
export const GENERATOR_CONFIG: GeneratorConfig = {
  generator: {
    widthRange: [6, 10],
    heightRange: [6, 10],
    wallDensityRange: [0.15, 0.40],
    boxCountRange: [1, 4],
    containerProbability: 0.3,
    crossBoardGoalProbability: 0.3,
    interiorSizeRange: [3, 5],
    maxNestingDepth: 2,
  },
  maxSolveDepth: 200,
  maxSolverExpandedStates: 20000,
  tiers: {
    easy: {},
    medium: {},
    hard: {},
  },
  hardCandidatePoolSize: 60,
  diversityWeight: 10,
  maxAttempts: 5000,
}

assertRange(GENERATOR_CONFIG.generator.widthRange, 'generator.widthRange')
assertRange(GENERATOR_CONFIG.generator.heightRange, 'generator.heightRange')
assertRange(GENERATOR_CONFIG.generator.wallDensityRange, 'generator.wallDensityRange')
assertRange(GENERATOR_CONFIG.generator.boxCountRange, 'generator.boxCountRange')
assertRange(GENERATOR_CONFIG.generator.interiorSizeRange, 'generator.interiorSizeRange')
assertProbability(GENERATOR_CONFIG.generator.containerProbability, 'generator.containerProbability')
assertProbability(GENERATOR_CONFIG.generator.crossBoardGoalProbability, 'generator.crossBoardGoalProbability')
if (GENERATOR_CONFIG.generator.maxNestingDepth < 0) {
  throw new Error('generator.maxNestingDepth must be >= 0')
}
