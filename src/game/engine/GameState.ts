import { World, Direction } from './types'
import { applyMove, checkWin } from './rules'
import { EngineEvent, withEngineContext } from './events'

export class GameState {
  private history: World[]
  // Events emitted by the most recent successful move (one-shot facts for the renderer);
  // cleared by undo. Not part of World state.
  lastEvents: EngineEvent[] = []

  constructor(initial: World) {
    this.history = [initial]
  }

  get current(): World {
    return this.history[this.history.length - 1]
  }

  get isWon(): boolean {
    return checkWin(this.current)
  }

  get moveCount(): number {
    return this.history.length - 1
  }

  move(dir: Direction): boolean {
    const events: EngineEvent[] = []
    const next = withEngineContext({ events }, () => applyMove(this.current, dir))
    if (next === null) return false
    this.lastEvents = events
    this.history.push(next)
    return true
  }

  // Back to the level's starting position (clears the undo history).
  restart(): boolean {
    if (this.history.length <= 1) return false
    this.history = [this.history[0]]
    this.lastEvents = []
    return true
  }

  undo(): boolean {
    if (this.history.length <= 1) return false
    this.history.pop()
    this.lastEvents = []
    return true
  }
}
