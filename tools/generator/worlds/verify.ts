import { applyMove } from '../../../src/game/engine/rules'
import { EngineEvent, Mechanic, withEngineContext } from '../../../src/game/engine/events'
import { parseLevel, serializeLevel } from '../../../src/game/engine/levelSchema'
import { Direction, World } from '../../../src/game/engine/types'
import { solveDetailed } from '../solver'

// One World's rules for "this level is a <World> puzzle": the mechanic must be PRESENT in the
// structure, USED by the optimal solution, and NECESSARY — with the mechanic removed, the level
// is proven unsolvable (docs: parabox_level_generator_world_profiles.md §2, §10, §15).

export interface Ablation {
  world: World // the level with the mechanic removed (a structural change), or unchanged
  disabled?: Mechanic[] // and / or engine rules switched off
}

export interface WorldProfile {
  id: string
  order: number // position in the official world progression
  name: string // shown in the app
  signature: string // the signature mechanic (doc §14)
  generate: (rng: () => number) => World | null
  // Level 1 — the structure contains the mechanic.
  presence: (world: World) => boolean
  // Level 2 — the optimal solution really triggers it (events of each solution move).
  usage: (events: EngineEvent[][], world: World) => boolean
  // Level 3 — how to take the mechanic away. Every returned variant must be unsolvable.
  ablations: (world: World) => Ablation[]
  minSolutionLength: number
}

export interface SolverBudget {
  maxDepth: number
  maxExpanded: number // for solving the level itself
  maxAblationExpanded: number // for PROVING the ablated level unsolvable (exhaustive search)
}

export const DEFAULT_BUDGET: SolverBudget = { maxDepth: 80, maxExpanded: 120_000, maxAblationExpanded: 250_000 }

export interface LevelRecord {
  world: string
  signatureMechanic: string
  seed: number
  structure: { boards: number; pieces: number; boxes: number }
  solver: { solutionLength: number; expandedStates: number; moves: Direction[] }
  usage: Record<string, boolean>
  necessity: Record<string, boolean>
  ablationExpandedStates: number[]
}

export type Verdict =
  | { accepted: true; record: LevelRecord }
  | { accepted: false; reason: 'invalid' | 'noPlayerGoal' | 'evenRoom' | 'presence' | 'alreadySolved' | 'unsolved' | 'tooShort' | 'unused' | 'notNecessary' | 'ablationUnproven' }

export function hasPlayerGoal(world: World): boolean {
  return Object.values(world.boards).some((b) => b.cells.some((row) => row.some((c) => c.requirement === 'player')))
}

// Every room a box leads into is odd-sized: entering lands on the centre cell of the side you
// come in from, and an even side has no centre cell.
export function roomsAreOdd(world: World): boolean {
  return Object.values(world.pieces).every((p) => p.boardRef === undefined || (world.boards[p.boardRef]?.size ?? 1) % 2 === 1)
}

export function isStructurallyValid(world: World): boolean {
  try {
    parseLevel(JSON.parse(JSON.stringify(serializeLevel(world))))
    return true
  } catch {
    return false
  }
}

// The events of every move along a solution, replayed on the real engine.
export function solutionEvents(world: World, moves: Direction[]): EngineEvent[][] {
  const perMove: EngineEvent[][] = []
  let current = world
  for (const dir of moves) {
    const events: EngineEvent[] = []
    const next = withEngineContext({ events }, () => applyMove(current, dir))
    if (next === null) throw new Error('solution replay failed')
    perMove.push(events)
    current = next
  }
  return perMove
}

export function verifyWorldLevel(profile: WorldProfile, world: World, seed: number, budget: SolverBudget = DEFAULT_BUDGET): Verdict {
  if (!isStructurallyValid(world)) return { accepted: false, reason: 'invalid' }
  // Like every official level, the player has a spot of its own to end on (a player goal).
  if (!hasPlayerGoal(world)) return { accepted: false, reason: 'noPlayerGoal' }
  if (!roomsAreOdd(world)) return { accepted: false, reason: 'evenRoom' }
  if (!profile.presence(world)) return { accepted: false, reason: 'presence' }

  const solved = solveDetailed(world, budget.maxDepth, budget.maxExpanded)
  if (solved.status !== 'SOLVED') return { accepted: false, reason: 'unsolved' }
  const moves = solved.result.moves
  if (moves.length === 0) return { accepted: false, reason: 'alreadySolved' }
  if (moves.length < profile.minSolutionLength) return { accepted: false, reason: 'tooShort' }

  const events = solutionEvents(world, moves)
  if (!profile.usage(events, world)) return { accepted: false, reason: 'unused' }

  const ablationExpandedStates: number[] = []
  for (const ablation of profile.ablations(world)) {
    const disabled = new Set(ablation.disabled ?? [])
    const result = withEngineContext({ disabledMechanics: disabled }, () =>
      solveDetailed(ablation.world, budget.maxDepth * 4, budget.maxAblationExpanded),
    )
    if (result.status === 'SOLVED') return { accepted: false, reason: 'notNecessary' }
    // A search cut short proves nothing: only an exhausted state space counts as "unsolvable".
    if (result.status !== 'UNSOLVABLE') return { accepted: false, reason: 'ablationUnproven' }
    ablationExpandedStates.push(-1)
  }

  const pieces = Object.values(world.pieces)
  return {
    accepted: true,
    record: {
      world: profile.id,
      signatureMechanic: profile.signature,
      seed,
      structure: {
        boards: Object.keys(world.boards).length,
        pieces: pieces.length,
        boxes: pieces.filter((p) => p.kind !== 'player').length,
      },
      solver: { solutionLength: moves.length, expandedStates: solved.result.expandedStates, moves },
      usage: { [profile.signature]: true },
      necessity: { [profile.signature]: true },
      ablationExpandedStates,
    },
  }
}
