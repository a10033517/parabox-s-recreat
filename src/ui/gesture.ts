import { Direction } from '../game/engine/types'

// Turns one finger's movement into moves. Pure (no DOM, no timers) so every mode is testable;
// SwipeLayer feeds it pointer positions and handles hold-to-repeat timing.

export interface GestureConfig {
  threshold: number // pixels the finger must travel for a step
  trigger: 'move' | 'release'
  dragSteps: boolean // 'move' trigger: keep stepping as the finger keeps travelling
}

// With drag steps on, each step after the first needs this many thresholds more travel — so an
// ordinary swipe, which overshoots the threshold a lot, is still one step.
export const DRAG_STEP_FACTOR = 3

export function dominantDirection(dx: number, dy: number): Direction {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

export class SwipeTracker {
  private start: { x: number; y: number } | null = null
  private anchor: { x: number; y: number } | null = null
  private stepped = false

  constructor(private config: GestureConfig) {}

  get active(): boolean {
    return this.start !== null
  }

  get hasStepped(): boolean {
    return this.stepped
  }

  begin(x: number, y: number): void {
    this.start = { x, y }
    this.anchor = { x, y }
    this.stepped = false
  }

  // Steps to take now that the finger is at (x, y).
  move(x: number, y: number): Direction[] {
    if (this.anchor === null || this.config.trigger !== 'move') return []
    if (this.stepped && !this.config.dragSteps) return []
    const dx = x - this.anchor.x
    const dy = y - this.anchor.y
    const needed = this.stepped ? this.config.threshold * DRAG_STEP_FACTOR : this.config.threshold
    if (Math.max(Math.abs(dx), Math.abs(dy)) < needed) return []
    // One step per event at most: a fast flick that jumps far in one event is still one step.
    // The next step is measured from where the finger is now.
    this.stepped = true
    this.anchor = { x, y }
    return [dominantDirection(dx, dy)]
  }

  // The finger lifted at (x, y): a step for the 'release' trigger, or 'tap' when it barely moved.
  end(x: number, y: number): Direction | 'tap' | null {
    if (this.start === null) return null
    const dx = x - this.start.x
    const dy = y - this.start.y
    const stepped = this.stepped
    this.start = null
    this.anchor = null
    this.stepped = false
    if (Math.max(Math.abs(dx), Math.abs(dy)) < this.config.threshold) return stepped ? null : 'tap'
    // 'release' steps now; 'move' already stepped while moving — unless the flick was so fast
    // that no move event arrived before the finger lifted, which still counts as one swipe.
    if (this.config.trigger === 'release' || !stepped) return dominantDirection(dx, dy)
    return null
  }

  cancel(): void {
    this.start = null
    this.anchor = null
    this.stepped = false
  }
}

// Tap-to-move: the side of the area (split along its diagonals) the tap landed on.
export function tapDirection(x: number, y: number, rect: { left: number; top: number; width: number; height: number }): Direction {
  const dx = (x - (rect.left + rect.width / 2)) / (rect.width / 2)
  const dy = (y - (rect.top + rect.height / 2)) / (rect.height / 2)
  return dominantDirection(dx, dy)
}
