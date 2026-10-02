import { Direction } from '../engine/types'

// The player's eyes: they look the way the player last moved, and when the player stands still
// they blink now and then and look somewhere else while closed. Pure presentation — time is
// passed in, randomness is injectable — so it can be tested without a clock.

export interface EyeState {
  lookX: number // -1..1, where the pupils sit inside the eye (screen space, before mirroring)
  lookY: number
  open: number // 1 open .. 0 shut
}

const GAZE_EASE_MS = 120 // eyes turning to a new direction
const BLINK_MS = 170
const IDLE_FIRST_MS = 1400 // standing still this long: the first idle blink
const IDLE_EXTRA_MS = 900 // ... plus up to this much at random
const IDLE_GAP_MS = 1800 // between later idle blinks
const IDLE_GAP_EXTRA_MS = 2400

const DIRECTION_VECTORS: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

export class EyeAnimator {
  private from: [number, number] = [0, 0]
  private to: [number, number] = [0, 0]
  private turnedAt = -Infinity
  private nextIdleAt: number
  private blinkAt = -Infinity
  private afterBlink: [number, number] | null = null

  constructor(
    now = 0,
    private readonly random: () => number = Math.random,
  ) {
    this.nextIdleAt = now + IDLE_FIRST_MS + this.random() * IDLE_EXTRA_MS
  }

  // The player moved (or tried to): look that way, and put off the idle blinking.
  look(direction: Direction, now: number): void {
    this.turn(DIRECTION_VECTORS[direction], now)
    this.afterBlink = null
    this.nextIdleAt = now + IDLE_FIRST_MS + this.random() * IDLE_EXTRA_MS
  }

  sample(now: number): EyeState {
    if (now >= this.nextIdleAt) {
      // Idle: blink, and while the eyes are shut pick somewhere new to look (sometimes ahead).
      this.blinkAt = now
      this.afterBlink = this.random() < 0.25 ? [0, 0] : this.randomGaze()
      this.nextIdleAt = now + IDLE_GAP_MS + this.random() * IDLE_GAP_EXTRA_MS
    }
    const blinkT = (now - this.blinkAt) / BLINK_MS
    const open = blinkT >= 0 && blinkT < 1 ? 1 - Math.sin(Math.PI * blinkT) : 1
    if (blinkT >= 0.5 && this.afterBlink !== null) {
      // Shut (or the blink was missed between frames): the eyes jump to the new spot, unseen.
      this.from = this.afterBlink
      this.to = this.afterBlink
      this.turnedAt = -Infinity
      this.afterBlink = null
    }
    const [lookX, lookY] = this.gazeAt(now)
    return { lookX, lookY, open }
  }

  // Where the pupils are at `now` (no idle side effects).
  private gazeAt(now: number): [number, number] {
    const t = Math.min(1, Math.max(0, (now - this.turnedAt) / GAZE_EASE_MS))
    const e = 1 - (1 - t) * (1 - t)
    return [this.from[0] + (this.to[0] - this.from[0]) * e, this.from[1] + (this.to[1] - this.from[1]) * e]
  }

  private turn(to: [number, number], now: number): void {
    this.from = this.gazeAt(now)
    this.to = to
    this.turnedAt = now
  }

  private randomGaze(): [number, number] {
    const angle = this.random() * Math.PI * 2
    const radius = 0.5 + this.random() * 0.5
    return [Math.cos(angle) * radius, Math.sin(angle) * radius]
  }
}
