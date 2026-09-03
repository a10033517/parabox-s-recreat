import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LevelSelect } from './LevelSelect'
import { makeFloorBoard, makeWorld } from '../game/engine/testFixtures'
import { PLAYER_ID } from '../game/engine/types'

function tinyWorld() {
  return makeWorld(
    [makeFloorBoard('root', 1)],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
}

test('lists levels and marks completed ones', () => {
  const levels = [
    { id: 'a', name: '关卡 A', world: tinyWorld() },
    { id: 'b', name: '关卡 B', world: tinyWorld() },
  ]
  render(<LevelSelect levels={levels} completedIds={['a']} onSelect={() => {}} onBack={() => {}} />)
  expect(screen.getByText('关卡 A ✓')).toBeInTheDocument()
  expect(screen.getByText('关卡 B')).toBeInTheDocument()
})

test('clicking a level calls onSelect with it', async () => {
  const levels = [{ id: 'a', name: '关卡 A', world: tinyWorld() }]
  const onSelect = vi.fn()
  render(<LevelSelect levels={levels} completedIds={[]} onSelect={onSelect} onBack={() => {}} />)
  await userEvent.setup().click(screen.getByText('关卡 A'))
  expect(onSelect).toHaveBeenCalledWith(levels[0])
})
