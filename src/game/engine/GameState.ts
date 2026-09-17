import { World, Direction } from './types'
import { applyMove, checkLose, checkWin } from './rules'

export class GameState {
  private history: World[]

  constructor(initial: World) {
    this.history = [initial]
  }

  get current(): World {
    return this.history[this.history.length - 1]
  }

  get isWon(): boolean {
    return checkWin(this.current)
  }

  get isLost(): boolean {
    return checkLose(this.current)
  }

  get moveCount(): number {
    return this.history.length - 1
  }

  move(dir: Direction): boolean {
    const next = applyMove(this.current, dir)
    if (next === null) return false
    this.history.push(next)
    return true
  }

  undo(): boolean {
    if (this.history.length <= 1) return false
    this.history.pop()
    return true
  }
}
