# Parabox Level Generator — Review & Revised Hard-Level Generation Design

**Status:** Revised draft for implementation review  
**Based on:** `2026-09-06-parabox-generator-full-design(1).md`  
**Purpose:** Review the current integrated Approach A + complexity-aware hard-level generator design, identify remaining correctness/design issues, and define the changes required before implementation.

---

## 1. Executive conclusion

The current integrated design is directionally correct, but it should **not be implemented exactly as written yet**.

The main architecture is sound:

```text
seed
  ↓
reverse generation
  ↓
Approach A pruning
  ↓
forward BFS solve
  ↓
solution metrics
  ↓
complexity score / hard constraints
  ↓
hard candidate pool
  ↓
diversity selection
```

The most important remaining issue is a concrete correctness bug:

> `countGroupsUsed(world, solved.moves, groups)` receives the original `groups` array even after `pruneUntouchedGoals()` has removed some groups. A removed group's `containerId` / `boxId` no longer exists in `world.locations`, so `countGroupsUsed()` can dereference `undefined.board` and crash.

There are also several design weaknesses that should be corrected before relying on the generator to produce genuinely difficult Parabox levels:

1. `crossingMoveCount >= 2` is a weak proxy for multiple meaningful goal interactions.
2. `groupsUsed` is not the same concept as “number of surviving goal groups” and should not be used as a substitute.
3. The hard generator can still accept structurally similar puzzles because diversity currently compares only difficulty numbers.
4. `expandedStates` is useful as a search-complexity signal, but should not be allowed to dominate human-facing difficulty.
5. Hard generation currently uses the same seed distribution as easy/medium, even though 4 groups and larger interiors are natural sources of structural complexity.
6. The design has no explicit guarantee that a hard level contains a sufficiently rich combination of **multiple surviving goal groups + multiple eat interactions + nontrivial solution length**.
7. The diagnostic requirements should explicitly compare the new system against the old 4b baseline and report failure conditions, not only raw distributions.

The revised design below keeps the existing architecture but fixes these issues.

---

## 2. What should remain unchanged

The following parts of the integrated design are good and should remain:

- Approach A: move the `box` requirement from the container's root cell to the box's original cell in the interior.
- Prune groups based on whether their box has left its seed position.
- Keep `verifyPredecessor()` as the correctness gate for every inverse move.
- Keep `applyMove()` as the sole source of truth for forward behavior.
- Keep BFS as the shortest-solution solver.
- Keep canonical-state deduplication.
- Keep player-start diversification as a separate seed variable.
- Keep weighted reverse generation as a heuristic rather than a correctness requirement.
- Keep hard-level candidate pooling and final selection.
- Keep empirical validation before regenerating shipped JSON.

Approach A is still necessary because the original design's goal on the container root cell allowed an untouched container to satisfy the goal. The revised design should preserve this fix rather than replacing it.

---

## 3. Critical correctness fix: `countGroupsUsed()` after pruning

### 3.1 Current problem

The current batch flow is:

```ts
const { world: seed, groups } = createSeedWorld(rng)
const generated = generateLevel(seed, groups, steps, rng)
const world = pruneUntouchedGoals(generated.world, groups)

const solved = solve(world, 150)

const groupsUsed = countGroupsUsed(world, solved.moves, groups)
```

The problem is that `groups` describes the original seed, while `world` may no longer contain every group.

For example:

```text
Seed:
  goal0 exists
  goal1 exists
  goal2 exists
  goal3 exists

After pruning:
  goal0 exists
  goal2 exists
```

But `countGroupsUsed()` still loops over:

```text
goal0
 goal1   ← removed
 goal2
 goal3   ← removed
```

The existing code then does:

```ts
const before = current.locations[pieceId]
const after = next.locations[pieceId]
```

For a removed group, `before` is `undefined` and the next line can fail.

### 3.2 Required fix

Do not make `countGroupsUsed()` depend on nonexistent pieces.

