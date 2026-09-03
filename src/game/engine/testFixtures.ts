import { Board, Piece, World, Location } from './types'

export function makeFloorBoard(id: string, size: number): Board {
  return {
    id,
    size,
    cells: Array.from({ length: size }, () =>
      Array.from({ length: size }, () => ({ type: 'floor' as const }))),
  }
}

export function setWall(board: Board, x: number, y: number): void {
  board.cells[y][x] = { ...board.cells[y][x], type: 'wall' }
}

export function setRequirement(
  board: Board,
  x: number,
  y: number,
  requirement: 'box' | 'player',
): void {
  board.cells[y][x] = { ...board.cells[y][x], requirement }
}

export function makeWorld(
  boards: Board[],
  pieces: Piece[],
  locations: Record<string, Location>,
): World {
  return {
    boards: Object.fromEntries(boards.map((b) => [b.id, b])),
    pieces: Object.fromEntries(pieces.map((p) => [p.id, p])),
    locations,
  }
}
