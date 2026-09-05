# Parabox Level Generator — Complex & Hard Level Generation Design

**Status:** Proposed design
**Based on:** `2026-09-06-parabox-generator-full-design.md`
**Scope:** Generator-side changes intended to produce genuinely more complex and difficult Parabox levels.

---

## 1. Purpose

The current generator already has a correct mechanism-level direction through Approach A: the goal requirement is moved from the container's root cell to the box's original cell inside the interior, so a surviving goal group must actually restore its box through the eat/crossing mechanic.

However, this change solves **mechanic necessity**, not the broader problem of generating consistently difficult levels.

The current generator still relies heavily on a short random reverse walk (`3 + floor(rng() * 20)`), fixed player placement, and a difficulty score based mainly on shortest solution length plus crossing count. As a result, a generated level can contain Parabox mechanics while still being structurally simple or having an unexpectedly short solution.

The objective of this design is therefore:

> Generate levels whose shortest solutions are not only longer, but also require more interacting goal groups, more board crossings, more non-trivial state transitions, and a larger search space.

The design should preserve the engine as the single source of truth and should continue validating every generated world by the real forward engine and BFS solver.

---

## 2. Design Principles

### 2.1 Do not equate reverse-walk length with difficulty

The number of inverse moves used to construct a level is only a generation parameter. It is not a reliable measure of player difficulty.

A 40-step reverse walk can still collapse into a level with a short solution if the walk contains redundant movement, reversals, or actions that do not contribute to the final puzzle structure.

Therefore:

- reverse-walk length should be increased only as a way to create a larger candidate pool;
- final difficulty must be measured from the generated world using the real forward solver;
- levels should be accepted or rejected using solution and structural metrics, not generation-step count alone.

### 2.2 Prefer structural complexity over visual complexity

The generator should not intentionally make boards large or pieces numerous unless that additional geometry creates a harder dependency.

Useful complexity includes:

- multiple goal groups that all matter;
- multiple required board crossings;
- boxes whose restoration order matters;
- interactions among groups;
- states with many plausible but unsuccessful continuations;
- solutions that require several distinct container interactions.

### 2.3 Generation heuristics are not difficulty guarantees

The reverse generator may prefer `inverseEat` or interactions with different groups, but these preferences only improve the probability of producing complex candidates.

The final BFS solution remains authoritative.

For example, generating several `inverseEat` events does not prove that the final optimal solution needs several eat events. The candidate must be solved and measured before it is classified as hard.

### 2.4 Preserve Approach A

The Approach A requirement placement should remain the basis for goal groups:

- container root cell: no win requirement;
- box's original interior cell: `requirement: 'box'`;
- untouched groups are pruned using the box's one-way-door position check.

This ensures that a surviving group represents a mechanically meaningful objective rather than decorative container geometry.

---

# 3. Current Limitations To Address

The current design has the following limitations relevant to hard-level generation.

## 3.1 Fixed player start

The player is always seeded at the same root position `(2, 2)`.

This causes a strong spatial bias toward the first slot/group and was already observed in the existing diagnostics. The previous analysis recorded a large difference in group touch frequency, with the first goal group receiving dramatically more interactions than later groups.

A fixed player start therefore makes some groups much less likely to participate in generated levels and limits multi-group complexity.

## 3.2 Short, unconstrained reverse walks

The current walk uses:

```ts
steps = 3 + floor(rng() * 20)
```

and chooses directions and inverse patterns essentially at random.

The walker does not explicitly try to:

- activate multiple goal groups;
- increase board-crossing interactions;
- avoid immediate undoing of previous work;
- preserve useful structural changes;
- spread interactions across groups.

## 3.3 Difficulty score is too narrow

The current score is:

```ts
score = moveCount + crossingMoveCount * 5
```

with:

```text
score < 10   -> easy
score < 25   -> medium
score >= 25  -> hard
```

This does not distinguish a long but straightforward sequence from a shorter puzzle with substantial state-space complexity.

## 3.4 BFS output is underused

The solver already performs BFS and therefore has access to information that can characterize actual puzzle complexity.

The generator should collect additional statistics from the solve rather than using only the final move count and crossing count.

## 3.5 Candidate generation is not diversity-aware

Keeping a few levels from each score bucket does not guarantee that the accepted hard levels represent different puzzle structures.

Without diversity control, the generator can produce several hard levels that are effectively the same pattern with different coordinates.

---

# 4. Proposed Generator Pipeline

Change the conceptual pipeline from:

