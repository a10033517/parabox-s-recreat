import { checkWin } from '../../../src/game/engine/rules'
import { VOID_BOARD_ID, World, occupantAt } from '../../../src/game/engine/types'
import { canonicalKey } from '../canonical'
import { pruneIdlePieces } from '../prune'
import { solveDetailed } from '../solver'
import { Rng } from './build'
import { difficultyScore, solveScore } from './score'
import { DEFAULT_BUDGET, LevelRecord, SolverBudget, WorldProfile, verifyWorldLevel } from './verify'

// Making an accepted level harder without changing what it is made of: the same rooms, walls and
// goals, the same boxes, containers and player — only where they stand is re-rolled, many times,
// and the hardest arrangement that still passes every World check (and has no idle piece) wins.

export interface HardenOptions {
  tries: number
  seconds: number
  budget?: SolverBudget
}

export interface HardenResult {
  world: World
  record: LevelRecord
  tries: number
  improved: number // how many times a harder arrangement replaced the best one
}

// Every piece back on a random free floor cell of the board it stood on (never on a goal, so a
// box cannot start already in place).
export function rearrange(world: World, rng: Rng): World | null {
  const ids = Object.keys(world.locations).filter((id) => world.locations[id].board !== VOID_BOARD_ID)
  const next: World = { ...world, locations: Object.fromEntries(Object.entries(world.locations).filter(([id]) => !ids.includes(id))) }
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  for (const id of ids) {
    const boardId = world.locations[id].board
    const board = world.boards[boardId]
    const free: { x: number; y: number }[] = []
    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const cell = board.cells[y][x]
        if (cell.type === 'floor' && cell.requirement === undefined && occupantAt(next, { board: boardId, x, y }) === undefined) free.push({ x, y })
      }
    }
    if (free.length === 0) return null
    const cell = free[Math.floor(rng() * free.length)]
    next.locations = { ...next.locations, [id]: { board: boardId, x: cell.x, y: cell.y } }
  }
  return next
}

export function hardenLevel(profile: WorldProfile, world: World, record: LevelRecord, rng: Rng, opts: HardenOptions): HardenResult {
  const budget = opts.budget ?? DEFAULT_BUDGET
  const started = Date.now()
  const seen = new Set<string>([canonicalKey(world)])
  let best = { world, record }
  let bestScore = difficultyScore(record)
  let improved = 0
  let tries = 0
  for (; tries < opts.tries && (Date.now() - started) / 1000 < opts.seconds; tries++) {
    const candidate = rearrange(world, rng)
    if (candidate === null || checkWin(candidate)) continue
    const key = canonicalKey(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    // Cheap screen first: only an arrangement that is harder to solve gets the full checks.
    const solved = solveDetailed(candidate, budget.maxDepth, budget.maxExpanded)
    if (solved.status !== 'SOLVED') continue
    const score = solveScore(solved.result.moves.length, solved.result.expandedStates)
    if (score <= bestScore) continue
    const pruned = pruneIdlePieces(candidate, { maxDepth: budget.maxDepth, maxExpanded: budget.maxExpanded })
    if (pruned === null || pruned.removed.length > 0) continue // every piece must still matter
    const verdict = verifyWorldLevel(profile, candidate, record.seed, budget)
    if (!verdict.accepted) continue
    best = { world: candidate, record: verdict.record }
    bestScore = difficultyScore(verdict.record)
    improved++
  }
  return { ...best, tries, improved }
}
