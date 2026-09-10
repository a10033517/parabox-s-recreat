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
  },
  seedProfile: {
    fourGroupProbability: 0.5,
    largeInteriorProbability: 0.5,
    remoteStartProbability: 0,
  },
  hardSeedProfile: {
    fourGroupProbability: 0.8,
    largeInteriorProbability: 0.8,
    remoteStartProbability: 0.25,
  },
  scoring: {
    crossingMoveWeight: 3,
    eatWeight: 6,
    survivingGroupWeight: 8,
    groupsUsedWeight: 5,
    expandedStatesLogWeight: 2,
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
