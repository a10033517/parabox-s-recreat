import { applyMove, checkWin } from './rules'
import { Direction, Grid } from './types'

export interface GameState {
  history: Grid[]
}

export function createGameState(grid: Grid): GameState {
  return { history: [grid] }
}

export function currentGrid(state: GameState): Grid {
  return state.history[state.history.length - 1]
}

export function move(state: GameState, direction: Direction): GameState {
  const next = applyMove(currentGrid(state), direction)
  if (!next) return state
  return { history: [...state.history, next] }
}

export function undo(state: GameState): GameState {
  if (state.history.length <= 1) return state
  return { history: state.history.slice(0, -1) }
}

export function isWon(state: GameState): boolean {
  return checkWin(currentGrid(state))
}
