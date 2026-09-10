import { checkWin } from '../../src/game/engine/rules'
import { parseLevel } from '../../src/game/engine/levelSchema'
import { canonicalKey } from './canonical'
import { World } from '../../src/game/engine/types'
import {
  DifficultyProfile, HardCandidate, generateLevelBatch, profileDistance, selectDiverseTopN,
} from './generateBatch'

function seededRng(startSeed: number): () => number {
  let s = startSeed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s % 10000) / 10000
  }
}

test('generateLevelBatch reports whether it actually met its tier quotas', () => {
  const result = generateLevelBatch(1, seededRng(42), 20)
  if (result.complete) {
    expect(result.counts.easy).toBeGreaterThanOrEqual(1)
    expect(result.counts.medium).toBeGreaterThanOrEqual(1)
    expect(result.counts.hard).toBeGreaterThanOrEqual(1)
  } else {
    expect(result.counts.easy < 1 || result.counts.medium < 1 || result.counts.hard < 1).toBe(true)
  }
})

test('every accepted level is unsolved and parses back through parseLevel', () => {
  const result = generateLevelBatch(1, seededRng(42), 20)
  expect(result.levels.length).toBeGreaterThan(0)
  for (const entry of result.levels) {
    const parsed = parseLevel(JSON.parse(entry.json))
    expect(checkWin(parsed)).toBe(false)
  }
})

test('no two accepted levels in one batch share a canonical state', () => {
  const result = generateLevelBatch(2, seededRng(7), 20)
  const keys = result.levels.map((entry) => canonicalKey(entry.world))
  expect(new Set(keys).size).toBe(keys.length)
})

test('batch stats account for every attempt', () => {
  const result = generateLevelBatch(1, seededRng(99), 20)
  const accountedFor =
    result.levels.length +
    result.stats.discardedGenerationFailed +
    result.stats.discardedAlreadySolved +
    result.stats.discardedUnsolvable +
    result.stats.discardedDuplicate +
    result.stats.discardedTierFull +
    // Hard candidates that made it into the pool but were not among the
    // final selected set are still "accounted for" via hardCandidatesFound
    // rather than results.length, since selection discards some on purpose.
    Math.max(0, result.hardCandidatesFound - result.counts.hard)
  expect(accountedFor).toBe(result.stats.attempts)
})

test('hardCandidatesFound reflects the pool size independent of how many were finally selected', () => {
  const result = generateLevelBatch(1, seededRng(7), 20)
  expect(result.hardCandidatesFound).toBeGreaterThanOrEqual(result.counts.hard)
})

function makeCandidate(profile: DifficultyProfile, score: number): HardCandidate {
  const world: World = {
    boards: { root: { id: 'root', size: 1, cells: [[{ type: 'floor' }]] } },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 0, y: 0 } },
  }
  return { world, json: '{}', profile, score }
}

test('profileDistance is 0 for identical profiles and positive for a differing one', () => {
  const a: DifficultyProfile = { moveCount: 20, crossingMoveCount: 1, eatCount: 2, survivingGroupCount: 2, groupsUsed: 2, expandedStates: 500, pushMoveCount: 0 }
  expect(profileDistance(a, a)).toBe(0)
  const b: DifficultyProfile = { ...a, eatCount: 5 }
  expect(profileDistance(a, b)).toBeGreaterThan(0)
})

test('selectDiverseTopN prefers a lower-scoring but structurally distinct candidate over a near-duplicate', () => {
  const highA = makeCandidate({ moveCount: 30, crossingMoveCount: 3, eatCount: 3, survivingGroupCount: 2, groupsUsed: 2, expandedStates: 1000, pushMoveCount: 0 }, 50)
  const highB = makeCandidate({ moveCount: 31, crossingMoveCount: 3, eatCount: 3, survivingGroupCount: 2, groupsUsed: 2, expandedStates: 1010, pushMoveCount: 0 }, 49)
  const distinct = makeCandidate({ moveCount: 20, crossingMoveCount: 0, eatCount: 2, survivingGroupCount: 4, groupsUsed: 4, expandedStates: 200, pushMoveCount: 0 }, 40)

  const selected = selectDiverseTopN([highA, highB, distinct], 2)
  expect(selected).toHaveLength(2)
  expect(selected[0]).toBe(highA) // highest raw score picked first
  expect(selected[1]).toBe(distinct) // distinct beats the near-duplicate highB
})

test('selectDiverseTopN always fills up to min(n, candidates.length) even when every candidate is similar', () => {
  const candidates = [
    makeCandidate({ moveCount: 20, crossingMoveCount: 1, eatCount: 2, survivingGroupCount: 2, groupsUsed: 2, expandedStates: 100, pushMoveCount: 0 }, 30),
    makeCandidate({ moveCount: 21, crossingMoveCount: 1, eatCount: 2, survivingGroupCount: 2, groupsUsed: 2, expandedStates: 100, pushMoveCount: 0 }, 29),
    makeCandidate({ moveCount: 22, crossingMoveCount: 1, eatCount: 2, survivingGroupCount: 2, groupsUsed: 2, expandedStates: 100, pushMoveCount: 0 }, 28),
  ]
  expect(selectDiverseTopN(candidates, 5)).toHaveLength(3)
  expect(selectDiverseTopN(candidates, 2)).toHaveLength(2)
})
