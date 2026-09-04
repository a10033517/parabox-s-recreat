import { checkWin } from '../../src/game/engine/rules'
import { parseLevel } from '../../src/game/engine/levelSchema'
import { canonicalKey } from './canonical'
import { generateLevelBatch } from './generateBatch'

function seededRng(startSeed: number): () => number {
  let s = startSeed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s % 10000) / 10000
  }
}

test('generateLevelBatch reports whether it actually met its tier quotas', () => {
  const result = generateLevelBatch(1, seededRng(42))
  if (result.complete) {
    expect(result.counts.easy).toBeGreaterThanOrEqual(1)
    expect(result.counts.medium).toBeGreaterThanOrEqual(1)
    expect(result.counts.hard).toBeGreaterThanOrEqual(1)
  } else {
    expect(result.counts.easy < 1 || result.counts.medium < 1 || result.counts.hard < 1).toBe(true)
  }
})

test('every accepted level is unsolved and parses back through parseLevel', () => {
  const result = generateLevelBatch(1, seededRng(42))
  expect(result.levels.length).toBeGreaterThan(0)
  for (const entry of result.levels) {
    const parsed = parseLevel(JSON.parse(entry.json))
    expect(checkWin(parsed)).toBe(false)
  }
})

test('no two accepted levels in one batch share a canonical state', () => {
  const result = generateLevelBatch(2, seededRng(7))
  const keys = result.levels.map((entry) => canonicalKey(entry.world))
  expect(new Set(keys).size).toBe(keys.length)
})

test('batch stats account for every attempt', () => {
  const result = generateLevelBatch(1, seededRng(99))
  const accountedFor =
    result.levels.length +
    result.stats.discardedGenerationFailed +
    result.stats.discardedAlreadySolved +
    result.stats.discardedUnsolvable +
    result.stats.discardedDuplicate +
    result.stats.discardedTierFull
  expect(accountedFor).toBe(result.stats.attempts)
})
