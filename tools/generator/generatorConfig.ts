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
}

export function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a probability in [0, 1], got ${value}`)
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
  minReverseSteps: 12,
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
  seedProfile: {
    fourGroupProbability: 0.5,
    largeInteriorProbability: 0.5,
    remoteStartProbability: 0,
    multiBoxProbability: 0.3,
  },
  hardSeedProfile: {
    fourGroupProbability: 0.8,
    largeInteriorProbability: 0.8,
    remoteStartProbability: 0.25,
    multiBoxProbability: 0.5,
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
}
