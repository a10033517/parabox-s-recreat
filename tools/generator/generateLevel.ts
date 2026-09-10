import { Direction, PLAYER_ID, World, cloneWorld, step } from '../../src/game/engine/types'
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
  // A 'push' candidate where nothing but the player moved is just plain
  // walking — the cheapest, always-available candidate at almost every
  // step, so without this bonus the walk defaults to it constantly and
  // generated levels end up mechanically identical (walk + eat, nothing
  // else). Rewarding a push that actually displaces a real piece pushes
  // generation toward genuine Sokoban-style box manipulation instead.
  if (kind === 'push' && moved.length > 1) weight += weights.boxPushBonus
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

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

// Diagnostics (see the full design spec's §12, and the follow-up session
// that added this) found survivingGroupCount rarely exceeded 2 even under
// the hard-biased seed profile: direction was previously drawn uniformly at
// random every step, uninformed by where any other group actually sits, so
// a walk on the 12x12 root board rarely diffused far enough within budget
// to reach a second group's isolated 5x5 slot at all. This gives a
// direction extra weight (`1 + groupSeekBias`, never a hard requirement —
// every direction stays reachable) when it strictly reduces the player's
// Manhattan distance to the nearest still-untouched group's root position.
// Once every group has been touched at least once, `targets` is empty and
// this returns to pure uniform weighting — this only shortens the "travel"
// phase toward a first contact, it never influences what happens once
// there (that's still candidateWeight's job).
//
// Exported as a pure function (no rng) specifically so it's unit-testable
// without needing to drive weightedPick's random draw.
export function directionSeekWeights(
  playerPos: { x: number; y: number },
  targets: { x: number; y: number }[],
  groupSeekBias: number,
): { direction: Direction; weight: number }[] {
  if (targets.length === 0) {
    return DIRECTIONS.map((direction) => ({ direction, weight: 1 }))
  }
  const distanceFrom = (p: { x: number; y: number }) => Math.min(...targets.map((t) => manhattan(p, t)))
  const baseline = distanceFrom(playerPos)
  return DIRECTIONS.map((direction) => {
    const next = step(playerPos.x, playerPos.y, direction)
    const improves = distanceFrom(next) < baseline
    return { direction, weight: improves ? 1 + groupSeekBias : 1 }
  })
}

function untouchedGroupPositions(
  groups: SeedGroup[],
  touchCounts: Map<string, number>,
): { x: number; y: number }[] {
  return groups
    .filter((group) => (touchCounts.get(group.containerId) ?? 0) === 0)
    .map((group) => group.originalPosition)
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
    // Direction bias only applies on 'root' — inside an interior there is
    // no other group to seek, so uniform weighting (targets: []) applies.
    const playerLoc = world.locations[PLAYER_ID]
    const targets = playerLoc.board === 'root' ? untouchedGroupPositions(groups, touchCounts) : []
    const directionWeights = directionSeekWeights(playerLoc, targets, weights.groupSeekBias)
    const direction = weightedPick(
      directionWeights.map((d) => ({ weight: d.weight, value: d.direction })),
      rng,
    )

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