```text
Seed
  -> Random reverse walk
  -> Prune
  -> Solve
  -> Simple score
  -> Tier
```

to:

```text
Seed
  -> Diverse player start
  -> Complexity-aware reverse walk
  -> Prune
  -> Validate
  -> BFS solve + difficulty metrics
  -> Hardness constraints
  -> Diversity filtering
  -> Tier / ranking
  -> Serialize
```

The important change is that **generation and difficulty evaluation become separate concerns**.

The reverse walker creates candidates; the solver determines whether those candidates are actually difficult.

---

# 5. Seed Geometry Changes

## 5.1 Randomize player start

Replace the fixed `(2, 2)` player position with a valid position selected from a set of start candidates.

At minimum, when the seed contains four slots, allow starts associated with different quadrants instead of always using the first slot.

Example candidate positions:

```ts
const PLAYER_START_CANDIDATES = [
  { x: 2, y: 2 },
  { x: 7, y: 2 },
  { x: 2, y: 7 },
  { x: 7, y: 7 },
]
```

The exact coordinates should be derived from the slot geometry rather than duplicated as magic numbers if the seed layout changes later.

### Requirement

The chosen position must:

- be inside the root board;
- not overlap a container;
- not overlap a wall;
- not invalidate the existing `inverseMoves.ts` assumptions.

## 5.2 Prefer balanced group accessibility

A start candidate should be chosen so that all goal slots have a reasonable opportunity to participate.

Do not require equal distances. The objective is only to remove the obvious first-slot bias.

A lightweight seed diagnostic should record per-group reach/touch frequency over a large sample of generated walks.

The generator should be considered improved only if later goal groups are measurably more likely to participate.

## 5.3 Keep group count as a complexity control

Continue supporting 3 or 4 goal groups initially.

Do not increase the number of groups until the 3/4-group generator can reliably produce complex levels. More groups increase solver cost and can create combinatorial growth without necessarily improving puzzle quality.

---

# 6. Complexity-Aware Reverse Walk

## 6.1 Increase the candidate range

The reverse walk should use a larger candidate range than the current `3..22` steps.

A recommended first tuning range is:

```ts
steps = 12 + floor(rng() * 39) // 12..50
```

This is **not** a hard-difficulty guarantee. Its purpose is to produce a larger candidate pool.

The final accepted level must still pass solver-based difficulty requirements.

## 6.2 Track the previous event

The reverse walker should know the previous accepted event so it can reduce trivial undo patterns.

For example, avoid immediately choosing the exact inverse pattern and direction that simply restores the previous state.

This does not mean banning all reversals. It means lowering the probability of useless two-step oscillations.

Suggested rule:

```text
If candidate appears to immediately undo the previous event:
    reduce probability substantially
else:
    normal probability
```

Cycle prevention using `canonicalKey` remains unchanged.

## 6.3 Prefer useful interactions, but retain randomness

Each valid candidate inverse move should receive a heuristic weight.

Suggested categories:

```text
inverseEat   -> high weight
inversePush  -> normal weight
inverseEnter -> normal/low weight
```

However, these weights must not force a fixed pattern.

A weighted random choice is preferable to always selecting the highest-scoring candidate.

## 6.4 Encourage interaction with multiple groups

Track which goal groups have already had their boxes moved out of the seed position.

When a candidate `inverseEat` affects a previously untouched group, give it an increased probability.

Conceptually:

```text
new group activation        -> strong bonus
same group again             -> smaller bonus
trivial repeated movement    -> no bonus / penalty
```

The goal is to increase the probability of producing candidates where 2, 3, or 4 goal groups actually matter.

## 6.5 Discourage excessive single-group concentration

If the current walk has repeatedly interacted with the same group while all other groups remain untouched, increase the weight of candidates affecting other groups.

Do not hard-block the current group. Some good hard puzzles naturally concentrate on one container.

This should remain a heuristic rather than a correctness rule.

## 6.6 Prefer state-changing events

A candidate should receive a small penalty if its result differs from a recent state only by a move that is likely to be undone shortly.

This is a heuristic optimization rather than a formal puzzle-property requirement.

The correctness rule remains:

```text
candidate must pass the real inverse-move verification
```

---

# 7. Solver Instrumentation

The solver should expose more information about the BFS search.

The existing `solve()` already returns the shortest solution. Extend its internal bookkeeping so the generator can collect diagnostic metrics.

Suggested result structure:

```ts
export interface SolveResult {
  moves: Direction[]
  expandedStates: number
  maxFrontierSize: number
  visitedStates: number
}
```

