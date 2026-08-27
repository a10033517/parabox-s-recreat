import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorScreen } from './EditorScreen'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({ left: 0, top: 0 }) as unknown as typeof HTMLCanvasElement.prototype.getBoundingClientRect
})

test('selecting the wall tool then clicking the canvas places a wall cell', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('墙'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 32 + 5, clientY: 5 })
  expect(screen.getByTestId('cell-type-1-0')).toHaveTextContent('wall')
})

test('selecting the container box tool then clicking places a container box', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByTestId('box-at-0-0')).toHaveTextContent('container')
})

test('double-clicking a container box enters its interior, breadcrumb shows the path', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByText('外层 > box-0')).toBeInTheDocument()
})

test('double-clicking with a different tool selected still enters the box instead of destroying it', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 }) // places container box at (0,0), gets id box-0
  await user.click(screen.getByLabelText('墙')) // switch to a DIFFERENT, non-box tool
  // Simulate the actual event sequence a real double-click dispatches: click, click, dblclick.
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
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  await user.click(screen.getByText('外层'))
  expect(screen.queryByText(/外层 > /)).not.toBeInTheDocument()
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
