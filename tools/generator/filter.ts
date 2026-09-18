import { DifficultyVector } from './difficultyAnalyzer'

export interface RangeFilter { min?: number; max?: number }

export interface DifficultyFilter {
  solutionLength?: RangeFilter
  expandedStates?: RangeFilter
  criticalDecisions?: RangeFilter
  deadEndRatio?: RangeFilter
  avgBranching?: RangeFilter
  requireNestedBox?: boolean
}

export type Tier = 'easy' | 'medium' | 'hard'

function inRange(value: number, range?: RangeFilter): boolean {
  if (range === undefined) return true
  if (range.min !== undefined && value < range.min) return false
  if (range.max !== undefined && value > range.max) return false
  return true
}

// Direct port of the design brief's own §20 accept() — every present
// range is a hard requirement, absent ranges are unconstrained.
export function accept(vector: DifficultyVector, filter: DifficultyFilter): boolean {
  if (!inRange(vector.solutionLength, filter.solutionLength)) return false
  if (!inRange(vector.expandedStates, filter.expandedStates)) return false
  if (!inRange(vector.criticalDecisions, filter.criticalDecisions)) return false
  if (!inRange(vector.deadEndRatio, filter.deadEndRatio)) return false
  if (!inRange(vector.avgBranching, filter.avgBranching)) return false
  if (filter.requireNestedBox === true && !vector.nestedBoxRequired) return false
  return true
}

// Checks the most exclusive preset first (hard, then medium, then easy) so
// a candidate satisfying more than one preset's ranges is classified by
// the strictest one it clears, matching the old scorer's own "check hard
// requirements first" priority (see the design spec §8).
export function classifyTier(
  vector: DifficultyVector,
  tiers: { easy: DifficultyFilter; medium: DifficultyFilter; hard: DifficultyFilter },
): Tier | 'reject' {
  if (accept(vector, tiers.hard)) return 'hard'
  if (accept(vector, tiers.medium)) return 'medium'
  if (accept(vector, tiers.easy)) return 'easy'
  return 'reject'
}