The exact API can be adapted to preserve compatibility with callers that only need `Direction[]`.

## 7.1 `moveCount`

Keep the shortest solution length:

```ts
moveCount = moves.length
```

This remains useful, but should no longer be the dominant difficulty metric.

## 7.2 `crossingMoveCount`

Keep the current metric that counts solution moves in which at least one piece changes board.

This is especially important after Approach A because surviving goal groups structurally require their boxes to cross back into interiors.

## 7.3 `eatCount`

Count the solution moves that actually trigger the eat/crossing interaction.

This should be tracked separately from generic board-crossing count.

Reason:

```text
crossing != necessarily equivalent to the same logical interaction
```

The exact implementation should use the real forward engine rather than infer mechanics from coordinates alone.

## 7.4 `groupsUsed`

Determine how many goal groups are materially involved in the shortest solution.

For each group, identify whether its associated box or container participates in at least one relevant solution transition.

A first implementation may use the box/container piece IDs and replayed move transitions.

Example:

```ts
interface SolutionMetrics {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  groupsUsed: number
}
```

## 7.5 `expandedStates`

Record the number of BFS states expanded before the shortest solution was found.

This is an important proxy for state-space complexity.

For example:

```text
Level A:
15 moves
800 expanded states

Level B:
13 moves
18,000 expanded states
```

Level B should be considered structurally more difficult even though its solution is shorter.

## 7.6 `maxFrontierSize`

Track the maximum BFS frontier size.

A large frontier indicates that many plausible states exist at similar depths.

This is useful as a secondary search-complexity metric.

## 7.7 Optional future metric: dead-end states

A later iteration may count states that have no useful continuation or states that can only lead to already-visited regions.

This should not be required for the first implementation because it requires a more careful definition of what constitutes a dead end.

---

# 8. New Difficulty Model

Replace the current single formula:

```ts
moveCount + crossingMoveCount * 5
```

with a multi-factor score.

A first version can use:

```ts
score =
  moveCount
  + crossingMoveCount * 8
  + eatCount * 4
  + groupsUsed * 8
  + log2(expandedStates + 1) * 3
```

The constants are tuning parameters, not mathematically meaningful weights.

They must be validated empirically using generated batches.

## 8.1 Why `log2(expandedStates)`

BFS state counts can grow much faster than move counts, so adding the raw state count would quickly dominate all other components.

A logarithm allows search-space complexity to matter without completely overwhelming solution length and mechanic complexity.

## 8.2 Keep individual metrics visible

Do not store only the final score.

The generator's diagnostic output should report at least:

```text
moveCount
crossingMoveCount
eatCount
groupsUsed
expandedStates
maxFrontierSize
score
```

This makes tuning explainable and allows the thresholds to be revised based on actual distributions.

---

# 9. Hard-Level Acceptance Rules

Do not define `hard` only as `score >= 25`.

Use a combination of minimum requirements and the total score.

Recommended first-pass hard requirements:

```text
moveCount >= 20
crossingMoveCount >= 2
groupsUsed >= 2
score >= HARD_SCORE_THRESHOLD
```

The exact threshold should initially be derived from a diagnostic batch rather than assumed.

## 9.1 Why minimum requirements matter

Without explicit minimums, one metric can compensate for every other metric.

For example, a level could theoretically obtain a high score from a very large BFS frontier while still using only one goal group and zero crossing moves.

That would not represent the intended Parabox hard tier.

## 9.2 Very-hard candidates

A future tier may use:

```text
moveCount >= 30
crossingMoveCount >= 3
groupsUsed >= 3
expandedStates above a high percentile
```

Do not add this tier until hard-level generation is stable.

---

# 10. Difficulty Diversity

The generator should not accept five hard levels simply because they all exceed the same numeric threshold.

Introduce lightweight diversity checks.

## 10.1 Difficulty profile

Represent each accepted level by a profile such as:

```ts
interface DifficultyProfile {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  groupsUsed: number
  expandedStates: number
  maxFrontierSize: number
}
```

## 10.2 Avoid near-identical profiles

When selecting the final batch, reject or deprioritize candidates whose profiles are too similar to already accepted levels.

For example, the final five hard levels could intentionally contain different patterns:

```text
Hard A -> long solution
Hard B -> many crossings
Hard C -> many groups
Hard D -> large search space
Hard E -> balanced combination
```

This does not require an elaborate machine-learning clustering system. Simple profile-distance checks are sufficient initially.

