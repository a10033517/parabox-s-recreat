import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GameScreen } from './GameScreen'
import { makeFloorBoard, makeWorld, setRequirement, setWall } from './engine/testFixtures'
import { PLAYER_ID } from './engine/types'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

function simpleWorld() {
  return makeWorld(
    [makeFloorBoard('root', 3)],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
}

test('pressing a DPad button increments the step counter', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 1')).toBeInTheDocument()
})

test('undo button decrements the step counter', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByText('复位上一步'))
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
})

test('entering a container swaps the rendered board and resizes the canvas', async () => {
  const root = makeFloorBoard('root', 3)
  setWall(root, 2, 1) // block the container from being pushed, forcing entry instead
  const inside = makeFloorBoard('inside', 5)
  const world = makeWorld(
    [root, inside],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'containerBox', kind: 'container', boardRef: 'inside' },
    ],
    {
      [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
      containerBox: { board: 'root', x: 1, y: 1 },
    },
  )
  const { container } = render(<GameScreen initialWorld={world} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  const canvas = container.querySelector('canvas')!
  expect(canvas.width).toBe(5 * 32) // 'inside' is size 5, CELL_SIZE is 32
})

test('reaching the win condition calls onWin exactly once', async () => {
  const root = makeFloorBoard('root', 2)
  setRequirement(root, 1, 0, 'player')
  const world = makeWorld(
    [root],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
  const onWin = vi.fn()
  render(<GameScreen initialWorld={world} onExit={() => {}} onWin={onWin} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  expect(onWin).toHaveBeenCalledTimes(1)
})

test('undoing out of a won state allows onWin to fire again on re-winning', async () => {
  const root = makeFloorBoard('root', 2)
  setRequirement(root, 1, 0, 'player')
  const world = makeWorld(
    [root],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
  const onWin = vi.fn()
  render(<GameScreen initialWorld={world} onExit={() => {}} onWin={onWin} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右')) // win
  expect(onWin).toHaveBeenCalledTimes(1)
  await user.click(screen.getByText('复位上一步')) // undo out of the win
  await user.click(screen.getByLabelText('右')) // re-win
  expect(onWin).toHaveBeenCalledTimes(2)
})

test('a move that removes the player shows a lost notice, and its button recovers via undo', async () => {
  const root = makeFloorBoard('root', 2)
  const world = makeWorld(
    [root],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'loopBox', kind: 'container', boardRef: 'root' },
    ],
    {
      [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
      loopBox: { board: 'root', x: 0, y: 0 },
    },
  )
  render(<GameScreen initialWorld={world} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('左'))
  const notice = screen.getByTestId('lose-notice')
  expect(within(notice).getByText('玩家迷失在无限递归中')).toBeInTheDocument()

  await user.click(within(notice).getByText('复位上一步'))
  expect(screen.queryByTestId('lose-notice')).not.toBeInTheDocument()
})