The safest design is to introduce the concept of **surviving groups** immediately after pruning.

```ts
function getSurvivingGroups(world: World, groups: SeedGroup[]): SeedGroup[] {
  return groups.filter((group) =>
    world.pieces[group.containerId] !== undefined &&
    world.pieces[group.boxId] !== undefined &&
    world.boards[group.interiorId] !== undefined,
  )
}
```

Then:

```ts
const world = pruneUntouchedGoals(generated.world, groups)
const survivingGroups = getSurvivingGroups(world, groups)
```

And all solution-group metrics should use `survivingGroups`.

```ts
const groupsUsed = countGroupsUsed(world, solved.moves, survivingGroups)
```

Additionally, `countGroupsUsed()` itself should defensively skip absent pieces. This protects it against future callers and makes the helper independently safe.

```ts
const before = current.locations[pieceId]
const after = next.locations[pieceId]
if (!before || !after) continue
```

The two protections serve different purposes:

- `survivingGroups` gives the metric the correct semantic scope.
- defensive checks keep the helper from crashing on malformed or future inputs.

---

## 4. Add `survivingGroupCount` as an explicit metric

`groupsUsed` and `survivingGroupCount` are not the same concept.

### `survivingGroupCount`

How many goal groups remain in the final shipped level after pruning?

### `groupsUsed`

How many surviving groups materially participate in the shortest solution?

With Approach A, every surviving group should ultimately require an eat interaction to satisfy its interior goal, so these values should normally be strongly correlated. However, keeping both metrics is useful for diagnostics and catches implementation mistakes.

Add:

```ts
interface DifficultyMetrics {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  survivingGroupCount: number
  groupsUsed: number
  expandedStates: number
}
```

This also makes hard-level requirements more meaningful.

---

## 5. Hard structural requirements should use `eatCount`, not only crossings

The current hard rule is approximately:

```ts
score >= minScore
&& moveCount >= minMoveCount
&& crossingMoveCount >= minCrossingMoveCount
&& groupsUsed >= minGroupsUsed
```

This is not ideal.

`crossingMoveCount` counts any move where a piece changes boards. That can include entering a container, so it is not a direct measurement of the number of goal-restoring interactions.

For this generator, `eatCount` is the more meaningful mechanic metric.

### Recommended hard requirements

Start with:

```ts
hard: {
  minMoveCount: 20,
  minEatCount: 2,
  minSurvivingGroupCount: 2,
  minGroupsUsed: 2,
  minScore: 25,
}
```

Keep `crossingMoveCount` in the score and diagnostics, but do not use it as the sole structural gate.

### Why

A better hard-level signature is:

```text
at least 2 surviving goals
        AND
at least 2 eat interactions
        AND
solution is not short
        AND
overall measured complexity is high
```

This directly describes the intended Parabox complexity much better than “at least two board crossings.”

---

## 6. Consider requiring 3 surviving groups for the highest hard levels

The current seed has 3 or 4 groups.

A hard tier containing only 2 surviving groups can still be difficult, but the generator should distinguish two levels of hard complexity.

Recommended classification:

### Hard

```text
survivingGroupCount >= 2
AND eatCount >= 2
AND moveCount >= 20
AND score >= minScore
```

### Very hard / top hard candidates

```text
survivingGroupCount >= 3
AND eatCount >= 3
AND moveCount >= 25
AND score >= higherScore
```

This should be used as a ranking preference rather than necessarily introducing a new shipped tier immediately.

For example:

```ts
rankingScore = score
  + survivingGroupCount * 5
  + eatCount * 3
```

This lets the generator prefer genuinely multi-group puzzles when choosing the final hard set.

---

## 7. Hard-mode seed distribution should be stronger

The integrated design still creates:

```ts
const groupCount = 3 + Math.floor(rng() * 2)
```

and:

```ts
const interiorSize = random choice of [3, 5]
```

for every tier.

That is acceptable for a general candidate generator, but it is not ideal when the explicit goal is to produce harder levels.