---

# 11. Candidate Ranking Instead of First-Match Acceptance

The current batch generator can stop caring mainly about whether the next candidate fits the tier.

For hard-level generation, a better strategy is:

```text
Generate many valid candidates
    -> solve all candidates
    -> compute metrics
    -> discard weak candidates
    -> rank remaining candidates
    -> select the best diverse set
```

This turns hard-level generation into a quality-selection process rather than a first-match random process.

## 11.1 Recommended candidate pool

For example, when five hard levels are needed:

```text
Generate until 50-200 solvable hard candidates exist
    -> rank
    -> diversity-filter
    -> keep best 5
```

The exact pool size must be tuned against solver runtime.

Do not require a specific pool size in code initially; make it a configuration constant.

---

# 12. Changes to `difficultyScorer.ts`

Replace the current two-argument scoring API with a metrics-based API.

Suggested structure:

```ts
export interface DifficultyMetrics {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  groupsUsed: number
  expandedStates: number
  maxFrontierSize: number
}

export function scoreDifficulty(metrics: DifficultyMetrics): number {
  return (
    metrics.moveCount +
    metrics.crossingMoveCount * 8 +
    metrics.eatCount * 4 +
    metrics.groupsUsed * 8 +
    Math.log2(metrics.expandedStates + 1) * 3
  )
}
```

The tier function should then use explicit minimum constraints in addition to score.

Suggested conceptual API:

```ts
difficultyTier(metrics)
```

rather than:

```ts
difficultyTier(score)
```

This keeps the tier definition aware of the actual puzzle characteristics.

---

# 13. Changes to `solver.ts`

Extend BFS bookkeeping without changing the actual move semantics.

The solver must continue to use:

- `applyMove()` as the forward source of truth;
- `canonicalKey()` for visited-state deduplication;
- BFS for shortest-path correctness.

Add:

```ts
expandedStates
maxFrontierSize
visitedStates
```

When the solution is found, return these metrics together with the shortest moves.

Do not alter move ordering in a way that changes shortest-path semantics.

---

# 14. Changes to `generateLevel.ts`

The current random inverse walk should remain valid but gain lightweight heuristic selection.

## 14.1 Candidate representation

Instead of immediately accepting the first valid pattern, collect valid candidates for the chosen direction.

Conceptually:

```ts
const candidates = []

for (const pattern of shuffled(PATTERNS, rng)) {
  const next = pattern.fn(world, direction)
  if (!next) continue
  if (seen.has(canonicalKey(next))) continue

  candidates.push({ kind: pattern.kind, world: next })
}
```

Then assign heuristic weights and perform weighted random selection.

## 14.2 Candidate heuristic inputs

Possible inputs:

```text
move kind
newly activated group count
already active group count
whether the event immediately undoes the previous event
number of pieces changed
whether a box crossed a board boundary
```

The heuristic must remain cheap because it runs during generation.

## 14.3 Do not call the full BFS for every candidate

Full solving every candidate at every reverse step would be unnecessarily expensive.

Generation-time heuristics should use only inexpensive structural information.

Full BFS should remain the final candidate evaluation step.

---

# 15. Changes to `generateBatch.ts`

The main orchestration should become:

```text
createSeedWorld
    ↓
generateLevel
    ↓
pruneUntouchedGoals
    ↓
checkWin
    ↓
deduplicate
    ↓
solve
    ↓
collect metrics
    ↓
classify
    ↓
store candidate
```

For hard levels, do not immediately serialize the first accepted candidate.

Instead:

```text
candidate pool
    ↓
quality filter
    ↓
diversity filter
    ↓
final selection
    ↓
serialize
```

Easy and medium can continue using simpler acceptance if runtime becomes an issue, but the same metric collection should be available for diagnostics.

---

# 16. New Diagnostics Required

A diagnostic batch is required before final thresholds are fixed.

For at least several thousand generated candidates, record distributions for:

```text
reverseSteps
moveCount
crossingMoveCount
eatCount
groupsUsed
expandedStates
maxFrontierSize
score
```

Also record:

```text
number of solvable candidates
number of unsolvable candidates
number of already-solved candidates
number of duplicate candidates
number of candidates per group-count participation
```

## 16.1 Group participation diagnostic

For each goal group index, report how often it appears in the solved level.

Example:

```text
Group 0: 61%
Group 1: 55%
Group 2: 49%
Group 3: 44%
```

The desired result is not necessarily equality, but the extreme first-group skew should disappear.

