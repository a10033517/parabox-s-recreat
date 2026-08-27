// 已知范围限制:只处理链长度 1(单箱平移)与恰好 2(靠墙嵌套)的反向操作。
import {
  boxAt,
  cellAt,
  cloneGrid,
  Direction,
  DIRECTION_VECTORS,
  Grid,
  nestEntryPosition,
} from '../../src/game/engine/types'

function isOpenCell(grid: Grid, x: number, y: number): boolean {
  if (cellAt(grid, x, y) !== 'empty' && cellAt(grid, x, y) !== 'target') return false
  return !boxAt(grid, x, y)
}

export function inverseTranslate(grid: Grid, direction: Direction): Grid | null {
  if (!grid.player) return null
  const { dx, dy } = DIRECTION_VECTORS[direction]
  const behind = { x: grid.player.x - dx, y: grid.player.y - dy }
  if (!isOpenCell(grid, behind.x, behind.y)) return null

  const ahead = { x: grid.player.x + dx, y: grid.player.y + dy }
  const pushedBox = boxAt(grid, ahead.x, ahead.y)

  const prev = cloneGrid(grid)
  prev.player = behind
  if (pushedBox) {
    const b = prev.boxes.find((bb) => bb.id === pushedBox.id)!
    b.x = grid.player.x
    b.y = grid.player.y
  }
  return prev
}

export function inverseNest(grid: Grid, direction: Direction): Grid | null {
  if (!grid.player) return null
  const { dx, dy } = DIRECTION_VECTORS[direction]
  const receiverPos = { x: grid.player.x + dx, y: grid.player.y + dy }
  const receiver = boxAt(grid, receiverPos.x, receiverPos.y)
  if (!receiver || receiver.boxType !== 'container') return null

  const wallPos = { x: receiver.x + dx, y: receiver.y + dy }
  if (cellAt(grid, wallPos.x, wallPos.y) !== 'wall') return null

  const behind = { x: grid.player.x - dx, y: grid.player.y - dy }
  if (!isOpenCell(grid, behind.x, behind.y)) return null

  const entryPos = nestEntryPosition(receiver.interior, direction)
  const nested = boxAt(receiver.interior, entryPos.x, entryPos.y)
  if (!nested) return null

  const prev = cloneGrid(grid)
  prev.player = behind
  const prevReceiver = prev.boxes.find((b) => b.id === receiver.id)!
  prevReceiver.interior.boxes = prevReceiver.interior.boxes.filter((b) => b.id !== nested.id)
  const restored = structuredClone(nested)
  restored.x = grid.player.x
  restored.y = grid.player.y
  prev.boxes.push(restored)
  return prev
}
