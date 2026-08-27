export type CellType = 'empty' | 'wall' | 'target'
export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Box {
  id: string
  x: number
  y: number
  boxType: 'normal' | 'container'
  interior: Grid
  isGoalBox?: boolean
}

export interface Grid {
  width: number
  height: number
  cells: CellType[][]
  boxes: Box[]
  player?: { x: number; y: number }
}

export const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

export function createEmptyGrid(width: number, height: number): Grid {
  const cells: CellType[][] = []
  for (let y = 0; y < height; y++) {
    cells.push(new Array<CellType>(width).fill('empty'))
  }
  return { width, height, cells, boxes: [] }
}

export function cloneGrid(grid: Grid): Grid {
  return structuredClone(grid)
}

export function cellAt(grid: Grid, x: number, y: number): CellType | 'oob' {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 'oob'
  return grid.cells[y][x]
}

export function boxAt(grid: Grid, x: number, y: number): Box | undefined {
  return grid.boxes.find((b) => b.x === x && b.y === y)
}
