import { Grid } from '../engine/types'

const CELL_COLORS = { empty: '#1e293b', wall: '#0f172a', target: '#334155' } as const
const BOX_COLORS = { normal: '#f59e0b', container: '#38bdf8' } as const
const PLAYER_COLOR = '#f472b6'
const GOAL_BOX_OUTLINE = '#facc15'
const NEST_INSET = 4

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  originX: number,
  originY: number,
  cellSize: number,
): void {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      ctx.fillStyle = CELL_COLORS[grid.cells[y][x]]
      ctx.fillRect(originX + x * cellSize, originY + y * cellSize, cellSize, cellSize)
    }
  }

  for (const box of grid.boxes) {
    const bx = originX + box.x * cellSize
    const by = originY + box.y * cellSize
    ctx.fillStyle = BOX_COLORS[box.boxType]
    ctx.fillRect(bx, by, cellSize, cellSize)

    if (box.isGoalBox) {
      ctx.strokeStyle = GOAL_BOX_OUTLINE
      ctx.lineWidth = 2
      ctx.strokeRect(bx + 1, by + 1, cellSize - 2, cellSize - 2)
    }

    if (box.boxType === 'container') {
      renderGrid(ctx, box.interior, bx + NEST_INSET, by + NEST_INSET, Math.max(4, cellSize - NEST_INSET * 2) / Math.max(box.interior.width, box.interior.height))
    }
  }

  if (grid.player) {
    ctx.fillStyle = PLAYER_COLOR
    ctx.fillRect(originX + grid.player.x * cellSize, originY + grid.player.y * cellSize, cellSize, cellSize)
  }
}
