import { createEmptyGrid } from './types'
import { createGameState, currentGrid, move, undo, isWon } from './GameState'

function simpleGrid() {
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 1, y: 1 }
  return grid
}

test('move updates current grid and appends history', () => {
  let state = createGameState(simpleGrid())
  state = move(state, 'right')
  expect(currentGrid(state).player).toEqual({ x: 2, y: 1 })
  expect(state.history).toHaveLength(2)
})

test('invalid move leaves state unchanged', () => {
  let state = createGameState(simpleGrid())
  state = move(state, 'right')
  state = move(state, 'right') // 撞边界
  expect(currentGrid(state).player).toEqual({ x: 2, y: 1 })
  expect(state.history).toHaveLength(2)
})

test('undo restores previous grid', () => {
  let state = createGameState(simpleGrid())
  state = move(state, 'right')
  state = undo(state)
  expect(currentGrid(state).player).toEqual({ x: 1, y: 1 })
})

test('undo on initial state is a no-op', () => {
  let state = createGameState(simpleGrid())
  state = undo(state)
  expect(state.history).toHaveLength(1)
})

test('isWon reflects checkWin on current grid', () => {
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 0, y: 0 }
  grid.cells[1][1] = 'target'
  grid.boxes.push({ id: 'g1', x: 1, y: 1, boxType: 'normal', interior: createEmptyGrid(1, 1), isGoalBox: true })
  const state = createGameState(grid)
  expect(isWon(state)).toBe(true)
})
