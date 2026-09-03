import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  localStorage.clear()
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
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

test('a saved custom level does not appear yet (loading is deferred to a future sub-project)', async () => {
  const { saveCustomLevel } = await import('./storage/progress')
  saveCustomLevel('我的关卡', 'irrelevant in the new format')
  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.queryByText('我的关卡')).not.toBeInTheDocument()
})

test('a corrupt completed-levels value does not white-screen level select', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  localStorage.setItem('parabox:completedLevels', 'not valid json')
  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.getByText('第一次推动')).toBeInTheDocument()
})

test('the broken editor screen fails gracefully instead of crashing the whole app', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<App />)
  await userEvent.setup().click(screen.getByText('关卡编辑器'))
  expect(await screen.findByText('关卡编辑器暂时无法使用')).toBeInTheDocument()
  await userEvent.setup().click(screen.getByText('返回'))
  expect(screen.getByText('Parabox Tribute')).toBeInTheDocument()
})
