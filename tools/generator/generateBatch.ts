import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { World } from '../../src/game/engine/types'
import { checkWin } from '../../src/game/engine/rules'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedWorld } from './seed'
import { generateLevel } from './generateLevel'
import { countCrossingMoves, countEatMoves, countGroupsUsed, solve } from './solver'
import {
  DifficultyMetrics, checkHardRequirements, difficultyTier, scoreDifficulty,
} from './difficultyScorer'
import { canonicalKey } from './canonical'
import { getSurvivingGroups, isGroupUntouched, pruneUntouchedGoals } from './pruneUntouchedGoals'
import { trimUnusedCells } from './trimUnusedCells'
import { GENERATOR_CONFIG } from './generatorConfig'

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
  rejectedTooShort: number
  rejectedTooFewEats: number
  rejectedNotEnoughSurvivingGroups: number
  rejectedTooFewGroupsUsed: number
  rejectedTooLowScore: number
}

export interface BatchResult {
  levels: GeneratedLevel[]
  complete: boolean
  counts: Record<Tier, number>
  stats: BatchStats
  hardCandidatesFound: number
}

export interface DifficultyProfile {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  survivingGroupCount: number
  groupsUsed: number
  expandedStates: number
}

export interface HardCandidate {
  world: World
  json: string
  profile: DifficultyProfile
  score: number
}

// Tuning history: MAX_ATTEMPTS was 500, then raised to 1000 in sub-project
// 4b, then 2000 in this redesign's own diagnostic pass (section 12): the
// real hard-candidate rate is rare (roughly 0.5-1% of attempts, high
// run-to-run variance) even under the hard-biased seed profile — see
// generatorConfig.ts's own comment on the retuned `hard` thresholds.
// Raised again to 5000 after adding directionSeekWeights (generateLevel.ts)
// — a real 2000-attempt run found anywhere from 0 to 13 hard candidates
// depending on rng luck, so a bigger budget buys more consistent odds of
// clearing targetPerTier(5). At the diagnosed ~100-200ms/attempt this costs
// on the order of 10-15 minutes of wall-clock for the one-off generation
// script, not shipped runtime code.
const MAX_ATTEMPTS = 5000

export function profileDistance(a: DifficultyProfile, b: DifficultyProfile): number {
  const term = (x: number, y: number, scale: number) => Math.abs(x - y) / scale
  return (
    term(a.moveCount, b.moveCount, 20) +
    term(a.crossingMoveCount, b.crossingMoveCount, 3) +
    term(a.eatCount, b.eatCount, 3) +
    term(a.survivingGroupCount, b.survivingGroupCount, 2) +
    term(a.groupsUsed, b.groupsUsed, 2) +
    term(a.expandedStates, b.expandedStates, 5000)
  )
}

// Greedy marginal-value selection — see the full design spec's section 10
// for why this replaces a fixed diversity-distance threshold.
export function selectDiverseTopN(candidates: HardCandidate[], n: number): HardCandidate[] {
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
          : Math.min(...selected.map((chosen) => profileDistance(chosen.profile, candidate.profile)))
      const value = candidate.score + GENERATOR_CONFIG.diversityWeight * diversityBonus
      if (value > bestValue) {
        bestValue = value
        bestIndex = i
      }
    }
    selected.push(remaining[bestIndex])
    remaining.splice(bestIndex, 1)
  }
  return selected
}

