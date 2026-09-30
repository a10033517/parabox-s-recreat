import { EngineEvent } from '../engine/events'
import { PieceId, World } from '../engine/types'

// Presentation-only ε lifecycle. The engine decides that an ε exists (World state) and that a
// move CREATED one (SpawnEpsilonEvent.created); this module only turns those facts into a
// visual state and a scale. It holds no gameplay truth: drop it and the game is unchanged.
export type EpsilonVisualState = 'Spawn' | 'Active' | 'Remove'

// Spawn keyframes (progress 0..1 -> scale): hidden, then 0.2 -> 0.6 -> 1.0, per the spec's
// "scale 0 -> 0.2 -> 0.6 -> 1.0". The first stretch stays at 0 so the ε appears AFTER the
// camera/world swap instead of popping in mid-fade.
const KEYFRAMES: Array<[number, number]> = [
  [0, 0],
  [0.15, 0],
  [0.4, 0.2],
  [0.7, 0.6],
  [1, 1],
]

export function epsilonSpawnScale(progress: number): number {
  if (!(progress > 0)) return 0
  if (progress >= 1) return 1
  for (let i = 1; i < KEYFRAMES.length; i++) {
    const [t1, s1] = KEYFRAMES[i]
    const [t0, s0] = KEYFRAMES[i - 1]
    if (progress <= t1) return s0 + ((s1 - s0) * (progress - t0)) / (t1 - t0)
  }
  return 1
}

// Which ε visuals this move changes. Created -> Spawn (plays once, for exactly the ε the
// event names); an ε that was in the previous world and is gone now -> Remove (undo). Every
// other ε is simply Active. Pure: no timers, no state.
export function classifyEpsilonVisuals(
  preWorld: World,
  postWorld: World,
  events: readonly EngineEvent[],
): Map<PieceId, EpsilonVisualState> {
  const result = new Map<PieceId, EpsilonVisualState>()
  const epsilons = (w: World) => Object.values(w.pieces).filter((p) => p.epsilonFor !== undefined).map((p) => p.id)
  for (const id of epsilons(postWorld)) result.set(id, 'Active')
  for (const id of epsilons(preWorld)) if (postWorld.pieces[id] === undefined) result.set(id, 'Remove')
  for (const event of events) {
    if (event.type === 'SpawnEpsilonEvent' && event.created && postWorld.pieces[event.destinationId] !== undefined) {
      result.set(event.destinationId, 'Spawn')
    }
  }
  return result
}
