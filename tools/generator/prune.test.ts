import { describe, expect, it } from 'vitest'
import { Cell, PLAYER_ID, Piece, World } from '../../src/game/engine/types'
import { pruneIdlePieces, removePiece } from './prune'

const BUDGET = { maxDepth: 60, maxExpanded: 50_000 }

// Room text: '#' wall, '.' floor, '_' box goal, '=' player goal, letters are pieces from the legend.
function level(rooms: Record<string, string[]>, legend: Record<string, Omit<Piece, 'id'>>): World {
  const world: World = { boards: {}, pieces: {}, locations: {} }
  for (const [boardId, rows] of Object.entries(rooms)) {
    const cells = rows.map((row, y) => [...row].map((ch, x): Cell => {
      if (ch === '#') return { type: 'wall' }
      if (ch === '_') return { type: 'floor', requirement: 'box' }
      if (ch === '=') return { type: 'floor', requirement: 'player' }
      if (ch !== '.') {
        const id = ch === 'p' ? PLAYER_ID : ch
        world.pieces[id] = { id, ...(ch === 'p' ? { kind: 'player' } : legend[ch]) } as Piece
        world.locations[id] = { board: boardId, x, y }
      }
      return { type: 'floor' }
    }))
    world.boards[boardId] = { id: boardId, size: rows.length, cells }
  }
  return world
}

describe('pruneIdlePieces', () => {
  it('removes a plain box that is off every goal and not in the way', () => {
    const w = level({ root: ['p...=', '.....', '.....', '.....', '....b'] }, { b: { kind: 'normal' } })
    const out = pruneIdlePieces(w, BUDGET)
    expect(out?.removed).toEqual(['b'])
    expect(out?.world.pieces.b).toBeUndefined()
  })

  it('keeps a box that ends on a box goal', () => {
    const w = level({ root: ['.....', 'pb._.', '.....', '.....', '....='] }, { b: { kind: 'normal' } })
    expect(pruneIdlePieces(w, BUDGET)?.removed).toEqual([])
  })

  it('keeps a box that acts as a wall (without it the level gets shorter)', () => {
    // The box stands in the straight way to the goal: with it, the player has to walk around.
    const w = level({ root: ['p.b.=', '.....', '.....', '.....', '.....'] }, { b: { kind: 'normal' } })
    const out = pruneIdlePieces(w, BUDGET)
    expect(out?.removed).toEqual([])
    expect(out?.moves).toHaveLength(6)
  })

  it('removes a container nothing goes into, with its room and what is inside', () => {
    const w = level(
      { root: ['p...=', '.....', '.....', '.....', '....A'], in: ['...', '.c.', '...'] },
      { A: { kind: 'container', boardRef: 'in' }, c: { kind: 'normal' } },
    )
    const out = pruneIdlePieces(w, BUDGET)
    expect(out?.removed).toContain('A')
    expect(out?.world.boards.in).toBeUndefined()
    expect(out?.world.pieces.c).toBeUndefined()
  })

  it('keeps a container the solution goes into', () => {
    const w = level({ root: ['.....', '.....', 'p.A..', '.....', '.....'], a: ['...', '.=.', '...'] }, { A: { kind: 'container', boardRef: 'a' } })
    expect(pruneIdlePieces(w, BUDGET)?.removed).toEqual([])
  })

  it('removePiece keeps a room another box still leads into', () => {
    const w = level(
      { root: ['p.A.B', '.....', '.....', '.....', '....='], in: ['...', '...', '...'] },
      { A: { kind: 'container', boardRef: 'in' }, B: { kind: 'container', boardRef: 'in' } },
    )
    expect(removePiece(w, 'A').boards.in).toBeDefined()
  })
})
