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
// Tier thresholds below come from a real diagnostic pass (100 solved
// candidates, Math.random, this generator's own shipped ranges below) —
// NOT guessed. Observed percentiles:
//   solutionLength:    p25=10 p50=13 p75=20 p90=29 max=47
//   criticalDecisions: p25=9  p50=12 p75=18 p90=27 max=46
//   avgBranching:      p25=2.78 p50=2.94 p75=3.11 p90=3.24
//   deadEndRatio:      min=max=0 across all 100 samples — the narrow
//     "immediately-stuck-state" definition (see difficultyAnalyzer.ts's
//     own comment) essentially never fires for this generator's output,
//     so it has zero discriminating power here and is deliberately left
//     out of every tier filter below, rather than included for the sake
//     of using every field — an unused-but-present field would just tie
//     every candidate and do nothing, which is worse than omitting it.
// hard requires BOTH solutionLength and criticalDecisions at/above their
// own p75 (a joint condition, stricter than either alone) so "hard" means
// genuinely more decision points, not merely a longer solve. easy is
// below the solutionLength median's lower quartile; medium is everything
// in between (and anything long-but-not-decision-heavy that hard's joint
// condition excludes).
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
    easy: { solutionLength: { max: 9 } },
    medium: { solutionLength: { min: 10 } },
    hard: { solutionLength: { min: 20 }, criticalDecisions: { min: 18 } },
  },
  // Lowered from 60/5000 after the real generate:levels run made clear
  // those numbers (carried over from the old reverse-walk pipeline without
  // re-checking) don't fit this pipeline's actual per-candidate cost: a
  // hard-tier candidate's analyze() does up to ~3*solutionLength extra
  // bounded solve() calls (criticalDecisions) plus one more full re-solve
  // (nestedBoxRequired) — for solutionLength up to the diagnostic's own
  // observed max of 47, that's a genuinely expensive candidate, and the
  // main loop never early-exits once easy/medium are full (it keeps
  // hunting for the hard pool target right up to maxAttempts regardless).
  // 15 still gives selectDiverseTopN's greedy diversity selection 3x
  // oversupply against the 5 actually shipped per tier, at a fraction of
  // the wall-clock cost.
  hardCandidatePoolSize: 15,
  diversityWeight: 10,
  maxAttempts: 3000,
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
