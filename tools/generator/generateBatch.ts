import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { Grid } from '../../src/game/engine/types'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedGrid } from './seed'
import { generateLevel } from './generateLevel'
import { countNestingEvents, solve } from './solver'
import { difficultyTier, scoreDifficulty } from './difficultyScorer'

export type Tier = 'easy' | 'medium' | 'hard'

export interface GeneratedLevel {
  tier: Tier
  grid: Grid
  json: string
}

const MAX_ATTEMPTS = 500

export function generateLevelBatch(targetPerTier: number, rng: () => number): GeneratedLevel[] {
  const counts: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  const results: GeneratedLevel[] = []
  let attempts = 0

  while (attempts < MAX_ATTEMPTS && (counts.easy < targetPerTier || counts.medium < targetPerTier || counts.hard < targetPerTier)) {
    attempts++
    const seed = createSeedGrid()
    const steps = 3 + Math.floor(rng() * 8)
    const grid = generateLevel(seed, steps, rng)
    const solution = solve(grid, 150)
    if (!solution) continue

    const nestingCount = countNestingEvents(grid, solution)
    const score = scoreDifficulty(solution.length, nestingCount)
    const tier = difficultyTier(score)
    if (counts[tier] >= targetPerTier) continue

    counts[tier]++
    results.push({ tier, grid, json: serializeLevel(grid) })
  }

  return results
}

function main() {
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/levels/builtin/generated')
  mkdirSync(outputDir, { recursive: true })
  const batch = generateLevelBatch(5, Math.random)
  const tierCounters: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  for (const entry of batch) {
    tierCounters[entry.tier]++
    const filename = `${entry.tier}-${String(tierCounters[entry.tier]).padStart(2, '0')}.json`
    writeFileSync(join(outputDir, filename), entry.json)
  }
  console.log(`Generated ${batch.length} levels: easy=${tierCounters.easy} medium=${tierCounters.medium} hard=${tierCounters.hard}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
