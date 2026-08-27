import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GameScreen } from './GameScreen'
import { createEmptyGrid } from './engine/types'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

function grid() {
  const g = createEmptyGrid(3, 3)
  g.player = { x: 1, y: 1 }
  return g
}

test('pressing a DPad button increments the step counter', async () => {
  render(<GameScreen initialGrid={grid()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 1')).toBeInTheDocument()
})

test('undo button decrements the step counter', async () => {
  render(<GameScreen initialGrid={grid()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByText('复位上一步'))
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
})

test('reaching the win condition calls onWin', async () => {
  // 3x3 网格且 target 位于正中央时,无法透过推箱子达成胜利:
  // 要把箱子从 target 旁边推回 target,玩家必须站在箱子的另一侧,
  // 但 3 宽网格里那一侧永远超出边界 (index 3 越界)。
  // 因此改用 4 宽网格,让玩家有空间站在箱子右侧,向左推回 target。
  const g = createEmptyGrid(4, 3)
  g.player = { x: 3, y: 1 }
  g.cells[1][1] = 'target'
  g.boxes.push({ id: 'g1', x: 1, y: 1, boxType: 'normal', interior: createEmptyGrid(1, 1), isGoalBox: true })
  g.boxes[0].isGoalBox = true
  // 把 g1 移出 target 一格,靠玩家推它回去触发胜利
  g.boxes[0].x = 2
  const onWin = vi.fn()
  render(<GameScreen initialGrid={g} onExit={() => {}} onWin={onWin} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('左'))
  expect(onWin).toHaveBeenCalled()
})
