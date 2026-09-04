const BOARD_CROSSING_WEIGHT = 5

export function scoreDifficulty(moveCount: number, crossingMoveCount: number): number {
  return moveCount + crossingMoveCount * BOARD_CROSSING_WEIGHT
}

export function difficultyTier(score: number): 'easy' | 'medium' | 'hard' {
  if (score < 10) return 'easy'
  if (score < 25) return 'medium'
  return 'hard'
}
