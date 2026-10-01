import { World } from '../../src/game/engine/types'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

export function canonicalKey(world: World): string {
  return JSON.stringify(canonicalize(world))
}

// Search-state key for the solver: only what a move can change. Board cells never change
// during play (moves only ever ADD boards — the Void, ε rooms), so boards contribute just their
// ids; the pieces' own data (which possess / flip / Void spawns do change) and every location.
// applyMove keeps the same pieces / boards objects when a move leaves them untouched, so their
// part of the key is cached per object instead of re-serialized for every state.
const piecesKeyCache = new WeakMap<object, string>()
const boardsKeyCache = new WeakMap<object, string>()

export function stateKey(world: World): string {
  let pieces = piecesKeyCache.get(world.pieces)
  if (pieces === undefined) {
    pieces = JSON.stringify(canonicalize(world.pieces))
    piecesKeyCache.set(world.pieces, pieces)
  }
  let boards = boardsKeyCache.get(world.boards)
  if (boards === undefined) {
    boards = Object.keys(world.boards).sort().join(',')
    boardsKeyCache.set(world.boards, boards)
  }
  const locations = Object.keys(world.locations)
    .sort()
    .map((id) => {
      const l = world.locations[id]
      return `${id}@${l.board},${l.x},${l.y}`
    })
    .join(';')
  return `${boards}|${locations}|${pieces}|${world.attemptOrder?.join(',') ?? ''}`
}
