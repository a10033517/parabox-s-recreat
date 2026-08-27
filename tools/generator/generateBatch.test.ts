import { solve } from './solver'
import { checkWin } from '../../src/game/engine/rules'
import { parseLevel } from '../../src/game/engine/levelSchema'
import { generateLevelBatch } from './generateBatch'

function seededRng(startSeed: number): () => number {
  let s = startSeed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s % 10000) / 10000
  }
}

test('generateLevelBatch produces at least one solvable level per tier within a bounded attempt count', () => {
  const result = generateLevelBatch(1, seededRng(42))
  expect(result.length).toBeGreaterThan(0)
  for (const entry of result) {
    const grid = parseLevel(entry.json)
    const solution = solve(grid, 100)
    expect(solution).not.toBeNull()
    expect(solution!.length).toBeGreaterThan(0)
  }
})

test('generateLevelBatch never emits a level that is already won on load', () => {
  const result = generateLevelBatch(2, seededRng(99))
  expect(result.length).toBeGreaterThan(0)
  for (const entry of result) {
    expect(checkWin(parseLevel(entry.json))).toBe(false)
  }
})

test('every produced level JSON round-trips through parseLevel', () => {
  const result = generateLevelBatch(1, seededRng(7))
  for (const entry of result) {
    expect(() => parseLevel(entry.json)).not.toThrow()
  }
})