export function generateLevelBatch(
  targetPerTier: number,
  rng: () => number,
  maxAttempts: number = MAX_ATTEMPTS,
): BatchResult {
  const counts: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  const results: GeneratedLevel[] = []
  const seenLevels = new Set<string>()
  const hardCandidates: HardCandidate[] = []
  const hardPoolTarget = GENERATOR_CONFIG.hardCandidatePoolSize
  const stats: BatchStats = {
    attempts: 0,
    discardedGenerationFailed: 0,
    discardedAlreadySolved: 0,
    discardedUnsolvable: 0,
    discardedDuplicate: 0,
    discardedTierFull: 0,
    rejectedTooShort: 0,
    rejectedTooFewEats: 0,
    rejectedNotEnoughSurvivingGroups: 0,
    rejectedTooFewGroupsUsed: 0,
    rejectedTooLowScore: 0,
  }

  while (
    stats.attempts < maxAttempts &&
    (counts.easy < targetPerTier || counts.medium < targetPerTier || hardCandidates.length < hardPoolTarget)
  ) {
    stats.attempts++

    // Once easy and medium are both already filled, every further attempt
    // exists solely to feed the hard pool — switch to the hard-biased seed
    // profile at that point (see section 6.4 for why this trigger, rather
    // than a separate generation phase, is used).
    const useHardProfile = counts.easy >= targetPerTier && counts.medium >= targetPerTier
    const profile = useHardProfile ? GENERATOR_CONFIG.hardSeedProfile : GENERATOR_CONFIG.seedProfile
    const { world: seed, groups } = createSeedWorld(rng, profile)
    const steps =
      GENERATOR_CONFIG.minReverseSteps +
      Math.floor(rng() * (GENERATOR_CONFIG.maxReverseSteps - GENERATOR_CONFIG.minReverseSteps + 1))
    const generated = generateLevel(seed, groups, steps, rng)
    if (!generated) {
      stats.discardedGenerationFailed++
      continue
    }

    const world = pruneUntouchedGoals(generated.world, groups)
    const survivingGroups = getSurvivingGroups(world, groups)

    // Approach-A invariant: every surviving group's box must actually be
    // away from its seed position (section 4.6). This should be
    // tautologically true given correct pruning; checking it here catches a
    // future desync between pruneUntouchedGoals and getSurvivingGroups
    // immediately rather than shipping a decorative "surviving" group.
    for (const group of survivingGroups) {
      if (isGroupUntouched(world, group)) {
        throw new Error(
          `generateLevelBatch: Approach A invariant violated for group ${group.containerId} — ` +
            'it survived pruning but its box is still at the seed position, so it has no ' +
            'unsatisfied interior goal.',
        )
      }
    }

    // The generator's own contract is "produce an unsolved, playable
    // level" — checked directly here, independent of solve()'s own
    // implementation.
    if (checkWin(world)) {
      stats.discardedAlreadySolved++
      continue
    }

    const levelKey = canonicalKey(world)
    if (seenLevels.has(levelKey)) {
      stats.discardedDuplicate++
      continue
    }

    const solved = solve(world, 150, GENERATOR_CONFIG.maxSolverExpandedStates)
    if (!solved || solved.moves.length === 0) {
      stats.discardedUnsolvable++
      continue
    }

    const metrics: DifficultyMetrics = {
      moveCount: solved.moves.length,
      crossingMoveCount: countCrossingMoves(world, solved.moves),
      eatCount: countEatMoves(world, solved.moves),
      survivingGroupCount: survivingGroups.length,
      groupsUsed: countGroupsUsed(world, solved.moves, survivingGroups),
      expandedStates: solved.expandedStates,
      maxFrontierSize: solved.maxFrontierSize,
    }
    const tier = difficultyTier(metrics)

    // Cosmetic-only pass (see trimUnusedCells.ts's own comment for the proof
    // this can't change any metric above): walls off floor cells the solved
    // path never visits. Done after scoring so every metric is measured
    // against the exact world solve() actually searched, not a
    // pre-emptively trimmed one.
    const shippedWorld = trimUnusedCells(world, solved.moves)
    // Trimming can (rarely) make two otherwise-distinct seeds converge to
    // the same playable puzzle once their unused decoration is stripped —
    // re-check uniqueness on the shipped (trimmed) board, not just the
    // pre-trim `levelKey` already checked above.
    const shippedKey = canonicalKey(shippedWorld)
    if (seenLevels.has(shippedKey)) {
      stats.discardedDuplicate++
      continue
    }

    if (tier !== 'hard') {
      const check = checkHardRequirements(metrics)
      if (!check.meetsMinMoveCount) stats.rejectedTooShort++
      if (!check.meetsMinEatCount) stats.rejectedTooFewEats++
      if (!check.meetsMinSurvivingGroupCount) stats.rejectedNotEnoughSurvivingGroups++
      if (!check.meetsMinGroupsUsed) stats.rejectedTooFewGroupsUsed++
      if (!check.meetsMinScore) stats.rejectedTooLowScore++
    }

    if (tier === 'hard') {
      if (hardCandidates.length >= hardPoolTarget) {
        stats.discardedTierFull++
        continue
      }
      seenLevels.add(levelKey)
      seenLevels.add(shippedKey)
      hardCandidates.push({
        world: shippedWorld,
        json: JSON.stringify(serializeLevel(shippedWorld)),
        profile: {
          moveCount: metrics.moveCount,
          crossingMoveCount: metrics.crossingMoveCount,
          eatCount: metrics.eatCount,
          survivingGroupCount: metrics.survivingGroupCount,
          groupsUsed: metrics.groupsUsed,
          expandedStates: metrics.expandedStates,
        },
        score: scoreDifficulty(metrics),
      })
      continue
    }

    if (counts[tier] >= targetPerTier) {
      stats.discardedTierFull++
      continue
    }

    seenLevels.add(levelKey)
    counts[tier]++
    results.push({ tier, world: shippedWorld, json: JSON.stringify(serializeLevel(shippedWorld)) })
  }

  for (const candidate of selectDiverseTopN(hardCandidates, targetPerTier)) {
    counts.hard++
    results.push({ tier: 'hard', world: candidate.world, json: candidate.json })
  }

  const complete =
    counts.easy >= targetPerTier && counts.medium >= targetPerTier && counts.hard >= targetPerTier

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
