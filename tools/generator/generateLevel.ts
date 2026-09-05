import { Direction, World, cloneWorld } from '../../src/game/engine/types'
import { inverseEat, inverseEnter, inversePush } from './inverseMoves'
import { canonicalKey } from './canonical'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export type GenerationEventKind = 'push' | 'enter' | 'eat'

export interface GenerationEvent {
  kind: GenerationEventKind
  direction: Direction
  affectedPieceIds: string[]
}

export interface GenerationResult {
  world: World
  events: GenerationEvent[]
}

const PATTERNS: { kind: GenerationEventKind; fn: (world: World, dir: Direction) => World | null }[] = [
  { kind: 'push', fn: inversePush },
  { kind: 'enter', fn: inverseEnter },
  { kind: 'eat', fn: inverseEat },
]

function shuffled<T>(items: T[], rng: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function affectedPieceIds(before: World, after: World): string[] {
  const ids: string[] = []
  for (const pieceId of Object.keys(before.locations)) {
    const a = before.locations[pieceId]
    const b = after.locations[pieceId]
    if (a.board !== b.board || a.x !== b.x || a.y !== b.y) ids.push(pieceId)
  }
  return ids
}

export function generateLevel(seed: World, steps: number, rng: () => number): GenerationResult | null {
  let world = cloneWorld(seed)
  const events: GenerationEvent[] = []
  const seen = new Set<string>([canonicalKey(world)])
  let attempts = 0
  const maxAttempts = Math.max(steps, 1) * 20

  while (events.length < steps && attempts < maxAttempts) {
    attempts++
    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length) % DIRECTIONS.length]

    let accepted: { kind: GenerationEventKind; world: World } | null = null
    for (const pattern of shuffled(PATTERNS, rng)) {
      const next = pattern.fn(world, direction)
      if (!next) continue
      const key = canonicalKey(next)
      if (seen.has(key)) continue
      accepted = { kind: pattern.kind, world: next }
      break
    }
    if (!accepted) continue

    const affected = affectedPieceIds(world, accepted.world)
    world = accepted.world
    seen.add(canonicalKey(world))
    events.push({ kind: accepted.kind, direction, affectedPieceIds: affected })
  }

  if (events.length < steps) return null
  return { world, events }
}
