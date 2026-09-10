import { applyMove } from '../../src/game/engine/rules'
import { Direction, World, cloneWorld } from '../../src/game/engine/types'

// Cosmetic/quality pass, not a difficulty lever: walls off every floor cell
// (on any board) that no piece ever occupies at any point while replaying
// `moves` from `world`'s initial state through to the solved end state.
//
// Why this can never change any measured difficulty metric: `moves` is
// already a *specific, verified* solution (the one solve() found and every
// metric in difficultyScorer.ts was computed from). That exact move
// sequence only ever depends on cells it actually occupies at some point —
// resolveBlocked's chain resolution only ever lands a piece on a cell it
// counts as "used" here — so the same sequence remains valid, move-for-move
// identical, against the trimmed world. Converting floor cells the path
// never visits into walls can only ever restrict the state space (never
// add a new, shorter route), and the exact original solution still exists
// in it — so the shortest-path length, crossing count, eat count, and every
// other solved-path metric are provably unchanged. This exists purely to
// remove unused "wander room" for level-quality reasons.
export function trimUnusedCells(world: World, moves: Direction[]): World {
  const trimmed = cloneWorld(world)
  const used = new Set<string>()

  const mark = (w: World) => {
    for (const loc of Object.values(w.locations)) {
      used.add(`${loc.board}:${loc.x}:${loc.y}`)
    }
  }

  let current = world
  mark(current)
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('trimUnusedCells received an invalid move for this world')
    mark(next)
    current = next
  }

  for (const [boardId, board] of Object.entries(trimmed.boards)) {
    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const cell = board.cells[y][x]
        if (cell.type !== 'floor') continue
        if (cell.requirement !== undefined) continue // never wall a win-condition cell
        if (used.has(`${boardId}:${x}:${y}`)) continue
        board.cells[y][x] = { type: 'wall' }
      }
    }
  }

  return trimmed
}
