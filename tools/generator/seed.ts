import { Board, Cell, World, PLAYER_ID } from '../../src/game/engine/types'

const SEED_SIZE = 7

export function createSeedWorld(): World {
  const cells: Cell[][] = Array.from({ length: SEED_SIZE }, (_, y) =>
    Array.from({ length: SEED_SIZE }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === SEED_SIZE - 1 || y === SEED_SIZE - 1
      return { type: isBorder ? 'wall' : 'floor' } as Cell
    }),
  )
  cells[3][4] = { type: 'wall' }
  cells[3][3] = { type: 'floor', requirement: 'box' }

  const inside: Board = {
    id: 'goalInside',
    size: 3,
    cells: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ type: 'floor' as const }))),
  }
  const root: Board = { id: 'root', size: SEED_SIZE, cells }

  return {
    boards: { root, goalInside: inside },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      goal: { id: 'goal', kind: 'container', boardRef: 'goalInside' },
      box1: { id: 'box1', kind: 'normal' },
      box2: { id: 'box2', kind: 'normal' },
    },
    locations: {
      [PLAYER_ID]: { board: 'root', x: 2, y: 2 },
      goal: { board: 'root', x: 3, y: 3 },
      box1: { board: 'goalInside', x: 2, y: 1 },
      box2: { board: 'root', x: 2, y: 4 },
    },
  }
}
