import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  localStorage.clear()
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

test('renders the menu screen by default', () => {
  render(<App />)
  expect(screen.getByText('Parabox Tribute')).toBeInTheDocument()
})

test('navigating from menu to level select shows builtin levels', async () => {
  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.getByText('第一次推动')).toBeInTheDocument()
})

test('a saved custom level appears in level select', async () => {
  const { saveCustomLevel } = await import('./storage/progress')
  const { serializeLevel } = await import('./game/engine/levelSchema')
  const { createEmptyGrid } = await import('./game/engine/types')
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 0, y: 0 }
  saveCustomLevel('我的关卡', serializeLevel(grid))

  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.getByText('我的关卡')).toBeInTheDocument()
})

test('a malformed custom level does not break the level list', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { saveCustomLevel } = await import('./storage/progress')
  saveCustomLevel('broken', 'not json at all')

  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.getByText('第一次推动')).toBeInTheDocument()
  expect(screen.queryByText('broken')).not.toBeInTheDocument()
})

test('a corrupt completed-levels value does not white-screen level select', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  localStorage.setItem('parabox:completedLevels', 'not valid json')

  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.getByText('第一次推动')).toBeInTheDocument()
})
