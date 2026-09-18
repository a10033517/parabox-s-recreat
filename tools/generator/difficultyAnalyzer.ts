import { Direction, World, cloneWorld, findContainerFor } from '../../src/game/engine/types'
import { applyMove, checkWin } from '../../src/game/engine/rules'
import { SolveResult, countCrossingMoves, solve } from './solver'

export interface DifficultyVector {
  solutionLength: number
  expandedStates: number
  generatedStates: number
  maxQueueSize: number
  avgBranching: number
  maxBranching: number
  deadEndRatio: number
  criticalDecisions: number
  spaceTransitions: number
  nestedBoxUsed: boolean
  nestedBoxRequired: boolean
  maxContainerDepthUsed: number
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function containerDepthOf(world: World, boardId: string): number {
  let depth = 0
  let current = boardId
  const visited = new Set<string>()
  while (current !== 'root') {
    if (visited.has(current)) break // defensive; this generator never creates a cycle
    visited.add(current)
    const owner = findContainerFor(world, current)
    if (owner === undefined) break
    current = world.locations[owner].board
    depth++
  }
  return depth
}

// Deepest board depth touched by ANY piece, not just the player: a box can
// get eaten into a container's interior while the player itself never
// leaves the outer board (resolveBlocked moves the pushed piece into the
// container while the pusher lands in the cell the pushed piece vacated —
// see rules.ts's resolveBlocked), so tracking only the player's own board
// would silently miss the most common way a container's depth is used.
function maxDepthAcrossPieces(world: World): number {
  let max = 0
  for (const loc of Object.values(world.locations)) {
    max = Math.max(max, containerDepthOf(world, loc.board))
  }
  return max
}

function maxContainerDepthUsed(world: World, moves: Direction[]): number {
  let current = world
  let maxDepth = maxDepthAcrossPieces(current)
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('maxContainerDepthUsed received an invalid move for this world')
    maxDepth = Math.max(maxDepth, maxDepthAcrossPieces(next))
    current = next
  }
  return maxDepth
}

// For each state S on the optimal path, k = (moves remaining in the
// optimal solution FROM S, counting the upcoming move) is exactly the
// right solve() budget to give an alternative first move from S: the
// alternative consumes 1 of those k moves reaching its own resulting
// state, leaving k-1 to match the optimal's own remaining length from
// there, +1 slack (so an equally-short alternate solution still doesn't
// count as a dead end) = k. See the design spec §7's own derivation.
function criticalDecisions(world: World, solved: SolveResult, maxSolverExpandedStates: number): number {
  let current = world
  let decisions = 0
  for (let i = 0; i < solved.moves.length; i++) {
    const taken = solved.moves[i]
    const k = solved.moves.length - i
    let anySucceeds = false
    let hasAlternative = false
    for (const direction of DIRECTIONS) {
      if (direction === taken) continue
      const alt = applyMove(current, direction)
      if (!alt) continue
      hasAlternative = true
      if (checkWin(alt) || solve(alt, k, maxSolverExpandedStates) !== null) { anySucceeds = true; break }
    }
    if (hasAlternative && !anySucceeds) decisions++
    const next = applyMove(current, taken)
    if (!next) throw new Error('criticalDecisions received an invalid move for this world')
    current = next
  }
  return decisions
}

// Mechanic relevance (design spec §7/md §18): seal every container's cell
// into a wall and remove the container piece itself, but deliberately do
// NOT delete its interior board or anything inside it — the goal (and any
// box) that lived there stays in the world, so checkWin still requires it;
// it simply becomes permanently unreachable now that its only entrance is
// gone. Deleting the board instead would make its goal cell vanish
// entirely, which checkWin would misread as "nothing left to satisfy,
// trivially won" rather than "impossible to reach" — the wrong signal.
function nestedBoxRequired(world: World, solved: SolveResult, maxSolverExpandedStates: number): boolean {
  const frozen = cloneWorld(world)
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container') continue
    const loc = frozen.locations[piece.id]
    if (loc === undefined) continue
    const board = frozen.boards[loc.board]
    if (board !== undefined) board.cells[loc.y][loc.x] = { type: 'wall' }
    delete frozen.pieces[piece.id]
    delete frozen.locations[piece.id]
  }
  if (checkWin(frozen)) return false
  const frozenSolved = solve(frozen, solved.moves.length + 1, maxSolverExpandedStates)
  return frozenSolved === null
}

export function analyze(world: World, solved: SolveResult, maxSolverExpandedStates: number): DifficultyVector {
  const avgBranching =
    solved.branchingFactors.length > 0
      ? solved.branchingFactors.reduce((a, b) => a + b, 0) / solved.branchingFactors.length
      : 0
  const maxBranching = solved.branchingFactors.length > 0 ? Math.max(...solved.branchingFactors) : 0
  const deadEnds = solved.branchingFactors.filter((b) => b === 0).length
  const deadEndRatio = solved.expandedStates > 0 ? deadEnds / solved.expandedStates : 0
  const spaceTransitions = countCrossingMoves(world, solved.moves)

  return {
    solutionLength: solved.moves.length,
    expandedStates: solved.expandedStates,
    generatedStates: solved.visitedStates,
    maxQueueSize: solved.maxFrontierSize,
    avgBranching,
    maxBranching,
    deadEndRatio,
    criticalDecisions: criticalDecisions(world, solved, maxSolverExpandedStates),
    spaceTransitions,
    nestedBoxUsed: spaceTransitions > 0,
    nestedBoxRequired: nestedBoxRequired(world, solved, maxSolverExpandedStates),
    maxContainerDepthUsed: maxContainerDepthUsed(world, solved.moves),
  }
}
