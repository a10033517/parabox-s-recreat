import { Direction, World, cloneWorld } from '../../src/game/engine/types'
import { inverseEat, inverseEnter, inversePush } from './inverseMoves'
import { canonicalKey } from './canonical'
import { SeedGroup } from './seed'
import { GENERATOR_CONFIG, GeneratorWeights, OSCILLATION_RECENT_WINDOW } from './generatorConfig'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export type GenerationEventKind = 'push' | 'enter' | 'eat'

export interface GenerationEvent {
  kind: GenerationEventKind
  direction: Direction
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

function movedPieceIds(before: World, after: World): string[] {
  const ids: string[] = []
  for (const pieceId of Object.keys(before.locations)) {
    const a = before.locations[pieceId]
    const b = after.locations[pieceId]
    if (a.board !== b.board || a.x !== b.x || a.y !== b.y) ids.push(pieceId)
  }
  return ids
}

// `recentTouches` holds the containerId of every group touched by the last
// OSCILLATION_RECENT_WINDOW accepted events (see generatorConfig.ts's own
// comment on OSCILLATION_RECENT_WINDOW for why this exists): a group
// touched repeatedly within this short lookback gets its per-step weight
// contribution shrunk by `1 / (1 + recentTouchCount)`, discouraging the walk
// from immediately wandering a just-touched group's box back toward its
// seed position — without ever hard-blocking legitimate repeat use of one
// group (the penalty only ever shrinks a positive weight, never zeroes it).
function candidateWeight(
  kind: GenerationEventKind,
  moved: string[],
  groups: SeedGroup[],
  touchCounts: Map<string, number>,
  recentTouches: string[],
  weights: GeneratorWeights,
): number {
  let weight = weights[kind]
  for (const group of groups) {
    if (!moved.includes(group.containerId) && !moved.includes(group.boxId)) continue
    const touches = touchCounts.get(group.containerId) ?? 0
    const recentCount = recentTouches.filter((id) => id === group.containerId).length
    const repeatPenalty = 1 / (1 + recentCount)
    weight += (touches === 0 ? weights.newGroupBonus : weights.repeatedGroupWeight / touches) * repeatPenalty
  }
  return weight
}

function weightedPick<T>(items: { weight: number; value: T }[], rng: () => number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng() * total
  for (const item of items) {
    roll -= item.weight
    if (roll <= 0) return item.value
  }
  return items[items.length - 1].value
}

export function generateLevel(
  seed: World,
  groups: SeedGroup[],
  steps: number,
  rng: () => number,
  weights: GeneratorWeights = GENERATOR_CONFIG.weights,
): GenerationResult | null {
  let world = cloneWorld(seed)
  const events: GenerationEvent[] = []
  const seen = new Set<string>([canonicalKey(world)])
  const touchCounts = new Map<string, number>(groups.map((group) => [group.containerId, 0]))
  const recentTouches: string[] = []
  let attempts = 0
  const maxAttempts = Math.max(steps, 1) * 20

  while (events.length < steps && attempts < maxAttempts) {
    attempts++
    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length) % DIRECTIONS.length]

    const candidates: { kind: GenerationEventKind; world: World; moved: string[] }[] = []
    for (const pattern of PATTERNS) {
      const next = pattern.fn(world, direction)
      if (!next) continue
      if (seen.has(canonicalKey(next))) continue
      candidates.push({ kind: pattern.kind, world: next, moved: movedPieceIds(world, next) })
    }
    if (candidates.length === 0) continue

    const weighted = candidates.map((candidate) => ({
      weight: candidateWeight(candidate.kind, candidate.moved, groups, touchCounts, recentTouches, weights),
      value: candidate,
    }))
    const accepted = weightedPick(weighted, rng)

    for (const group of groups) {
      if (accepted.moved.includes(group.containerId) || accepted.moved.includes(group.boxId)) {
        touchCounts.set(group.containerId, (touchCounts.get(group.containerId) ?? 0) + 1)
        recentTouches.push(group.containerId)
        if (recentTouches.length > OSCILLATION_RECENT_WINDOW) recentTouches.shift()
      }
    }

    world = accepted.world
    seen.add(canonicalKey(world))
    events.push({ kind: accepted.kind, direction })
  }

  if (events.length < steps) return null
  return { world, events }
}