### Recommended approach

Keep random seed generation for general levels, but add a **hard-generation profile**.

For hard candidates, strongly prefer:

```text
4 groups
5×5 interiors
player starts away from the most recently used group
```

A simple first version can use probabilities instead of completely forcing the configuration:

```ts
hard:
  groupCount:
    4 → 0.80
    3 → 0.20

  interiorSize:
    5 → 0.80
    3 → 0.20
```

This should still be validated empirically.

The important design principle is:

> Larger structural capacity is a candidate-generation bias, not a guarantee of difficulty. Final difficulty must still come from the solved result.

---

## 8. Player-start diversification should avoid an unintended fourth-slot problem

The current design permits the player to start in all four slots even when `groupCount === 3`.

That means this can occur:

```text
┌─────────┬─────────┐
│ goal0   │ goal1   │
│         │         │
├─────────┼─────────┤
│ goal2   │ player  │
│         │         │
└─────────┴─────────┘
```

This is not necessarily wrong, but it changes the problem from “balanced access to existing groups” into “sometimes the player starts in a completely unused region.”

For a hard generator, this can artificially increase distance without necessarily increasing puzzle reasoning complexity.

### Recommended policy

Use two modes:

```text
3-group seed:
  choose among active group slots, plus optionally one deliberately-far start

4-group seed:
  choose among all 4 slots
```

This allows the generator to distinguish:

- balanced group accessibility
- intentionally remote starts

rather than mixing the two effects.

The exact probability of the remote-start branch should be measured.

---

## 9. Weighted reverse generation should track both group activation and event kind

The existing weighted reverse walk is a good improvement, but its purpose should be stated precisely:

```text
heuristic = increase probability of obtaining promising candidates
not
heuristic = guarantee a hard puzzle
```

Keep:

```text
higher eat weight
new-group bonus
repeat-group decay
positive weight for every valid candidate
```

Also add a simple **recent-group cooldown** as a soft heuristic.

The current design correctly notes that immediate reversal is already prevented by `seen`-state detection. A separate rule for “do not immediately undo” is therefore unnecessary.

However, `seen` does not prevent this pattern:

```text
A
B
A
B
A
B
```

where the walk repeatedly cycles through the same small region without revisiting an exact state.

A simple bounded history heuristic can help:

```ts
recentGroups: string[]
```

and reduce weight when a candidate repeatedly touches the same group within the last few accepted events.

This remains a soft penalty, never a hard prohibition.

Example:

```ts
repeatPenalty = 1 / (1 + recentTouchCount)
```

This should be introduced only after the simpler weighted heuristic has been measured.

---

## 10. Do not treat `expandedStates` as a direct human-difficulty score

`expandedStates` is useful, but it measures **solver search effort**, not directly what a human player experiences.

A level can have:

```text
large state space
```

without being particularly hard for a human because the correct route is obvious.

Therefore:

```ts
Math.log2(expandedStates + 1)
```

should remain a secondary score component.

Recommended precedence:

```text
Primary:
  moveCount
  eatCount
  survivingGroupCount

Secondary:
  crossingMoveCount
  groupsUsed

Tertiary:
  expandedStates
```

The hard structural gates should never depend on `expandedStates` alone.

The current design already avoids that in principle; the revised design should make this an explicit invariant and test it.

---

## 11. Improve the difficulty score so `survivingGroupCount` is represented directly

Recommended starting score:

```ts
export function scoreDifficulty(metrics: DifficultyMetrics): number {
  const { scoring } = GENERATOR_CONFIG

  return (
    metrics.moveCount +
    metrics.eatCount * scoring.eatWeight +
    metrics.survivingGroupCount * scoring.survivingGroupWeight +
    metrics.groupsUsed * scoring.groupsUsedWeight +
    metrics.crossingMoveCount * scoring.crossingMoveWeight +
    Math.log2(metrics.expandedStates + 1) * scoring.expandedStatesLogWeight
  )
}
```

Recommended initial values:

```ts
scoring: {
  crossingMoveWeight: 3,
  eatWeight: 6,
  survivingGroupWeight: 8,
  groupsUsedWeight: 5,
  expandedStatesLogWeight: 2,
}
```

These are **starting values only**.

They must be tuned from measured candidate distributions.

The important change is the relative importance:

```text
eat / surviving groups
    >
ordinary crossings
    >
search-space size
```

This better reflects the intended structural complexity of this generator.

---

## 12. Add a hard-level “complexity signature”

Difficulty profiles based only on numeric values can still select puzzles that are very similar structurally.

Add a small categorical signature for candidate analysis, for example:

```ts
interface ComplexitySignature {
  survivingGroupCount: number
  eatCount: number
  crossingCount: number
  interiorSize3Count: number
  interiorSize5Count: number
  solutionHasMultiGroupInteraction: boolean
}
```

This does not need to become part of gameplay or serialization.

It is only for candidate selection and diagnostics.

Examples of useful hard-level families:

```text
A: 2-group / short / high search-space
B: 2-group / many eats
C: 3-group / long solution
D: 3-group / many crossings
E: 4-group / long + many eats
```

The final batch should avoid selecting five candidates from the same family when alternatives exist.

---

## 13. Diversity filtering should operate in two layers

The current `profileDistance()` compares numerical difficulty values only.

That is useful but incomplete.

Use:

### Layer 1 — difficulty-profile distance

Compare:

```text
moveCount
crossingMoveCount
eatCount
survivingGroupCount
groupsUsed
expandedStates
```

### Layer 2 — structural signature distance

Prefer candidates with different:

```text
surviving group count
interior-size distribution
eat-count class
group-participation pattern
```

A candidate should be rejected from diversity selection when it is too similar in **both** layers.

This prevents the final five hard levels from all looking statistically identical.

---

## 14. Replace fixed `diversityMinDistance = 0.5` with a validated threshold

The current:

```ts
diversityMinDistance: 0.5
```

is not yet justified.

Because the profile dimensions have different scales, a fixed threshold should be validated against a real candidate pool.

The diagnostic process should report:

```text
P50 pairwise distance
P75 pairwise distance
P90 pairwise distance
minimum selected-to-selected distance
```

Then choose a threshold that rejects genuinely near-identical candidates without preventing the batch from filling.

Do not treat `0.5` as a proven value.

---

## 15. Candidate-pool selection should optimize quality, not only filter duplicates

The current logic is:

```text
collect 60 hard candidates
↓
sort by score
↓
skip similar candidates
↓
backfill
```

This is acceptable as a first implementation, but the final selection should prioritize:

```text
1. satisfy hard structural requirements
2. maximize difficulty
3. maximize structural diversity
4. avoid nearly identical profiles
```

A better strategy is a greedy marginal-value selection:

```text
start with highest-score candidate

repeat until N selected:
  choose candidate with
    difficulty score
    + diversity bonus from selected set
```

Conceptually:

```ts
selectionValue(candidate) =
  candidate.score +
  diversityWeight * distanceToSelected(candidate)
```

This is easier to reason about than a hard cutoff alone and naturally balances difficulty against variety.

---

## 16. Keep “hard candidate” and “final selected hard level” separate

A candidate pool is not itself the shipped set.

The pipeline should explicitly be:

```text
candidate
  ↓
valid / solvable
  ↓
hard structural requirements
  ↓
hard candidate pool
  ↓
ranking
  ↓
diversity selection
  ↓
final hard levels
```

This distinction is important for diagnostics.

The generator should report both:

```text
number of candidates that passed hard requirements
number finally selected
```

Otherwise it is difficult to tell whether the generator cannot produce hard levels or whether the diversity selector is simply rejecting too many of them.

---

## 17. Add explicit rejection reasons for difficulty constraints

Current statistics contain generation/solve/batch failures, but do not distinguish difficulty failures well enough.

Add counters such as:

```ts
rejectedTooShort
rejectedTooFewEats
rejectedTooFewGroups
rejectedTooLowScore
rejectedNotEnoughSurvivingGroups
```

This is especially useful when tuning.

For example, if diagnostics show:

```text
hard candidates wanted: 60

95% rejected:
  too few surviving groups
```

then changing the scoring weights is unlikely to fix the problem; the seed/reverse-generation strategy is the bottleneck.

---

## 18. Add a direct invariant check for Approach A

The implementation should validate this invariant after pruning and before solving:

> Every surviving group has its box outside its original interior position and therefore has a genuine interior goal that is unsatisfied at generation time.

For each surviving group:

```ts
assert(box location !== boxOriginalPosition)
assert(interior still exists)
assert(interior goal exists)
```

This catches future regressions where pruning or generation accidentally leaves a group that does not actually require an eat operation.

---

## 19. Add a post-solve invariant connecting goals and eats

For each final level, verify:

```text
survivingGroupCount >= 1
→ solution has at least one corresponding eat interaction
```

And preferably:

```text
survivingGroupCount = N
→ solution has at least N goal-restoring eat interactions
```

The exact equality should be confirmed empirically before turning it into an unconditional assertion, because the forward engine could theoretically permit more complicated interactions.

This is a much stronger validation of Approach A than merely checking `crossingMoveCount > 0`.

---

## 20. Reverse-step range should remain a candidate-generation parameter

Keep:

```ts
minReverseSteps = 12
maxReverseSteps = 50
```

as initial values, but explicitly reject the assumption:

```text
more reverse steps = harder level
```

The useful relationship is:

```text
more reverse steps
→ larger candidate variety
→ potentially more structural complexity
→ but only the solver determines final measured difficulty
```

Also record:

```text
requested reverse steps
actual accepted reverse steps
```

for diagnostics.

---

## 21. Recommended generator configuration

The following is a better starting configuration than the current one, but all numbers remain tunable.

```ts
export interface GeneratorConfig {
  minReverseSteps: number
  maxReverseSteps: number

  weights: {
    push: number
    enter: number
    eat: number
    newGroupBonus: number
    repeatedGroupWeight: number
  }

  hardSeed: {
    fourGroupProbability: number
    largeInteriorProbability: number
    remoteStartProbability: number
  }

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
  diversityMinDistance: number
}
```

Initial values:

```ts
export const GENERATOR_CONFIG: GeneratorConfig = {
  minReverseSteps: 12,
  maxReverseSteps: 50,

  weights: {
    push: 1.0,
    enter: 0.8,
    eat: 2.5,
    newGroupBonus: 3.0,
    repeatedGroupWeight: 1.0,
  },

  hardSeed: {
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

  hard: {
    minMoveCount: 20,
    minEatCount: 2,
    minSurvivingGroupCount: 2,
    minGroupsUsed: 2,
    minScore: 25,
  },

  hardCandidatePoolSize: 60,
  diversityMinDistance: 0.5,
}
```

Again, these are implementation starting points, not validated final values.

---

## 22. Revised pipeline

The recommended final pipeline is:

```text
createSeedWorld()
  ↓
seed profile selected according to target tier
  ↓
generateLevel()
  - verified inverse candidates only
  - eat bias
  - new-group bias
  - optional recent-group soft penalty
  ↓
pruneUntouchedGoals()
  ↓
getSurvivingGroups()
  ↓
Approach-A invariant validation
  ↓
checkWin()
  ↓
canonical dedup
  ↓
solve()
  ↓
calculate:
  moveCount
  crossingMoveCount
  eatCount
  survivingGroupCount
  groupsUsed
  expandedStates
  maxFrontierSize
  ↓
calculate difficulty score
  ↓
apply hard structural gates
  ↓
if hard:
  add to hard candidate pool
  ↓
after pool collection:
  rank candidates
  ↓
structural + profile diversity selection
  ↓
serialize final levels
```

---

## 23. Revised solver result

Keep the expanded solver result:

