import { applyMove } from '../../src/game/engine/rules'
import { Direction, PLAYER_ID, World, cloneWorld, inBounds, occupantAt, step } from '../../src/game/engine/types'
import { GENERATOR_CONFIG } from './generatorConfig'
import { SolveResult, solve } from './solver'

// Extends the seed-time obstacle-box experiment (see seed.ts's own comment
// on why it was removed): diagnostics found seed-time placement survived
// at only ~4% — the rest of the reverse walk routinely wandered the
// obstacle away from its blocking position over its remaining 12-50 steps,
// so the "necessarily blocks this approach" guarantee held only at the
// instant of seeding, not in the final shipped puzzle. This module places
// the obstacle *after* generation finishes, directly against the actual
// solved path of the finished puzzle — there is no "rest of the walk" left
// to wander it away afterward.
//
// A second, more fundamental fact ruled out the obvious "block the cell
// right before an eat" site (this file's own first draft): hand-tracing
// `resolveBlocked` (src/game/engine/rules.ts) shows a push chain resolves
// recursively — pushing into piece A, which is blocked by piece B, which
// gets eaten by a container C, all resolves in ONE top-level move,
// regardless of how many extra colinear pieces sit between the player and
// the existing chain. Inserting an obstacle directly on an eat's approach
// cell is therefore *never* going to cost an extra move — it's silently
// absorbed into the same chain-push, for free, every time. This is not a
// per-case probability; it's guaranteed by the engine's own recursion.
//
// The one place a straight push chain genuinely cannot just absorb an
// extra piece is where there's nowhere for it to go: a plain walk step (no
// other piece moves) whose destination cell has a wall (or the board edge)
// immediately beyond it in the same direction. Inserting an obstacle there
// and pushing it forward fails outright — the whole move is blocked, not
// merely delayed — forcing a genuinely different (and, if solve() confirms
// it, longer) route.

// Every move index in `moves` that is a "blockable plain walk": only the
// player moves at that step (no piece pushed), and the cell one step
// further in that same direction is out of bounds or a wall.
function findBlockableWalkIndices(world: World, moves: Direction[]): number[] {
  const indices: number[] = []
  let current = world
  for (let i = 0; i < moves.length; i++) {
    const next = applyMove(current, moves[i])
    if (!next) throw new Error('findBlockableWalkIndices received an invalid move for this world')

    const onlyPlayerMoved = Object.keys(current.locations)
      .filter((id) => id !== PLAYER_ID)
      .every((id) => {
        const before = current.locations[id]
        const after = next.locations[id]
        return before.board === after.board && before.x === after.x && before.y === after.y
      })

    if (onlyPlayerMoved) {
      const dest = next.locations[PLAYER_ID]
      const beyond = step(dest.x, dest.y, moves[i])
      const board = next.boards[dest.board]
      const blocked = !inBounds(board, beyond.x, beyond.y) || board.cells[beyond.y][beyond.x].type === 'wall'
      if (blocked) indices.push(i)
    }
    current = next
  }
  return indices
}

// Tries to insert one obstacle box at a genuinely blockable walk step from
// `solved`'s own actual path (not the seed's assumed geometry) — so its
// position can't have been wandered away from by anything that happened
// earlier or later in generation, because there IS no earlier/later: this
// runs once, after generation is already finished, directly against the
// finished puzzle's real solution.
//
// Returns null (no change) if: there is no blockable walk step at all;
// the destination cell isn't empty in the *initial* world (inserting a
// static obstacle there would conflict with whatever the original path
// already needed at that exact cell); the modified puzzle becomes
// unsolvable within a small budget beyond the original length; or an
// equally-short solution still exists (the obstacle wasn't actually
// necessary — matches this design's "keep only if every shortest solution
// needs it" principle, verified directly here rather than via a separate
// freeze-and-recheck pass, since we're constructing a fresh solve anyway).
export function tryInjectObstacle(
  world: World,
  solved: SolveResult,
  rng: () => number,
): { world: World; solved: SolveResult } | null {
  const blockableIndices = findBlockableWalkIndices(world, solved.moves)
  if (blockableIndices.length === 0) return null
  const chosen = blockableIndices[Math.floor(rng() * blockableIndices.length)]

  let current = world
  for (let i = 0; i <= chosen; i++) {
    const next = applyMove(current, solved.moves[i])
    if (!next) throw new Error('tryInjectObstacle received an invalid move for this world')
    current = next
  }
  const dest = current.locations[PLAYER_ID]

  // The destination cell must be empty and plain floor at t=0 too —
  // otherwise inserting a static obstacle there would conflict with
  // whatever the original solve already needed at that exact cell.
  if (occupantAt(world, dest)) return null
  const cell = world.boards[dest.board]?.cells[dest.y]?.[dest.x]
  if (!cell || cell.type !== 'floor' || cell.requirement !== undefined) return null

  const candidate = cloneWorld(world)
  const obstacleId = 'obstacle0'
  candidate.pieces[obstacleId] = { id: obstacleId, kind: 'normal' }
  candidate.locations[obstacleId] = { board: dest.board, x: dest.x, y: dest.y }

  const newSolved = solve(candidate, solved.moves.length + 5, GENERATOR_CONFIG.maxSolverExpandedStates)
  if (!newSolved) return null // became unsolvable within budget — reject
  if (newSolved.moves.length <= solved.moves.length) return null // not necessary — an equally-short route exists

  return { world: candidate, solved: newSolved }
}
