import { afterEach, beforeEach, test, expect, vi } from 'vitest'
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

afterEach(() => {
  vi.restoreAllMocks()
})

test('listCompletedLevels returns [] instead of throwing on a corrupt stored value', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  localStorage.setItem('parabox:completedLevels', 'not valid json')
  expect(() => listCompletedLevels()).not.toThrow()
  expect(listCompletedLevels()).toEqual([])
  expect(warn).toHaveBeenCalled()
})

test('isLevelComplete survives a corrupt stored value', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  localStorage.setItem('parabox:completedLevels', '{oops')
  expect(isLevelComplete('01')).toBe(false)
})

test('listCustomLevels returns [] instead of throwing on a corrupt stored value', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  localStorage.setItem('parabox:customLevels', 'not valid json')
  expect(() => listCustomLevels()).not.toThrow()
  expect(listCustomLevels()).toEqual([])
  expect(warn).toHaveBeenCalled()
})

test('markLevelComplete does not throw when setItem fails (quota exceeded)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  expect(() => markLevelComplete('01')).not.toThrow()
  expect(warn).toHaveBeenCalled()
})

test('saveCustomLevel does not throw when setItem fails (quota exceeded)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  expect(() => saveCustomLevel('my-level', '{"width":1}')).not.toThrow()
  expect(warn).toHaveBeenCalled()
})
