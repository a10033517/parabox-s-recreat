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

// Placement is delayed behind a short timer (see DOUBLE_CLICK_WINDOW_MS in
// EditorScreen.tsx) so a double-click's two `click` events can be cancelled before
// they place anything. Tests that place something via a single click and then
// immediately assert on it (or need the placement to exist before firing a
// double-click) must wait past that window first. Real timers are used
// deliberately — this file mixes `userEvent` and `fireEvent`, and fake timers can
// interfere with `userEvent`'s own internal timing.
const waitPastClickWindow = () => act(() => new Promise((resolve) => setTimeout(resolve, 260)))

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
})

test('double-clicking a container box enters its interior, breadcrumb shows the path', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow() // let the placement click resolve into an actual box-0 first
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByText('外层 > box-0')).toBeInTheDocument()
})

test('double-clicking with a different tool selected still enters the box instead of destroying it', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 }) // places container box at (0,0), gets id box-0
  await waitPastClickWindow() // let it actually resolve into a placed box before switching tools
  await user.click(screen.getByLabelText('墙')) // switch to a DIFFERENT, non-box tool
  // Simulate the actual event sequence a real double-click dispatches: click, click,
  // dblclick, fired in immediate succession (no wait between them) so they land
  // within the same pending-timer window and dblclick cancels it before it fires.
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
  await waitPastClickWindow() // let the placement click resolve into an actual box-0 first
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