```ts
interface SolveResult {
  moves: Direction[]
  expandedStates: number
  maxFrontierSize: number
  visitedStates: number
}
```

No change to BFS semantics is needed.

The solver remains a correctness tool and measurement tool, not a heuristic search algorithm.

---

## 24. Revised difficulty metrics

Recommended final metrics:

```ts
interface DifficultyMetrics {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  survivingGroupCount: number
  groupsUsed: number
  expandedStates: number
  maxFrontierSize: number
}
```

`maxFrontierSize` does not necessarily need to enter the score initially, but it should be retained for diagnostics because it helps detect levels that are expensive for BFS for reasons not captured by total expanded states.

---

## 25. Revised hard-level rule

The minimum hard requirements should be:

```text
score >= minScore
AND
moveCount >= minMoveCount
AND
eatCount >= minEatCount
AND
survivingGroupCount >= minSurvivingGroupCount
AND
groupsUsed >= minGroupsUsed
```

This prevents a level from becoming “hard” solely because:

```text
BFS happened to explore many states
```

while the actual puzzle has one simple goal interaction.

---

## 26. Diagnostic requirements

Before committing generated JSON, run a sufficiently large diagnostic batch.

Report distributions for:

```text
reverseSteps
moveCount
crossingMoveCount
eatCount
survivingGroupCount
groupsUsed
expandedStates
maxFrontierSize
score
```

Report rejection reasons:

```text
generation failed
already solved
unsolvable
duplicate
too short
not enough eats
not enough surviving groups
not enough groups used
score too low
hard pool full
```

Report group participation:

```text
group/slot participation
player-start slot distribution
```

Report hard-pool quality:

```text
attempts required to obtain 60 hard candidates
hard-candidate rate
final selected score distribution
final selected eat-count distribution
final selected surviving-group distribution
final pairwise diversity distribution
```

Report solver cost:

```text
expandedStates P50/P75/P90/P95/P99
maxFrontierSize P50/P75/P90/P95/P99
wall-clock runtime
peak memory if measurable
```

---

## 27. Required baseline comparison

Compare against the known 4b observations.

Important baseline findings from the existing design:

```text
0 / 10 shipped levels had crossing moves
0.75% of 399 sampled levels had any crossing move
max observed score = 15
```

And the old player-start participation was strongly skewed:

```text
goal0 = 659
goal2 = 113
goal1 = 92
goal3 = 7
```

The redesigned generator should demonstrate that these specific pathologies materially improve.

Do not define success only as:

```text
“more levels reached hard tier”
```

A level can be classified hard incorrectly if the scoring model is poorly calibrated.

---

## 28. Acceptance criteria

The revised design is validated only when all of the following are true:

### Correctness

1. All tests pass.
2. No metric function accesses removed group pieces.
3. Every surviving goal has an unsatisfied interior goal before solving.
4. Every shipped level is solvable.
5. Every shipped level is not already solved.
6. No duplicate canonical worlds are shipped.

### Mechanic complexity

7. The fraction of levels with `eatCount > 0` is dramatically higher than the 4b baseline.
8. Hard levels satisfy the minimum eat requirement.
9. Hard levels contain multiple surviving goal groups.
10. Multi-group participation is substantially more common than in 4b.

### Structural complexity

11. Hard levels have materially greater solution length than easy/medium.
12. Hard levels show meaningful variation in surviving-group count and eat count.
13. The final hard set is not dominated by one structural family.

### Search complexity

14. `expandedStates` and `maxFrontierSize` are measured and remain operationally acceptable.
15. Search-space metrics contribute to ranking but cannot alone make a level hard.

### Generation quality

16. `MAX_ATTEMPTS` is sufficient for a full `targetPerTier=5` batch.
17. The hard candidate pool reaches its intended size often enough to make diversity selection meaningful.
18. The final five hard levels remain sufficiently diverse after selection.

---

## 29. Recommended implementation order

The previous phased plan is good, but the corrected order should be:

