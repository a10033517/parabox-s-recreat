import { World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'

test('canonicalKey is identical for equivalent content built with different key insertion order', () => {
  const a: World = {
    boards: {
      root: {
        id: 'root',
        size: 3,
        cells: [
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
        ],
      },
    },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 1, y: 1 } },
  }
  const b: World = {
    locations: { player: { x: 1, board: 'root', y: 1 } },
    pieces: { player: { kind: 'player', id: 'player' } },
    boards: {
      root: {
        size: 3,
        id: 'root',
        cells: [
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
        ],
      },
    },
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

test('canonicalKey differs for same coordinates but different containment topology', () => {
  const floor = () => Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ type: 'floor' as const })))
  const make = (boardRef: string): World => ({
    boards: { root: { id: 'root', size: 3, cells: floor() }, a: { id: 'a', size: 3, cells: floor() }, b: { id: 'b', size: 3, cells: floor() } },
    pieces: { player: { id: 'player', kind: 'player' }, c: { id: 'c', kind: 'container', boardRef } },
    locations: { player: { board: 'root', x: 0, y: 0 }, c: { board: 'root', x: 1, y: 1 } },
  })
  expect(canonicalKey(make('a'))).not.toBe(canonicalKey(make('b')))
})

test('canonicalKey differs for clone / flip relation with identical positions', () => {
  const base = (extra: object): World => ({
    boards: { root: { id: 'root', size: 3, cells: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ type: 'floor' as const }))) } },
    pieces: { player: { id: 'player', kind: 'player' }, c: { id: 'c', kind: 'normal', ...extra } },
    locations: { player: { board: 'root', x: 0, y: 0 }, c: { board: 'root', x: 1, y: 1 } },
  })
  const keys = [{}, { fliph: true }, { cloneOf: 'x' }].map((e) => canonicalKey(base(e)))
  expect(new Set(keys).size).toBe(3)
})
