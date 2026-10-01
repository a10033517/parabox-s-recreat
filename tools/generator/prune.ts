import { applyMove } from '../../src/game/engine/rules'
import { EngineEvent, withEngineContext } from '../../src/game/engine/events'
import { BoardId, Direction, PLAYER_ID, PieceId, World } from '../../src/game/engine/types'
import { solveDetailed } from './solver'

// Idle pieces: things a generated level placed that the puzzle never needs.
//   - a plain box that ends off every box goal AND does not get in the way (removing it leaves
//     the level solvable in the same number of moves or fewer is NOT "in the way" — only a box
//     whose removal makes the level shorter or unsolvable is acting as a wall);
//   - a box with a room (container) that nothing ever goes into, comes out of or is eaten by,
//     and that does not end on a goal.
// pruneIdlePieces removes them, re-solving after each removal so the level stays solvable.
// Possessable blocks, wall blocks and the player are never touched.

export interface PruneBudget {
  maxDepth: number
  maxExpanded: number
}

export interface PruneResult {
  world: World
  removed: PieceId[]
  moves: Direction[]
}

function replay(world: World, moves: Direction[]): { final: World; events: EngineEvent[] } {
  const events: EngineEvent[] = []
  let current = world
  for (const dir of moves) {
    const next = withEngineContext({ events }, () => applyMove(current, dir))
    if (next === null) throw new Error('solution replay failed')
    current = next
  }
  return { final: current, events }
}

function onGoal(world: World, pieceId: PieceId): boolean {
  const loc = world.locations[pieceId]
  return loc !== undefined && world.boards[loc.board]?.cells[loc.y]?.[loc.x]?.requirement === 'box'
}

// Boxes the solution goes through in any way: entered, left through, eating, or an ∞ exit.
function usedContainers(events: EngineEvent[]): Set<PieceId> {
  const used = new Set<PieceId>()
  for (const e of events) {
    if (e.type === 'EnterEvent') used.add(e.intoId)
    else if (e.type === 'ExitEvent') used.add(e.throughId)
    else if (e.type === 'EatEvent') used.add(e.eaterId)
    else if (e.type === 'InfiniteExitEvent') used.add(e.ownerId)
  }
  return used
}

const isPlainBox = (world: World, id: PieceId) => {
  const p = world.pieces[id]
  return p.kind === 'normal' && !p.wall && !p.possessable
}
const isPlainContainer = (world: World, id: PieceId) => {
  const p = world.pieces[id]
  return p.kind === 'container' && !p.wall && !p.possessable
}

// Removes a piece. A removed box's room goes too when nothing else leads into it and the player
// is not in it — and with it whatever stood inside, recursively.
export function removePiece(world: World, pieceId: PieceId): World {
  const pieces = { ...world.pieces }
  const locations = { ...world.locations }
  const boards = { ...world.boards }
  const doomed = [pieceId]
  while (doomed.length > 0) {
    const id = doomed.pop() as PieceId
    const boardRef = pieces[id]?.boardRef
    delete pieces[id]
    delete locations[id]
    if (boardRef === undefined || boards[boardRef] === undefined) continue
    const stillReferenced = Object.values(pieces).some((p) => p.boardRef === boardRef || p.cloneOf !== undefined && pieces[p.cloneOf]?.boardRef === boardRef)
    const playerInside = locations[PLAYER_ID]?.board === boardRef
    if (stillReferenced || playerInside) continue
    delete boards[boardRef as BoardId]
    for (const [other, loc] of Object.entries(locations)) if (loc.board === boardRef) doomed.push(other)
  }
  return { ...world, pieces, locations, boards }
}

export function pruneIdlePieces(world: World, budget: PruneBudget): PruneResult | null {
  const solve = (w: World) => {
    const r = solveDetailed(w, budget.maxDepth, budget.maxExpanded)
    return r.status === 'SOLVED' ? r.result.moves : null
  }
  let current = world
  let moves = solve(current)
  if (moves === null) return null
  const removed: PieceId[] = []

  // Containers the solution never uses and that do not end on a goal.
  {
    const { final, events } = replay(current, moves)
    const used = usedContainers(events)
    const idle = Object.keys(current.pieces).filter((id) => isPlainContainer(current, id) && !used.has(id) && !onGoal(final, id))
    if (idle.length > 0) {
      for (const id of idle) {
        if (current.pieces[id] === undefined) continue // already gone with an outer box
        current = removePiece(current, id)
        removed.push(id)
      }
      moves = solve(current)
      if (moves === null) return null
    }
  }

  // Plain boxes off every goal that are not in the way, one at a time.
  for (const id of Object.keys(current.pieces)) {
    if (current.pieces[id] === undefined || !isPlainBox(current, id)) continue
    const { final } = replay(current, moves)
    if (onGoal(final, id)) continue
    const without = removePiece(current, id)
    const shorter = solve(without)
    if (shorter === null || shorter.length < moves.length) continue // it blocks: a wall
    current = without
    moves = shorter
    removed.push(id)
  }

  // A level whose goals are all met before the first move is no puzzle.
  if (moves.length === 0) return null
  return { world: current, removed, moves }
}
