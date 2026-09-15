export interface GeneratorWeights {
  push: number
  enter: number
  eat: number
  newGroupBonus: number
  repeatedGroupWeight: number
  // See generateLevel.ts's directionSeekWeights: extra weight given to a
  // reverse-walk direction that reduces distance to the nearest
  // still-untouched group's root position. Added after diagnostics found
  // uniform-random direction rarely let the walk reach a second isolated
  // group within budget, capping survivingGroupCount near 2.
  groupSeekBias: number
  // Extra weight for a 'push' candidate that actually moves a real piece
  // (not just the player walking with nothing in front of it). Added
  // alongside pushMoveCount (see difficultyScorer.ts) per user feedback
  // that generated levels felt mechanically identical — this biases the
  // reverse walk toward genuine box-manipulation instead of the plain
  // walk that's otherwise always the cheapest available candidate.
  boxPushBonus: number
}

// Phase-5 diagnostics (see the full design spec's §6.3, §14 point 5) found
// A-B-A-B oscillation is real and common: over an 800-attempt mixed sample,
// survivingGroupCount never exceeded 2 and moveCount never reached the hard
// tier's minimum of 20, even under the hard-biased seed profile — despite
// touchCounts-based weighting rewarding untouched groups. The deferred
// follow-up the spec anticipated for exactly this finding: a short-lookback
// penalty on a group touched recently, discouraging the walk from
// immediately wandering a just-touched group's box back toward its seed
// position (which silently erases that group's "surviving" credit without
// tripping the exact-state `seen` cycle guard, since the rest of the World
// differs). `oscillationRecentWindow` events of lookback;
// `repeatPenalty = 1 / (1 + recentTouchCount)` per the spec's own formula.
export const OSCILLATION_RECENT_WINDOW = 6

export interface SeedProfile {
  fourGroupProbability: number
  largeInteriorProbability: number
  remoteStartProbability: number
  // See the multi-box groups spec (2026-09-11-parabox-generator-multibox-
  // groups.md): chance a given group's container gets 2 walls / 2
  // requirement cells instead of 1. Applies uniformly to every group draw
  // in both profiles, exactly like the two probabilities above.
  multiBoxProbability: number
  // Per user feedback (session follow-up to the multi-box groups spec,
  // which turned out to be geometrically broken — eating relocates the
  // container, so a group can never actually need 2 eats): plain,
  // goal-less pushable boxes seeded on root purely as extra material for
  // the reverse walk to manipulate. They have no requirement cell and no
  // pruning logic — whether the final solve actually needs to move one is
  // an emergent, measured outcome (see solver.ts's countFillerBoxesUsed),
  // not a generation guarantee, matching the user's own stated criterion
  // ("only needs to be usable on the optimal path, not have its own
  // goal"). Must be <= 16 (4 slots x 4 corners each — see seed.ts's
  // placement scheme).
  fillerBoxCount: number
  // Per user feedback (further refining fillerBoxCount): a plain box
  // "just being pushed" isn't real use — they want levels where an extra,
  // target-less box genuinely has to be cleared out of the way before the
  // real box can reach its target. Chance a given group's approach cell —
  // step(containerPos, opposite(wallDir)), i.e. the exact cell the player
  // must stand on to eat that group's box — gets an obstacle box instead
  // of being left empty. Clearing it (one push, away from the container)
  // is a real precondition for that group's own eat, not incidental: the
  // player physically cannot occupy that cell to eat until the obstacle
  // has moved. Reuses the same fillerBoxIds tracking/cleanup as
  // fillerBoxCount (removeUnusedFillerBoxes/countFillerBoxesUsed) — an
  // obstacle whose group ends up pruned/untouched, so the obstacle was
  // never actually cleared, gets deleted from the shipped level exactly
  // like an unused corner filler.
  obstacleBoxProbability: number
}

