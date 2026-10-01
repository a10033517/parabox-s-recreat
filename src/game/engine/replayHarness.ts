import { applyMove } from './rules'
import { Direction, Location, PieceId, World } from './types'

// Differential-test harness: replays an input sequence against a World and records
// the logical state after every input. The same JSON shape is what an original-game
// capture must produce, so a recorded original run can be compared field by field
// (player location, every piece's location, blocked/accepted) — never screenshots.
export type Input = 'U' | 'D' | 'L' | 'R'

const DIRECTION: Record<Input, Direction> = { U: 'up', D: 'down', L: 'left', R: 'right' }

export interface Snapshot {
  input: Input
  accepted: boolean // false = the move was blocked and the world is unchanged
  locations: Record<PieceId, Location>
}

export function replay(initial: World, inputs: Input[]): Snapshot[] {
  const snapshots: Snapshot[] = []
  let current = initial
  for (const input of inputs) {
    const next = applyMove(current, DIRECTION[input])
    if (next !== null) current = next
    snapshots.push({ input, accepted: next !== null, locations: structuredClone(current.locations) })
  }
  return snapshots
}

export function finalWorld(initial: World, inputs: Input[]): World {
  let current = initial
  for (const input of inputs) {
    const next = applyMove(current, DIRECTION[input])
    if (next !== null) current = next
  }
  return current
}
