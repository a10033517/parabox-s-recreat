import { describe, it, expect } from 'vitest'
import { GameState } from './GameState'
import { makeFloorBoard, makeWorld, setRequirement } from './testFixtures'
import { PLAYER_ID } from './types'

function simpleWorld() {
  return makeWorld(
    [makeFloorBoard('root', 3)],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
}

describe('GameState', () => {
  it('starts at the initial world', () => {
    const world = simpleWorld()
    const state = new GameState(world)
    expect(state.current).toEqual(world)
  })

  it('applies a successful move and updates current', () => {
    const state = new GameState(simpleWorld())
    const ok = state.move('right')
    expect(ok).toBe(true)
    expect(state.current.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
  })

  it('leaves current unchanged when the move is illegal', () => {
    const world = simpleWorld()
    const state = new GameState(world)
    const ok = state.move('left') // x=0, moving left goes out of bounds with no container
    expect(ok).toBe(false)
    expect(state.current).toEqual(world)
  })

  it('undoes the most recent move', () => {
    const state = new GameState(simpleWorld())
    state.move('right')
    const ok = state.undo()
    expect(ok).toBe(true)
    expect(state.current.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 0 })
  })

  it('fails to undo past the initial state', () => {
    const state = new GameState(simpleWorld())
    expect(state.undo()).toBe(false)
  })

  it('reports isWon based on the current state', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'player')
    const world = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    const state = new GameState(world)
    expect(state.isWon).toBe(false)
    state.move('right')
    expect(state.isWon).toBe(true)
  })
})
