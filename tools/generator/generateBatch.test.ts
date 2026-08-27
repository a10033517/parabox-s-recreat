import { solve } from './solver'
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
    expect(solve(grid, 100)).not.toBeNull()
  }
})

test('every produced level JSON round-trips through parseLevel', () => {
  const result = generateLevelBatch(1, seededRng(7))
  for (const entry of result) {
    expect(() => parseLevel(entry.json)).not.toThrow()
  }
})