## 16.2 Crossing diagnostic

Report:

```text
0 crossings: X%
1 crossing : Y%
2 crossings: Z%
3+ crossings: W%
```

This is especially important to compare against the existing baseline, which previously showed extremely low crossing participation.

## 16.3 Search-space diagnostic

Report percentiles for:

```text
expandedStates
maxFrontierSize
```

For example:

```text
P50
P75
P90
P95
P99
```

Difficulty thresholds should be based on observed distributions rather than arbitrary guesses whenever practical.

---

# 17. Recommended First Implementation Sequence

The changes should be implemented in this order to keep the effect of each change measurable.

### Phase 1 — Keep and verify Approach A

Implement the current Approach A changes exactly as specified:

- move the goal requirement to the box's interior cell;
- use `boxOriginalPosition` for pruning;
- remove `affectedPieceIds` provenance tracking;
- update related tests.

Then regenerate a diagnostic sample.

### Phase 2 — Randomize player start

Add multiple valid player-start locations and measure group participation.

Do not modify scoring yet.

### Phase 3 — Extend reverse-walk range

Increase the candidate reverse-step range to roughly `12..50`.

Run diagnostics and verify solver performance.

### Phase 4 — Add lightweight reverse heuristics

Add:

- anti-immediate-undo weighting;
- newly activated group bonus;
- repeated-group penalty;
- `inverseEat` preference.

Measure whether the candidate pool produces more multi-group and crossing solutions.

### Phase 5 — Add solver metrics

Extend BFS to report:

- expanded states;
- maximum frontier size;
- visited states;
- eat count;
- crossing count;
- groups used.

### Phase 6 — Replace difficulty scoring

Introduce the multi-factor score and hard minimum requirements.

Do not finalize constants until diagnostic distributions are available.

### Phase 7 — Candidate ranking and diversity

Generate a candidate pool, rank candidates, and select a diverse set of hard levels.

### Phase 8 — Regression and performance testing

Run the full generator test suite and multiple full batch generations.

Verify both quality and runtime / memory behavior.

---

# 18. Suggested Initial Configuration

Keep all tunable parameters centralized.

Example:

```ts
export const GENERATOR_CONFIG = {
  minReverseSteps: 12,
  maxReverseSteps: 50,

  inverseWeights: {
    push: 1.0,
    enter: 0.8,
    eat: 2.5,
  },

  newGroupBonus: 3.0,
  repeatedGroupPenalty: 0.5,
  immediateUndoPenalty: 0.2,

  hard: {
    minMoveCount: 20,
    minCrossingMoveCount: 2,
    minGroupsUsed: 2,
    minScore: 25,
  },
}
```

These numbers are **initial tuning values only**.

The design must not treat them as proven optimal thresholds.

---

# 19. What Should Not Be Changed

The following should remain unchanged unless a later experiment proves a concrete need:

- `applyMove()` and the game's forward rules;
- `checkWin()`;
- inverse-move correctness verification;
- `canonicalKey()`;
- the fundamental BFS shortest-path property;
- Approach A's interior goal requirement;
- serialization format.

The generator should adapt to the existing engine rather than creating a second rule system.

---

# 20. Expected Effects

After these changes, the generator should shift from mostly producing:

```text
short solution
+ few crossings
+ one dominant goal group
+ relatively small BFS search
```

toward a candidate distribution containing more:

```text
longer solutions
+ multiple required crossings
+ multiple active goal groups
+ more eat interactions
+ larger BFS search spaces
+ higher structural variety
```

The important success criterion is not simply that the average score increases.

A successful implementation should show all of the following in diagnostics:

1. More solvable candidates with `crossingMoveCount > 0`.
2. More candidates with `groupsUsed >= 2`.
3. A substantial increase in the upper tail of `expandedStates`.
4. Hard levels that satisfy explicit structural minimums rather than only a scalar score.
5. Less dependence on the first goal group's location.
6. Greater diversity among the final hard-level batch.

---

# 21. Testing Requirements

## 21.1 Seed tests

Add or update tests for:

- multiple valid player-start positions;
- no player/container/wall overlap;
- Approach A goal placement;
- `boxOriginalPosition` correctness.

## 21.2 Reverse generator tests

Test that:

- valid candidates are still verified by the real engine;
- weighted candidate selection does not accept invalid inverse moves;
- cycle detection still works;
- generation still terminates under the attempt limit.

## 21.3 Solver tests

Test that:

