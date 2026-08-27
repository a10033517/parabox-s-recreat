import { Grid, CellType } from './types'

const VALID_CELL_TYPES: CellType[] = ['empty', 'wall', 'target']

export function serializeLevel(grid: Grid): string {
  return JSON.stringify(grid)
}

export function parseLevel(json: string): Grid {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Invalid level JSON: not parseable')
  }
  validateGrid(data)
  return data as Grid
}

function validateGrid(data: unknown, path = 'root'): asserts data is Grid {
  if (typeof data !== 'object' || data === null) {
    throw new Error(`Invalid grid at ${path}: not an object`)
  }
  const g = data as Record<string, unknown>
  if (typeof g.width !== 'number' || typeof g.height !== 'number') {
    throw new Error(`Invalid grid at ${path}: width/height must be numbers`)
  }
  if (!Array.isArray(g.cells) || g.cells.length !== g.height) {
    throw new Error(`Invalid grid at ${path}: cells row count must equal height`)
  }
  for (const row of g.cells as unknown[]) {
    if (!Array.isArray(row) || row.length !== g.width) {
      throw new Error(`Invalid grid at ${path}: cell row length must equal width`)
    }
    for (const cell of row) {
      if (!VALID_CELL_TYPES.includes(cell as CellType)) {
        throw new Error(`Invalid grid at ${path}: unknown cell type ${String(cell)}`)
      }
    }
  }
  if (!Array.isArray(g.boxes)) {
    throw new Error(`Invalid grid at ${path}: boxes must be an array`)
  }
  for (const box of g.boxes as unknown[]) {
    if (typeof box !== 'object' || box === null) {
      throw new Error(`Invalid box at ${path}`)
    }
    const b = box as Record<string, unknown>
    if (typeof b.id !== 'string' || typeof b.x !== 'number' || typeof b.y !== 'number') {
      throw new Error(`Invalid box at ${path}: id/x/y malformed`)
    }
    if (b.boxType !== 'normal' && b.boxType !== 'container') {
      throw new Error(`Invalid box at ${path}: boxType must be 'normal' or 'container'`)
    }
    validateGrid(b.interior, `${path}.boxes[${b.id}].interior`)
  }
}
