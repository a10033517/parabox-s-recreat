import { GENERATOR_CONFIG } from './generatorConfig'

export interface DifficultyMetrics {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  survivingGroupCount: number
  groupsUsed: number
  expandedStates: number
  maxFrontierSize: number
  // Same-board box-push moves (solver.ts's countPushMoves) — added per user
  // feedback that generated levels all felt mechanically identical (walk +
  // eat, nothing else varied): this is the previously-unmeasured Sokoban
  // dimension. Deliberately NOT added to checkHardRequirements below — this
  // session's own experience is that every new hard-tier structural
  // minimum makes the pool sharply harder to fill, so this only influences
  // scoreDifficulty/ranking, not pass/fail.
  pushMoveCount: number
}

export function scoreDifficulty(metrics: DifficultyMetrics): number {
  const { scoring } = GENERATOR_CONFIG
  return (
    metrics.moveCount +
    metrics.eatCount * scoring.eatWeight +
    metrics.survivingGroupCount * scoring.survivingGroupWeight +
    metrics.groupsUsed * scoring.groupsUsedWeight +
    metrics.crossingMoveCount * scoring.crossingMoveWeight +
    metrics.pushMoveCount * scoring.pushMoveWeight +
    Math.log2(metrics.expandedStates + 1) * scoring.expandedStatesLogWeight
  )
}

export interface HardRequirementCheck {
  isHard: boolean
  meetsMinMoveCount: boolean
  meetsMinEatCount: boolean
  meetsMinSurvivingGroupCount: boolean
  meetsMinGroupsUsed: boolean
  meetsMinScore: boolean
}

export function checkHardRequirements(metrics: DifficultyMetrics): HardRequirementCheck {
  const { hard } = GENERATOR_CONFIG
  const meetsMinMoveCount = metrics.moveCount >= hard.minMoveCount
  const meetsMinEatCount = metrics.eatCount >= hard.minEatCount
  const meetsMinSurvivingGroupCount = metrics.survivingGroupCount >= hard.minSurvivingGroupCount
  const meetsMinGroupsUsed = metrics.groupsUsed >= hard.minGroupsUsed
  const meetsMinScore = scoreDifficulty(metrics) >= hard.minScore
  return {
    isHard:
      meetsMinMoveCount && meetsMinEatCount && meetsMinSurvivingGroupCount &&
      meetsMinGroupsUsed && meetsMinScore,
    meetsMinMoveCount,
    meetsMinEatCount,
    meetsMinSurvivingGroupCount,
    meetsMinGroupsUsed,
    meetsMinScore,
  }
}

// The easy/medium score threshold was retuned from the spec's initial value
// of 10 during the mandatory diagnostic pass (§12): under Approach A, every
// solvable candidate has at least one surviving group and one eat move by
// construction (§4.7), and those two contributions alone
// (survivingGroupWeight*1 + eatWeight*1 = 8 + 6 = 14) plus the unavoidable
// groupsUsedWeight/crossingMoveWeight/moveCount/log2(expandedStates) terms
// push every real solved candidate's score into the 40s-70s range — the old
// threshold of 10 made 'easy' structurally unreachable (confirmed: 0/64 and
// 0/19 solved candidates were 'easy' across two diagnostic samples), which
// in turn meant generateBatch.ts's easy-and-medium-both-full trigger for
// switching to the hard-biased seed profile (§6.4) never fired. 45 splits
// the observed solved-candidate score distribution roughly at its median.
const EASY_MEDIUM_SCORE_THRESHOLD = 45

export function difficultyTier(metrics: DifficultyMetrics): 'easy' | 'medium' | 'hard' {
  if (checkHardRequirements(metrics).isHard) return 'hard'
  return scoreDifficulty(metrics) < EASY_MEDIUM_SCORE_THRESHOLD ? 'easy' : 'medium'
}
