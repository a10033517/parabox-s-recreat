const NESTING_WEIGHT = 5

export function scoreDifficulty(moveCount: number, nestingCount: number): number {
  return moveCount + nestingCount * NESTING_WEIGHT
}

export function difficultyTier(score: number): 'easy' | 'medium' | 'hard' {
  if (score < 10) return 'easy'
  if (score < 25) return 'medium'
  return 'hard'
}
