import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, PLAYER_ID, World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'
import { SeedGroup } from './seed'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export interface SolveResult {
  moves: Direction[]
  expandedStates: number
  maxFrontierSize: number
  visitedStates: number
}

// `maxExpandedStates` is a safety cap, not part of the original design
// listing: diagnostics on this redesign found a hard-biased seed whose BFS
// state space grew combinatorially (multiple independently-movable boxes),
// exhausting a 4GB heap on a single candidate. Hitting the cap returns null
// — indistinguishable to callers from "no solution within maxDepth" — so a
// candidate this expensive to solve is simply rejected as unsolvable-within-
// budget rather than hanging the process. Default is Infinity so this is a
// pure addition for any existing caller that doesn't opt in.
export function solve(initialWorld: World, maxDepth = 200, maxExpandedStates = Infinity): SolveResult | null {
  if (checkWin(initialWorld)) {
    return { moves: [], expandedStates: 0, maxFrontierSize: 1, visitedStates: 1 }
  }

  const visited = new Set<string>([canonicalKey(initialWorld)])
  let frontier: { world: World; path: Direction[] }[] = [{ world: initialWorld, path: [] }]
  let depth = 0
  let expandedStates = 0
  let maxFrontierSize = frontier.length

  while (frontier.length > 0 && depth < maxDepth) {
    maxFrontierSize = Math.max(maxFrontierSize, frontier.length)
    const nextFrontier: typeof frontier = []
    for (const { world, path } of frontier) {
      if (expandedStates >= maxExpandedStates) return null
      expandedStates++
      for (const direction of DIRECTIONS) {
        const next = applyMove(world, direction)
        if (!next) continue
        const key = canonicalKey(next)
        if (visited.has(key)) continue
        visited.add(key)
        const newPath = [...path, direction]
        if (checkWin(next)) {
          return { moves: newPath, expandedStates, maxFrontierSize, visitedStates: visited.size }
        }
        nextFrontier.push({ world: next, path: newPath })
      }
    }
    frontier = nextFrontier
    depth++
  }
  return null
}

export function countCrossingMoves(world: World, moves: Direction[]): number {
  let current = world
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countCrossingMoves received an invalid move for this world')
    for (const pieceId of Object.keys(current.locations)) {
      if (current.locations[pieceId].board !== next.locations[pieceId].board) {
        count++
        break
      }
    }
    current = next
  }
  return count
}

export function countEatMoves(world: World, moves: Direction[]): number {
  const interiorIds = new Set(
    Object.values(world.pieces)
      .filter((piece) => piece.kind === 'container' && piece.boardRef !== undefined)
      .map((piece) => piece.boardRef as string),
  )
  let current = world
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countEatMoves received an invalid move for this world')
    for (const pieceId of Object.keys(current.locations)) {
      if (pieceId === PLAYER_ID) continue
      if (current.locations[pieceId].board === next.locations[pieceId].board) continue
      if (interiorIds.has(next.locations[pieceId].board)) {
        count++
        break
      }
    }
    current = next
  }
  return count
}

// `groups` MUST be the surviving groups (see section 4.6's getSurvivingGroups)
// — a group whose pieces were deleted by pruning has no entry in
// `current.locations`/`next.locations`, and the `!before || !after` guard
// below is a second, independent layer of defense (not a substitute for
// passing the right list): it keeps this function safe even if a future
// caller forgets to filter first, but callers should still always pass
// survivors so the metric's semantic scope is correct.
export function countGroupsUsed(world: World, moves: Direction[], groups: SeedGroup[]): number {
  const usedGroups = new Set<string>()
  let current = world
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countGroupsUsed received an invalid move for this world')
    for (const group of groups) {
      if (usedGroups.has(group.containerId)) continue
      for (const pieceId of [group.containerId, group.boxId]) {
        const before = current.locations[pieceId]
        const after = next.locations[pieceId]
        if (!before || !after) continue
        if (before.board !== after.board || before.x !== after.x || before.y !== after.y) {
          usedGroups.add(group.containerId)
          break
        }
      }
    }
    current = next
  }
  return usedGroups.size
}
