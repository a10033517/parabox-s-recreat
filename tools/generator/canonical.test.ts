import { World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'

test('canonicalKey is identical for equivalent content built with different key insertion order', () => {
  const board = {
    id: 'root',
    size: 3,
    cells: [
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
    ],
  }
  const a: World = {
    boards: { root: board },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 1, y: 1 } },
  }
  const b: World = {
    locations: { player: { x: 1, board: 'root', y: 1 } },
    pieces: { player: { kind: 'player', id: 'player' } },
    boards: { root: board },
  }
  expect(canonicalKey(a)).toBe(canonicalKey(b))
})

test('canonicalKey differs when content differs', () => {
  const board = {
    id: 'root',
    size: 3,
    cells: [
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
    ],
  }
  const a: World = {
    boards: { root: board },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 1, y: 1 } },
  }
  const b: World = { ...a, locations: { player: { board: 'root', x: 2, y: 1 } } }
  expect(canonicalKey(a)).not.toBe(canonicalKey(b))
})
