import { LevelRecord } from './verify'

// Difficulty: solution length, plus how big a search the solver needed (a wide, branching
// puzzle is harder than a long corridor of the same length).
export function difficultyScore(record: LevelRecord): number {
  return solveScore(record.solver.solutionLength, record.solver.expandedStates)
}

export function solveScore(solutionLength: number, expandedStates: number): number {
  return solutionLength + 3 * Math.log2(expandedStates + 1)
}
