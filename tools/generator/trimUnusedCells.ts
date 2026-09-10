import { applyMove } from '../../src/game/engine/rules'
import { Board, Direction, World, cloneWorld, inBounds } from '../../src/game/engine/types'
import { GENERATOR_CONFIG } from './generatorConfig'

const NEIGHBOR_DELTAS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

// Multi-source BFS from `seeds`, moving only through cells that are
// currently floor (existing walls block expansion, same as a player would
// be blocked), out to `radius` steps. Returns every reached cell,
// including the seeds themselves. Used to keep a maneuvering margin around
// the solved path rather than trimming down to a single bare corridor.
function expandBuffer(board: Board, seeds: { x: number; y: number }[], radius: number): Set<string> {
  const visited = new Set<string>()
  let frontier = seeds.map((s) => `${s.x}:${s.y}`)
  for (const key of frontier) visited.add(key)

  for (let dist = 0; dist < radius && frontier.length > 0; dist++) {
    const next: string[] = []
    for (const key of frontier) {
      const [x, y] = key.split(':').map(Number)
      for (const [dx, dy] of NEIGHBOR_DELTAS) {
        const nx = x + dx
        const ny = y + dy
        if (!inBounds(board, nx, ny)) continue
        if (board.cells[ny][nx].type !== 'floor') continue
        const nkey = `${nx}:${ny}`
        if (visited.has(nkey)) continue
        visited.add(nkey)
        next.push(nkey)
      }
    }
    frontier = next
  }
  return visited
}

// Cosmetic/quality pass, not a difficulty lever: walls off floor cells (on
// any board) that fall outside a `bufferRadius`-cell margin around every
// cell any piece occupies at any point while replaying `moves` from
// `world`'s initial state through to the solved end state.
//
// Why this can never change any measured difficulty metric: `moves` is
// already a *specific, verified* solution (the one solve() found and every
// metric in difficultyScorer.ts was computed from). That exact move
// sequence only ever depends on cells it actually occupies at some point —
// resolveBlocked's chain resolution only ever lands a piece on a cell
// counted as "used" here — so the same sequence remains valid, move-for-
// move identical, against the trimmed world regardless of bufferRadius
// (a wider buffer only ever keeps *more* floor, never removes a used
// cell). Converting untouched floor cells into walls can only ever
// restrict the state space (never add a new, shorter route), and the exact
// original solution still exists in it — so the shortest-path length,
// crossing count, eat count, and every other solved-path metric are
// provably unchanged regardless of bufferRadius.
//
// `bufferRadius` (BFS-graph distance in existing-floor cells, not used
// itself as a difficulty signal) defaults to GENERATOR_CONFIG.trimBufferRadius
// — a radius of 0 reproduces the original bare-corridor behavior; a wider
// radius keeps genuine maneuvering room / wrong-turn space around the
// solution instead of leaving only the single solved path.
export function trimUnusedCells(
  world: World,
  moves: Direction[],
  bufferRadius: number = GENERATOR_CONFIG.trimBufferRadius,
): World {
  const trimmed = cloneWorld(world)
  const usedByBoard = new Map<string, { x: number; y: number }[]>()

  const mark = (w: World) => {
    for (const loc of Object.values(w.locations)) {
      const list = usedByBoard.get(loc.board) ?? []
      list.push({ x: loc.x, y: loc.y })
      usedByBoard.set(loc.board, list)
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
    const seeds = usedByBoard.get(boardId) ?? []
    const keep = expandBuffer(board, seeds, bufferRadius)
    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const cell = board.cells[y][x]
        if (cell.type !== 'floor') continue
        if (cell.requirement !== undefined) continue // never wall a win-condition cell
        if (keep.has(`${x}:${y}`)) continue
        board.cells[y][x] = { type: 'wall' }
      }
    }
  }

  return trimmed
}
