import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, PLAYER_ID, World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export interface SolveResult {
  moves: Direction[]
  expandedStates: number
  maxFrontierSize: number
  visitedStates: number
  // branchingFactors[i] = number of the 4 directions that produced a valid
  // (non-null) next state when the i-th expanded state was expanded, in
  // expansion order. Length === expandedStates always. Computed by trying
  // all 4 directions BEFORE checking any of them for a win or for having
  // been visited before, so it always reflects the true count of legal
  // actions from that state — not reduced by which neighbors happen to be
  // new or which one happens to win. Feeds difficultyAnalyzer.ts's
  // avgBranching/maxBranching/deadEndRatio.
  branchingFactors: number[]
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
    return { moves: [], expandedStates: 0, maxFrontierSize: 1, visitedStates: 1, branchingFactors: [] }
  }

  const visited = new Set<string>([canonicalKey(initialWorld)])
  let frontier: { world: World; path: Direction[] }[] = [{ world: initialWorld, path: [] }]
  let depth = 0
  let expandedStates = 0
  let maxFrontierSize = frontier.length
  const branchingFactors: number[] = []

  while (frontier.length > 0 && depth < maxDepth) {
    maxFrontierSize = Math.max(maxFrontierSize, frontier.length)
    const nextFrontier: typeof frontier = []
    for (const { world, path } of frontier) {
      if (expandedStates >= maxExpandedStates) return null
      expandedStates++

      const validNexts: { direction: Direction; next: World }[] = []
      for (const direction of DIRECTIONS) {
        const next = applyMove(world, direction)
        if (next) validNexts.push({ direction, next })
      }
      branchingFactors.push(validNexts.length)

      for (const { direction, next } of validNexts) {
        const key = canonicalKey(next)
        if (visited.has(key)) continue
        visited.add(key)
        const newPath = [...path, direction]
        if (checkWin(next)) {
          return { moves: newPath, expandedStates, maxFrontierSize, visitedStates: visited.size, branchingFactors }
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

// Counts moves where at least one non-player piece changes position while
// staying on the SAME board — a genuine "pushed a box along the floor"
// event, distinct from countCrossingMoves (any board change) and
// countEatMoves (specifically landing inside a container's interior).
// Added per user feedback that generated levels all looked mechanically
// the same (walk + eat, nothing else): this measures the previously
// unmeasured Sokoban-style box-pushing dimension so it can be scored and
// biased for in generation (see generateLevel.ts's weights.boxPushBonus).
export function countPushMoves(world: World, moves: Direction[]): number {
  let current = world
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countPushMoves received an invalid move for this world')
    for (const pieceId of Object.keys(current.locations)) {
      if (pieceId === PLAYER_ID) continue
      const before = current.locations[pieceId]
      const after = next.locations[pieceId]
      if (before.board !== after.board) continue // crossing/eat, not a plain push
      if (before.x !== after.x || before.y !== after.y) {
        count++
        break
      }
    }
    current = next
  }
  return count
}

// "Box lines" metric (Taylor & Parberry, "Procedural Generation of Sokoban
// Levels", LARC-2011-01, §3.3): any number of consecutive pushes of the
// SAME box in the SAME direction count as a single line; pushing a
// different box, or the same box in a new direction, starts a new line.
// The paper's own observation is that this correlates with perceived
// difficulty better than raw move count or push count (a long straight
// shove down one corridor is tedious, not hard). "Consecutive" here means
// consecutive PUSHES of that box specifically — an intervening move that
// pushes a different box (or no box at all) does not by itself break a
// line, only a direction change (or first push) does; this matches the
// paper's stated rationale (lines measure direction changes) rather than
// literal move-adjacency, and gives a well-defined, order-independent-per-box
// count. A single move can push more than one piece at once via chain-push
// (rules.ts's resolveBlocked resolves the whole chain in one top-level
// move) — every piece in that chain moves in the move's own direction, so
// each contributes to its own line independently.
export function countBoxLines(world: World, moves: Direction[]): number {
  let current = world
  let lines = 0
  const lastDirection = new Map<string, Direction>()
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countBoxLines received an invalid move for this world')
    for (const pieceId of Object.keys(current.locations)) {
      if (pieceId === PLAYER_ID) continue
      const before = current.locations[pieceId]
      const after = next.locations[pieceId]
      if (before.board !== after.board) continue // crossing/eat, not a plain push
      if (before.x === after.x && before.y === after.y) continue // not pushed this move
      if (lastDirection.get(pieceId) !== direction) {
        lines++
        lastDirection.set(pieceId, direction)
      }
    }
    current = next
  }
  return lines
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

