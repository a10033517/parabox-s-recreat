import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorScreen } from './EditorScreen'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({ left: 0, top: 0 }) as unknown as typeof HTMLCanvasElement.prototype.getBoundingClientRect
})

const waitPastClickWindow = () => act(() => new Promise((resolve) => setTimeout(resolve, 260)))
const waitLongerThanAnyDebounceWindow = () => act(() => new Promise((resolve) => setTimeout(resolve, 500)))

test('selecting the wall tool then clicking the canvas places a wall cell', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('墙'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 32 + 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('cell-type-1-0')).toHaveTextContent('wall')
})

test('selecting the container box tool then clicking places a container box', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('box-at-0-0')).toHaveTextContent('container')
  expect(screen.getByTestId('board-ids')).toHaveTextContent('board-0,root')
})

test('double-clicking a container box enters its interior, breadcrumb shows the path', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByText('外层 > box-0')).toBeInTheDocument()
})

test('double-clicking with a different tool selected still enters the box instead of destroying it', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitLongerThanAnyDebounceWindow()
  await user.click(screen.getByLabelText('墙'))
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByText('外层 > box-0')).toBeInTheDocument()
})

test('clicking the breadcrumb root returns to the outer grid', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  await user.click(screen.getByText('外层'))
  expect(screen.queryByText(/外层 > /)).not.toBeInTheDocument()
})

test('clicking two different cells in quick succession places on both, not just the second', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('墙'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  fireEvent.click(canvas, { clientX: 32 + 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('cell-type-0-0')).toHaveTextContent('wall')
  expect(screen.getByTestId('cell-type-1-0')).toHaveTextContent('wall')
})

test('the first box placed on a fresh mount gets id box-0', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('普通箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('box-id-at-0-0')).toHaveTextContent('box-0')
})

test('the player tool moves the single player piece instead of creating a new one', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('玩家起点'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('box-id-at-0-0')).toHaveTextContent('player')
  expect(screen.getByTestId('piece-ids')).toHaveTextContent('player')
})

test('the goal-box tool paints a requirement on the cell and toggles it off on a second click', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('目标(箱)'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('cell-requirement-0-0')).toHaveTextContent('box')

  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('cell-requirement-0-0')).toHaveTextContent('none')
})

test('painting a box-goal on an empty cell does not create a box, and the level does not start won', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('目标(箱)'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.queryByTestId('box-at-0-0')).not.toBeInTheDocument()

  const { parseLevel } = await import('../game/engine/levelSchema')
  const { checkWin } = await import('../game/engine/rules')

  localStorage.clear()
  await user.type(screen.getByLabelText('关卡名称'), 'goal-level')
  await user.click(screen.getByText('储存'))
  const { listCustomLevels } = await import('../storage/progress')
  const world = parseLevel(JSON.parse(listCustomLevels().find((l) => l.id === 'goal-level')!.json))
  expect(checkWin(world)).toBe(false)
})

test('deleting a container box recursively deletes its interior board and everything inside it', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })

  await user.click(screen.getByLabelText('普通箱'))
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('piece-ids')).toHaveTextContent('box-1')

  await user.click(screen.getByText('外层'))
  await user.click(screen.getByLabelText('墙'))
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()

  expect(screen.getByTestId('board-ids')).toHaveTextContent('root')
  expect(screen.getByTestId('board-ids')).not.toHaveTextContent('board-0')
  expect(screen.getByTestId('piece-ids')).not.toHaveTextContent('box-0')
  expect(screen.getByTestId('piece-ids')).not.toHaveTextContent('box-1')
})

test('clicking two different cells in quick succession with container-box tool places boxes on both, not just the second', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  // Click cell (0,0), then click cell (1,0) rapidly, before the timer fires.
  // A stale-closure implementation would compute both placements against the
  // initial world, then commit them in order, silently dropping the first one
  // as the second overwrites it.
  fireEvent.click(canvas, { clientX: 5, clientY: 5 }) // cell (0,0)
  fireEvent.click(canvas, { clientX: 32 + 5, clientY: 5 }) // cell (1,0)
  await waitPastClickWindow()
  expect(screen.getByTestId('box-at-0-0')).toHaveTextContent('container')
  expect(screen.getByTestId('box-at-1-0')).toHaveTextContent('container')
  // Both should exist as separate boxes with different ids
  expect(screen.getByTestId('box-id-at-0-0')).toHaveTextContent('box-0')
  expect(screen.getByTestId('box-id-at-1-0')).toHaveTextContent('box-1')
})

test('clicking save stores the level in localStorage', async () => {
  localStorage.clear()
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('关卡名称'), 'my-level')
  await user.click(screen.getByText('储存'))
  const { listCustomLevels } = await import('../storage/progress')
  expect(listCustomLevels().map((l) => l.id)).toEqual(['my-level'])
})
