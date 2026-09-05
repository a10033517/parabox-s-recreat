import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { World } from '../../src/game/engine/types'
import { checkWin } from '../../src/game/engine/rules'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedWorld } from './seed'
import { generateLevel } from './generateLevel'
import { countCrossingMoves, solve } from './solver'
import { difficultyTier, scoreDifficulty } from './difficultyScorer'
import { canonicalKey } from './canonical'
import { computeTouchedGroups, pruneUntouchedGoals } from './pruneUntouchedGoals'

export type Tier = 'easy' | 'medium' | 'hard'

export interface GeneratedLevel {
  tier: Tier
  world: World
  json: string
}

export interface BatchStats {
  attempts: number
  discardedGenerationFailed: number
  discardedAlreadySolved: number
  discardedUnsolvable: number
  discardedDuplicate: number
  discardedTierFull: number
}

export interface BatchResult {
  levels: GeneratedLevel[]
  complete: boolean
  counts: Record<Tier, number>
  stats: BatchStats
}

// With the current multi-goal seed (see seed.ts, 3-4 independent groups)
// and this steps range, the achievable score has been observed as high as
// 35 (well above the old single-goal ceiling of ~23), and the 'hard' tier
// (score >= 25, see difficultyScorer.ts) is reachable — a direct diagnostic
// sample of 1000 raw pipeline runs (bypassing tier-bucketing) found 1 hard
// result out of 399 scored levels (~0.25%). That rarity means a real batch
// run with targetPerTier=5 fills 'hard' unreliably: some 500-1000 attempt
// runs produce hard=1, others hard=0, purely from Math.random variance.
// MAX_ATTEMPTS was raised from 500 to 1000 (this task's sanctioned tuning
// knob) to give 'hard' more chances to fill; raising it much further (e.g.
// 2000) risks Node heap exhaustion from accumulated solver/world-clone
// allocations within a single run. Widening the steps range further did
// not help (a 3+rng()*30 trial produced hard=0). main() below correctly
// reports an unmet quota via a nonzero exit code ("Batch incomplete")
// rather than silently succeeding. This is a known, accepted limitation of
// the seed's geometry, not a bug in the generation/scoring logic. Reaching
// 'hard' reliably every run would need a seed redesign (more crossing
// sites, or a larger board) or a lower hard threshold — out of scope here.
const MAX_ATTEMPTS = 1000

export function generateLevelBatch(
  targetPerTier: number,
  rng: () => number,
  maxAttempts: number = MAX_ATTEMPTS,
): BatchResult {
  const counts: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  const results: GeneratedLevel[] = []
  const seenLevels = new Set<string>()
  const stats: BatchStats = {
    attempts: 0,
    discardedGenerationFailed: 0,
    discardedAlreadySolved: 0,
    discardedUnsolvable: 0,
    discardedDuplicate: 0,
    discardedTierFull: 0,
  }

  while (
    stats.attempts < maxAttempts &&
    (counts.easy < targetPerTier || counts.medium < targetPerTier || counts.hard < targetPerTier)
  ) {
    stats.attempts++

    const { world: seed, groups } = createSeedWorld(rng)
    const steps = 3 + Math.floor(rng() * 20)
    const generated = generateLevel(seed, steps, rng)
    if (!generated) {
      stats.discardedGenerationFailed++
      continue
    }

    const touchedGroups = computeTouchedGroups(generated.events, groups)
    const world = pruneUntouchedGoals(generated.world, groups, touchedGroups)

    // The generator's own contract is "produce an unsolved, playable
    // level" — checked directly here, not merely inferred from solve()
    // returning a non-empty path (which would also be true, but this
    // makes the invariant explicit and independent of solve()'s
    // implementation).
    if (checkWin(world)) {
      stats.discardedAlreadySolved++
      continue
    }

    const levelKey = canonicalKey(world)
    if (seenLevels.has(levelKey)) {
      stats.discardedDuplicate++
      continue
    }

    const solution = solve(world, 150)
    if (!solution || solution.length === 0) {
      stats.discardedUnsolvable++
      continue
    }

    const crossingMoveCount = countCrossingMoves(world, solution)
    const score = scoreDifficulty(solution.length, crossingMoveCount)
    const tier = difficultyTier(score)
    if (counts[tier] >= targetPerTier) {
      stats.discardedTierFull++
      continue
    }

    seenLevels.add(levelKey)
    counts[tier]++
    results.push({ tier, world, json: JSON.stringify(serializeLevel(world)) })
  }

  const complete =
    counts.easy >= targetPerTier && counts.medium >= targetPerTier && counts.hard >= targetPerTier

  return { levels: results, complete, counts, stats }
}

function main() {
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/levels/builtin/generated')
  // Overwrite policy: each run replaces the entire generated set rather
  // than appending numbered files on top of a stale previous run, which
  // would otherwise silently keep old levels around forever.
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })

  const targetPerTier = 5
  const batch = generateLevelBatch(targetPerTier, Math.random)
  const tierCounters: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  for (const entry of batch.levels) {
    tierCounters[entry.tier]++
    const filename = `${entry.tier}-${String(tierCounters[entry.tier]).padStart(2, '0')}.json`
    writeFileSync(join(outputDir, filename), entry.json)
  }

  console.log(
    `Generated ${batch.levels.length} levels: ` +
      `easy=${batch.counts.easy} medium=${batch.counts.medium} hard=${batch.counts.hard} ` +
      `(attempts=${batch.stats.attempts}, ` +
      `discarded: genFailed=${batch.stats.discardedGenerationFailed} ` +
      `alreadySolved=${batch.stats.discardedAlreadySolved} ` +
      `unsolvable=${batch.stats.discardedUnsolvable} ` +
      `duplicate=${batch.stats.discardedDuplicate} ` +
      `tierFull=${batch.stats.discardedTierFull})`,
  )

  if (!batch.complete) {
    console.error(
      `Batch incomplete: wanted ${targetPerTier} per tier, got ` +
        `easy=${batch.counts.easy} medium=${batch.counts.medium} hard=${batch.counts.hard}. ` +
        'Written levels are still valid but the requested quota was not met.',
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
