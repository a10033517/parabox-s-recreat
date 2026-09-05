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

const MAX_ATTEMPTS = 500

export function generateLevelBatch(targetPerTier: number, rng: () => number): BatchResult {
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
    stats.attempts < MAX_ATTEMPTS &&
    (counts.easy < targetPerTier || counts.medium < targetPerTier || counts.hard < targetPerTier)
  ) {
    stats.attempts++

    const seed = createSeedWorld()
    const steps = 3 + Math.floor(rng() * 20)
    const generated = generateLevel(seed, steps, rng)
    if (!generated) {
      stats.discardedGenerationFailed++
      continue
    }
    const { world } = generated

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
