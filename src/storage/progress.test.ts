import { beforeEach, test, expect } from 'vitest'
import {
  deleteCustomLevel,
  isLevelComplete,
  listCompletedLevels,
  listCustomLevels,
  markLevelComplete,
  saveCustomLevel,
} from './progress'

beforeEach(() => {
  localStorage.clear()
})

test('markLevelComplete then isLevelComplete reflects it', () => {
  expect(isLevelComplete('01')).toBe(false)
  markLevelComplete('01')
  expect(isLevelComplete('01')).toBe(true)
})

test('listCompletedLevels returns all marked levels without duplicates', () => {
  markLevelComplete('01')
  markLevelComplete('02')
  markLevelComplete('01')
  expect(listCompletedLevels().sort()).toEqual(['01', '02'])
})

test('saveCustomLevel then listCustomLevels round-trips', () => {
  saveCustomLevel('my-level', '{"width":1}')
  expect(listCustomLevels()).toEqual([{ id: 'my-level', json: '{"width":1}' }])
})

test('deleteCustomLevel removes it', () => {
  saveCustomLevel('my-level', '{"width":1}')
  deleteCustomLevel('my-level')
  expect(listCustomLevels()).toEqual([])
})
