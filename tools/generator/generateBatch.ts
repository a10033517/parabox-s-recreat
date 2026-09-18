import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { World } from '../../src/game/engine/types'
import { checkWin } from '../../src/game/engine/rules'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { randomGenerate } from './randomGenerator'
import { basicValidate } from './basicValidator'
import { DifficultyVector, analyze } from './difficultyAnalyzer'
import { Tier, classifyTier } from './filter'
import { canonicalKey } from './canonical'
import { solve } from './solver'
import { GENERATOR_CONFIG, GeneratorConfig } from './generatorConfig'

export type { Tier }

export interface GeneratedLevel {
  tier: Tier
  world: World
  json: string
}

export interface BatchStats {
  attempts: number
  discardedGenerationFailed: number
  discardedInvalid: number
  discardedAlreadySolved: number
  discardedUnsolvable: number
  discardedDuplicate: number
  discardedTierFull: number
  discardedTierReject: number
}

export interface BatchResult {
  levels: GeneratedLevel[]
  complete: boolean
  counts: Record<Tier, number>
  stats: BatchStats
  hardCandidatesFound: number
}

export interface HardCandidate {
  world: World
  json: string
  vector: DifficultyVector
  score: number
}

function scoreDifficulty(vector: DifficultyVector): number {
  return (
    vector.solutionLength +
    vector.criticalDecisions * 5 +
    vector.avgBranching * 3 +
    Math.log2(vector.expandedStates + 1) * 2 +
    (vector.nestedBoxRequired ? 10 : 0)
  )
}

export function profileDistance(a: DifficultyVector, b: DifficultyVector): number {
  const term = (x: number, y: number, scale: number) => Math.abs(x - y) / scale
  return (
    term(a.solutionLength, b.solutionLength, 20) +
    term(a.criticalDecisions, b.criticalDecisions, 3) +
    term(a.avgBranching, b.avgBranching, 2) +
    term(a.expandedStates, b.expandedStates, 5000) +
    term(a.spaceTransitions, b.spaceTransitions, 3)
  )
}

export function selectDiverseTopN(
  candidates: HardCandidate[],
  n: number,
  diversityWeight: number = GENERATOR_CONFIG.diversityWeight,
): HardCandidate[] {
  const remaining = [...candidates]
  const selected: HardCandidate[] = []
  while (selected.length < n && remaining.length > 0) {
    let bestIndex = 0
    let bestValue = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const diversityBonus =
        selected.length === 0
          ? 0
          : Math.min(...selected.map((chosen) => profileDistance(chosen.vector, candidate.vector)))
      const value = candidate.score + diversityWeight * diversityBonus
      if (value > bestValue) { bestValue = value; bestIndex = i }
    }
    selected.push(remaining[bestIndex])
    remaining.splice(bestIndex, 1)
  }
  return selected
}

export function generateLevelBatch(
  targetPerTier: number,
  rng: () => number,
  maxAttempts: number = GENERATOR_CONFIG.maxAttempts,
  config: GeneratorConfig = GENERATOR_CONFIG,
): BatchResult {
  const counts: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  const results: GeneratedLevel[] = []
  const seenLevels = new Set<string>()
  const hardCandidates: HardCandidate[] = []
  const hardPoolTarget = config.hardCandidatePoolSize
  const stats: BatchStats = {
    attempts: 0, discardedGenerationFailed: 0, discardedInvalid: 0,
    discardedAlreadySolved: 0, discardedUnsolvable: 0, discardedDuplicate: 0,
    discardedTierFull: 0, discardedTierReject: 0,
  }

  while (
    stats.attempts < maxAttempts &&
    (counts.easy < targetPerTier || counts.medium < targetPerTier || hardCandidates.length < hardPoolTarget)
  ) {
    stats.attempts++
    const generated = randomGenerate(config.generator, rng)
    if (!generated) { stats.discardedGenerationFailed++; continue }
    const { world } = generated

    const validation = basicValidate(world, config.generator.maxNestingDepth)
    if (!validation.valid) { stats.discardedInvalid++; continue }

    if (checkWin(world)) { stats.discardedAlreadySolved++; continue }

    const levelKey = canonicalKey(world)
    if (seenLevels.has(levelKey)) { stats.discardedDuplicate++; continue }

    const solved = solve(world, config.maxSolveDepth, config.maxSolverExpandedStates)
    if (!solved || solved.moves.length === 0) { stats.discardedUnsolvable++; continue }

    const vector = analyze(world, solved, config.maxSolverExpandedStates)
    const tier = classifyTier(vector, config.tiers)
    if (tier === 'reject') { stats.discardedTierReject++; continue }

    if (tier === 'hard') {
      if (hardCandidates.length >= hardPoolTarget) { stats.discardedTierFull++; continue }
      seenLevels.add(levelKey)
      hardCandidates.push({ world, json: JSON.stringify(serializeLevel(world)), vector, score: scoreDifficulty(vector) })
      continue
    }

    if (counts[tier] >= targetPerTier) { stats.discardedTierFull++; continue }
    seenLevels.add(levelKey)
    counts[tier]++
    results.push({ tier, world, json: JSON.stringify(serializeLevel(world)) })
  }

  for (const candidate of selectDiverseTopN(hardCandidates, targetPerTier, config.diversityWeight)) {
    counts.hard++
    results.push({ tier: 'hard', world: candidate.world, json: candidate.json })
  }

  const complete = counts.easy >= targetPerTier && counts.medium >= targetPerTier && counts.hard >= targetPerTier
  return { levels: results, complete, counts, stats, hardCandidatesFound: hardCandidates.length }
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
      `(hardCandidatesFound=${batch.hardCandidatesFound}, attempts=${batch.stats.attempts}, ` +
      `discarded: genFailed=${batch.stats.discardedGenerationFailed} ` +
      `invalid=${batch.stats.discardedInvalid} ` +
      `alreadySolved=${batch.stats.discardedAlreadySolved} ` +
      `unsolvable=${batch.stats.discardedUnsolvable} ` +
      `duplicate=${batch.stats.discardedDuplicate} ` +
      `tierFull=${batch.stats.discardedTierFull} ` +
      `tierReject=${batch.stats.discardedTierReject})`,
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
