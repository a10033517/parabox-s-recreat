import { beforeEach, expect, test, vi } from 'vitest'
import { BUILTIN_LEVELS, CUSTOM_LEVEL_ID_PREFIX, loadCustomLevels, loadGeneratedLevels } from './index'
import { checkWin } from '../game/engine/rules'
import { createEmptyGrid } from '../game/engine/types'
import { serializeLevel } from '../game/engine/levelSchema'
import { saveCustomLevel } from '../storage/progress'

beforeEach(() => {
  localStorage.clear()
})

test('every builtin level parses and starts unsolved', () => {
  expect(BUILTIN_LEVELS).toHaveLength(3)
  for (const level of BUILTIN_LEVELS) {
    expect(level.grid.player).toBeDefined()
    expect(checkWin(level.grid)).toBe(false)
  }
})

test('loadCustomLevels returns a saved level under a prefixed id and its stored name', () => {
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 0, y: 0 }
  saveCustomLevel('my-level', serializeLevel(grid))

  const levels = loadCustomLevels()
  expect(levels).toHaveLength(1)
  expect(levels[0].id).toBe(`${CUSTOM_LEVEL_ID_PREFIX}my-level`)
  expect(levels[0].name).toBe('my-level')
  expect(levels[0].grid.width).toBe(3)
})

test('loadCustomLevels skips malformed entries instead of throwing', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  saveCustomLevel('broken', '{ not json')
  saveCustomLevel('good', serializeLevel(createEmptyGrid(2, 2)))

  const levels = loadCustomLevels()
  expect(levels.map((l) => l.name)).toEqual(['good'])
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

test('custom level ids never collide with builtin or generated ids', () => {
  const shipped = new Set([...BUILTIN_LEVELS, ...loadGeneratedLevels()].map((l) => l.id))
  saveCustomLevel('easy-01', serializeLevel(createEmptyGrid(2, 2)))
  for (const level of loadCustomLevels()) {
    expect(shipped.has(level.id)).toBe(false)
  }
})

test('every generated level starts unsolved', () => {
  const levels = loadGeneratedLevels()
  expect(levels.length).toBeGreaterThan(0)
  for (const level of levels) {
    expect(level.grid.player).toBeDefined()
    expect(checkWin(level.grid)).toBe(false)
  }
})