### Phase 1 — Approach A correctness

Implement and validate:

- interior goal requirement
- `boxOriginalPosition`
- simplified pruning
- removed public provenance tracking
- Approach-A invariants

### Phase 2 — Group bookkeeping fix

Implement:

- `getSurvivingGroups()`
- safe `countGroupsUsed()`
- `survivingGroupCount`

Run tests immediately.

### Phase 3 — Player-start diversification

Validate group/slot participation distribution.

### Phase 4 — Hard seed profile

Add stronger probability for:

- 4 groups
- 5×5 interiors
- optionally remote starts

Measure independently.

### Phase 5 — Reverse-walk heuristic

Add:

- eat bias
- new-group bonus
- repeated-group decay
- optional recent-group soft penalty

Measure whether candidate structure changes.

### Phase 6 — Solver instrumentation

Add:

- expanded states
- max frontier
- visited states
- eat count
- surviving groups
- groups used

### Phase 7 — Difficulty model

Tune score and hard constraints using measured distributions.

### Phase 8 — Candidate ranking/diversity

Add structural signatures and final candidate selection.

### Phase 9 — Full regression + batch validation

Only now regenerate shipped JSON.

---

## 30. Files to modify

### Required

| File | Change |
|---|---|
| `tools/generator/generatorConfig.ts` | Centralize all generator, seed, score, and hard-tier tuning values |
| `tools/generator/seed.ts` | Approach A + player-start and hard seed-profile support |
| `tools/generator/pruneUntouchedGoals.ts` | Approach A pruning |
| `tools/generator/generateLevel.ts` | Weighted reverse generation and optional recent-group heuristic |
| `tools/generator/solver.ts` | Solver instrumentation + eat/group metrics |
| `tools/generator/difficultyScorer.ts` | Revised metrics and hard constraints |
| `tools/generator/generateBatch.ts` | Surviving-group handling, hard candidate pool, ranking and diversity |

### Tests

| File | Change |
|---|---|
| `seed.test.ts` | Seed geometry, player starts, hard seed profile |
| `pruneUntouchedGoals.test.ts` | Approach A pruning |
| `generateLevel.test.ts` | Weighted selection, group tracking, cycle prevention |
| `solver.test.ts` | SolveResult + eat/group metrics + removed-group safety |
| `difficultyScorer.test.ts` | Score contributions + hard structural gates |
| `generateBatch.test.ts` | Candidate pool, surviving groups, diversity selection |

### Generated content

```text
src/levels/builtin/generated/*.json
```

Regenerate only after the diagnostic pass succeeds.

---

## 31. What should still remain unchanged

Do not modify:

- `applyMove`
- `checkWin`
- `getEntryCell`
- `computeTarget`
- `inverseMoves.ts` behavior
- `verifyPredecessor()` correctness discipline
- `canonicalKey()`
- BFS shortest-path semantics
- level serialization

The purpose of the redesign is to improve **generation and measurement**, not to alter the game's rules.

---

## 32. Final recommendation

The current integrated design is close, but the following changes should be considered mandatory before implementation:

```text
[MANDATORY]
1. Fix countGroupsUsed() for pruned groups.
2. Add survivingGroupCount.
3. Replace crossing-only hard gating with eat-based structural gating.
4. Add explicit hard-level structural requirements.
5. Validate player-start behavior for 3-group seeds.
6. Treat expandedStates as secondary, not as a proxy for human difficulty.
7. Add structural diversity to final hard-level selection.
8. Add detailed rejection reasons and baseline comparisons.
```

The most important conceptual change is:

> **Hardness should be defined by the structure of the solution, not by how long the reverse walk was and not by a single scalar score.**

A desirable hard level should combine several properties:

```text
multiple surviving goals
        +
multiple required eat interactions
        +
nontrivial shortest solution
        +
meaningful multi-group participation
        +
nontrivial search space
```

The generator should bias toward such states, but the solver must remain the final authority on whether the resulting level actually has those properties.