- shortest-path moves are unchanged;
- instrumentation counters are internally consistent;
- `expandedStates` and frontier metrics are non-negative;
- replaying the returned solution still reaches a win state.

## 21.4 Difficulty scorer tests

Test each metric independently and test the hard minimum constraints.

For example:

```text
high move count alone
high crossing alone
high groups alone
high expanded states alone
all combined
```

This ensures the scoring implementation does not accidentally make one metric dominate everything.

## 21.5 Batch-generation tests

Verify:

- requested tier quotas are met when enough candidates exist;
- duplicates are still filtered;
- hard levels satisfy hard requirements;
- accepted levels are solvable;
- the final selected hard levels are not all near-identical profiles.

---

# 22. Performance Considerations

The existing design already notes that BFS over the full `World` can produce large frontiers, especially with the 12×12 root and multiple interior boards.

The proposed changes increase the number of candidates and therefore can increase total solver work.

Mitigations:

- keep generation-time heuristics cheap;
- do not BFS-evaluate every possible reverse candidate;
- use a configurable candidate-pool size;
- keep `maxAttempts` configurable;
- collect solver metrics in the same BFS pass rather than running additional searches;
- monitor heap usage and generation time during diagnostic batches.

Do not increase the number of goal groups or interior sizes at the same time as all of these changes. Otherwise it becomes difficult to identify what caused a performance regression.

---

# 23. Acceptance Criteria

The design should be considered successful only after an empirical batch comparison against the current Approach A baseline.

At minimum, compare:

```text
% with crossingMoveCount > 0
% with crossingMoveCount >= 2
% with groupsUsed >= 2
% with groupsUsed >= 3
P50/P90/P95 expandedStates
P50/P90/P95 moveCount
hard-tier acceptance rate
average generation attempts per accepted hard level
solver runtime distribution
```

The final hard-level generator should demonstrate that its improvement is visible in actual generated levels, not only in the code structure.

---

# 24. Final Recommended Architecture

The intended end state is:

```text
                     ┌─────────────────────┐
                     │     Seed World      │
                     │  3-4 goal groups    │
                     │ diverse player start│
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │ Complexity-Aware     │
                     │ Reverse Walk         │
                     │                     │
                     │ • longer candidates │
                     │ • avoid oscillation  │
                     │ • prefer eat         │
                     │ • spread groups      │
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │       Prune         │
                     │ untouched groups    │
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │       BFS           │
                     │ shortest solution   │
                     │ + search metrics    │
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │ Difficulty Metrics  │
                     │                     │
                     │ moves               │
                     │ crossings           │
                     │ eats                │
                     │ groups              │
                     │ expanded states     │
                     │ frontier             │
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │ Hardness Filter     │
                     │ explicit minimums   │
                     │ + composite score   │
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │ Candidate Ranking   │
                     │ + Diversity Filter  │
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │ Final Level Batch   │
                     └─────────────────────┘
```

This architecture preserves the strong parts of the existing generator while specifically addressing the known causes of shallow difficulty: fixed player-start bias, underpowered reverse exploration, insufficient solver metrics, and acceptance based on a single simple score.

---

# 25. Files Expected To Change

| File | Proposed change |
|---|---|
| `tools/generator/seed.ts` | Random/diversified player start; retain Approach A goal placement |
| `tools/generator/generateLevel.ts` | Complexity-aware weighted reverse candidate selection; anti-oscillation heuristic |
| `tools/generator/solver.ts` | BFS instrumentation; solution mechanic metrics |
| `tools/generator/difficultyScorer.ts` | Multi-factor difficulty metrics and hard requirements |
| `tools/generator/generateBatch.ts` | Candidate pool, ranking, diversity filtering, new metrics flow |
| `tools/generator/*.test.ts` | New tests for seed, generator, solver metrics, scoring, and hard-tier selection |
| `src/levels/builtin/generated/*.json` | Regenerate only after empirical validation |

Unchanged by this design unless a later experiment proves otherwise:

```text
src/game/engine/*
tools/generator/inverseMoves.ts
tools/generator/canonical.ts
level serialization schema
```

---

# 26. Important Implementation Note

This document intentionally separates **mechanic necessity** from **difficulty generation**.

Approach A establishes that a surviving goal group really requires the box to be restored to its interior goal cell. The changes proposed here then make the generator more likely to produce worlds in which multiple such requirements interact and are harder to solve.

The final authority remains the actual forward engine plus BFS measurements. No heuristic, reverse-walk length, or score formula should be treated as proof that a level is difficult until it is validated empirically.
