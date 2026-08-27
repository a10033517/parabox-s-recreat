import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LevelSelect } from './LevelSelect'
import { createEmptyGrid } from '../game/engine/types'

test('lists levels and marks completed ones', () => {
  const levels = [
    { id: 'a', name: '关卡 A', grid: createEmptyGrid(1, 1) },
    { id: 'b', name: '关卡 B', grid: createEmptyGrid(1, 1) },
  ]
  render(<LevelSelect levels={levels} completedIds={['a']} onSelect={() => {}} onBack={() => {}} />)
  expect(screen.getByText('关卡 A ✓')).toBeInTheDocument()
  expect(screen.getByText('关卡 B')).toBeInTheDocument()
})

test('clicking a level calls onSelect with it', async () => {
  const levels = [{ id: 'a', name: '关卡 A', grid: createEmptyGrid(1, 1) }]
  const onSelect = vi.fn()
  render(<LevelSelect levels={levels} completedIds={[]} onSelect={onSelect} onBack={() => {}} />)
  await userEvent.setup().click(screen.getByText('关卡 A'))
  expect(onSelect).toHaveBeenCalledWith(levels[0])
})