export function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a probability in [0, 1], got ${value}`)
  }
}

export function assertFillerBoxCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 16) {
    throw new Error(`${name} must be an integer in [0, 16] (4 slots x 4 corners each), got ${value}`)
  }
}

export interface GeneratorConfig {
  minReverseSteps: number
  maxReverseSteps: number
  weights: GeneratorWeights
  seedProfile: SeedProfile
  hardSeedProfile: SeedProfile
  scoring: {
    crossingMoveWeight: number
    eatWeight: number
    survivingGroupWeight: number
    groupsUsedWeight: number
    expandedStatesLogWeight: number
    pushMoveWeight: number
  }
  hard: {
    minMoveCount: number
    minEatCount: number
    minSurvivingGroupCount: number
    minGroupsUsed: number
    minScore: number
  }
  hardCandidatePoolSize: number
  diversityWeight: number
  // Safety cap discovered during this redesign's own diagnostic pass (not
  // in the original spec listing): the wider reverse-step range plus the
  // hard-biased seed profile (4 groups, size-5 interiors) can produce a
  // multi-box puzzle whose BFS state space grows combinatorially — one
  // observed candidate exhausted a 4GB heap during a batch run of only 50
  // attempts. solve() treats hitting this cap the same as "no solution
  // found" (returns null), which generateBatch.ts already buckets as
  // discardedUnsolvable — a candidate this expensive to solve is not one
  // worth shipping anyway. Set well above every normal-difficulty solve
  // observed in diagnostics (worst sampled: ~2500 expanded / ~4300
  // visited), so it only ever trims genuine pathological outliers.
  maxSolverExpandedStates: number
  // See trimUnusedCells.ts: BFS-graph-distance margin (in existing-floor
  // cells) kept around the solved path before the rest gets walled off. 0
  // reproduces the original bare-single-corridor behavior; user feedback
  // after playing the first trimmed batch was that a bare corridor read as
  // "only one path" — this keeps real maneuvering/wrong-turn room instead.
  trimBufferRadius: number
}

export const GENERATOR_CONFIG: GeneratorConfig = {
  // Raised from 12 per a user request to raise difficulty while keeping
  // the board small. Tried raising seed-material probabilities first
  // (SeedProfile's own comment block above has the full story) — that
  // measurably did nothing (moveCount/hard-tier yield unchanged within
  // noise), because the necessity-pruning stage strips unused material
  // regardless of how much was offered. This is a genuinely different
  // lever: raising the FLOOR of the reverse walk's own length forces every
  // walk to be long, rather than merely allowing it. A head-to-head
  // diagnostic (200 solved candidates per value, minReverseSteps = 12
  // baseline / 25 / 35, maxReverseSteps fixed at 50) found a real, growing
  // effect: hard-tier yield 3/200 (1.5%) -> 5/200 (2.5%) -> 11/200 (5.5%),
  // moveCount p90 12 -> 12 -> 14, max 18 -> 19 -> 20 — and the solved rate
  // held up (200 solved found within 1699/1702/2007 attempts respectively,
  // no collapse). This is NOT the same experiment as the previously-
  // rejected "wider reverse-step range" (which raised the ceiling and
  // suffered survivorship bias — a longer max is more likely to wander
  // into a dead end/cycle and simply fail, so only accidentally-short
  // walks survived); raising the floor instead forces every surviving
  // walk to actually be long. Board size (ROOT_SIZE/SLOT_SIZE in seed.ts)
  // is untouched, so this doesn't grow the level's footprint at all — it
  // only makes the fixed-size board's optimal solution genuinely longer.
  minReverseSteps: 35,
  maxReverseSteps: 50,
  weights: {
    push: 1.0,
    enter: 0.8,
    eat: 2.5,
    newGroupBonus: 3.0,
    repeatedGroupWeight: 1.0,
    groupSeekBias: 4.0,
    boxPushBonus: 2.0,
  },
  // Tried raising every one of these (fourGroupProbability 0.5->0.7,
  // largeInteriorProbability 0.5->0.65, remoteStartProbability 0->0.15,
  // multiBoxProbability 0.3->0.45, fillerBoxCount 3->5, obstacleBoxProbability
  // 0.4->0.55, and the hardSeedProfile equivalents) per a user request to
  // raise complexity while keeping the board small. Reverted after a
  // head-to-head diagnostic (200 solved candidates each, same methodology)
  // found NO real effect: moveCount p50 7 vs 7, p90 13 vs 12, max 16 vs 15;
  // hard-tier yield 7/200 vs 6/200 — within noise, not an improvement. Root
  // cause: these probabilities only control how much EXTRA material a seed
  // *offers* (more groups, bigger interiors, more filler/obstacle boxes);
  // the necessity-pruning stage (pruneUntouchedGoals, removeUnnecessaryFiller
  // Boxes) strips out whatever the shortest solution doesn't actually need,
  // regardless of how much was offered at seed time. Raising "how much is
  // available" doesn't raise "how much is necessary" — that's governed by
  // the reverse walk's own length/weights, not the seed profile. This joins
  // this project's other rejected "obviously good" ideas (SLOT_SIZE 5->7,
  // wider reverse-step range) — see this file's own history for those.
  seedProfile: {
    fourGroupProbability: 0.5,
    largeInteriorProbability: 0.5,
    remoteStartProbability: 0,
    multiBoxProbability: 0.3,
    fillerBoxCount: 3,
    obstacleBoxProbability: 0.4,
  },
  hardSeedProfile: {
    fourGroupProbability: 0.8,
    largeInteriorProbability: 0.8,
    remoteStartProbability: 0.25,
    multiBoxProbability: 0.5,
    fillerBoxCount: 3,
    obstacleBoxProbability: 0.6,
  },
  scoring: {
    crossingMoveWeight: 3,
    eatWeight: 6,
    survivingGroupWeight: 8,
    groupsUsedWeight: 5,
    expandedStatesLogWeight: 2,
    pushMoveWeight: 2,
  },
  // Retuned from the spec's initial values (minMoveCount 20, minScore 25)
  // after the mandatory diagnostic pass (§12): across two empirical
  // samples (800 mixed-profile + 600 hard-profile-only attempts, both
  // after adding the §6.3 oscillation cooldown), moveCount never exceeded
  // 17 and survivingGroupCount/groupsUsed/eatCount never exceeded 2 — the
  // original minMoveCount=20 made 'hard' structurally unreachable. These
  // values match the empirically observed ceiling instead of an
  // unvalidated guess; minScore is raised to 50 (roughly the score a
  // genuine 2-group/2-eat solution reaches) so score still does real
  // selective work among candidates that clear the structural minimums,
  // rather than being trivially satisfied by every solved candidate.
  hard: {
    minMoveCount: 12,
    minEatCount: 2,
    minSurvivingGroupCount: 2,
    minGroupsUsed: 2,
    minScore: 50,
  },
  hardCandidatePoolSize: 60,
  diversityWeight: 10,
  maxSolverExpandedStates: 5000,
  trimBufferRadius: 2,
}

// Validate the shipped defaults at module load — cheap, and catches a typo
// (e.g. multiBoxProbability: 5 instead of 0.5) immediately on import rather
// than as a silent generation-time misbehavior.
for (const [profileName, profile] of Object.entries({
  seedProfile: GENERATOR_CONFIG.seedProfile,
  hardSeedProfile: GENERATOR_CONFIG.hardSeedProfile,
})) {
  assertProbability(profile.fourGroupProbability, `${profileName}.fourGroupProbability`)
  assertProbability(profile.largeInteriorProbability, `${profileName}.largeInteriorProbability`)
  assertProbability(profile.remoteStartProbability, `${profileName}.remoteStartProbability`)
  assertProbability(profile.multiBoxProbability, `${profileName}.multiBoxProbability`)
  assertFillerBoxCount(profile.fillerBoxCount, `${profileName}.fillerBoxCount`)
  assertProbability(profile.obstacleBoxProbability, `${profileName}.obstacleBoxProbability`)
}
