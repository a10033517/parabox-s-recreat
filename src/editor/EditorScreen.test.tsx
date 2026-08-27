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
// 260ms is enough to clear the current 250ms DOUBLE_CLICK_WINDOW_MS, but round 1's
// REJECTED debounce approach used a 400ms window — so a 260ms wait would have stayed
// green even under that broken implementation and wouldn't actually prove anything
// about which approach is in place. Use a wait that exceeds any plausible debounce
// window so this test can only pass under an implementation that doesn't depend on
// the gap's length at all (the current cancel-on-double-click timer).
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
  await waitLongerThanAnyDebounceWindow() // let it actually resolve into a placed box before switching tools
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

test('clicking two different cells in quick succession places on both, not just the second', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('墙'))
  const canvas = screen.getByTestId('editor-canvas')
  // Click cell (0,0), then click cell (1,0) rapidly afterward, BEFORE (0,0)'s pending
  // placement timer has had a chance to fire. A globally-keyed pending timer would
  // cancel (0,0)'s placement here and silently drop it, leaving only (1,0) placed.
  fireEvent.click(canvas, { clientX: 5, clientY: 5 }) // cell (0,0)
  fireEvent.click(canvas, { clientX: 32 + 5, clientY: 5 }) // cell (1,0), no wait first
  await waitPastClickWindow() // let whatever is still pending resolve
  expect(screen.getByTestId('cell-type-0-0')).toHaveTextContent('wall')
  expect(screen.getByTestId('cell-type-1-0')).toHaveTextContent('wall')
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
