# Parabox Generator Redesign: Random Generation + Solver Filtering

Date: 2026-09-18
Status: approved by user (chat, no further per-section review requested — see "Approval history" below)
Source brief: `c:\Users\a1003\Downloads\parabox_level_generator.md` (referred to below as "the md")

## 1. Goal

Replace the current generator's reverse-walk architecture (`tools/generator/seed.ts` +
`generateLevel.ts` + `inverseMoves.ts` — build a solved state, then walk backward to
produce the puzzle) with the md's architecture:

```
Random Generator -> Basic Validator -> Solver -> Difficulty Analyzer -> Filter -> Save
```

Scope for this round (per approval history below): the md's own Milestone 1
(GameState/Simulator/Solver — already exist — plus a new Random Generator and
Difficulty Analyzer), extended to also replace `generateBatch.ts`'s tier
classification + dedup + output-to-`src/levels/builtin/generated` pipeline, so the
new generator is the one actually shipping levels. Mutation/evolutionary search
(md §22-24), level diversity beyond simple dedup (md §25), and a Web UI (md §12)
are explicitly OUT of scope — later phases, not attempted here.

## 2. Approval history

- Replace the existing reverse-walk generator entirely (not run in parallel, not
  scoped to just the analyzer).
- Use only the existing game engine's capabilities: `container` pieces with a
  `boardRef` to an `interior` board, nested arbitrarily deep. No clone/possess
  mechanics. No actual cycles/self-reference generated in v1 (the engine's data
  model can theoretically represent a cycle, but nothing has ever exercised
  this, and building/validating it is out of scope here — `cycle_count` is
  reported as `0` honestly rather than attempted).
- Scope: Milestone 1 (generator + validator + analyzer) plus wiring into
  `generateBatch.ts`'s filter/tier/dedup/save pipeline. No mutation, no
  evolutionary search, no diversity-search beyond the existing dedup +
  greedy diverse-top-N selection, no `.txt` export (JSON stays), no UI.
- Random generator design: **flat Sokoban + optional container from day one**
  (not flat-only, not a reuse of the old fixed 2x2-slot board shape). Each box
  independently may live on the root board or be moved into a freshly
  generated interior board; each box's goal cell independently may sit on the
  same board as the box or on a different already-existing board.
- User explicitly waived further per-section chat review ("都可以，不要問我先
  把所有任務完成") — the remaining sections of this document were written
  directly rather than presented one at a time in chat, then this document
  itself serves as the record for future reference. Implementation proceeds
  straight from this document via the writing-plans skill, without a separate
  "please review the spec" pause.

## 3. Component inventory

**Reused as-is (engine-level facts, not reverse-walk-specific):**
- `src/game/engine/*` — untouched. `applyMove`/`resolveBlocked`/`checkWin` are
  the md's `simulate(state, action)` and win-check; already correct and
  already exercised by hundreds of tests.
- `tools/generator/canonical.ts` — state hashing, untouched.
- `tools/generator/solver.ts` — the md's BFS Solver. `SolveResult` already
  carries `expandedStates`, `visitedStates`, `maxFrontierSize`, which map
  directly to the md's `expanded_states`, `generated_states`, `max_queue_size`
  (§10). Gets ONE additive change: track branching factor per expanded state
  (§7 below) — existing search behavior and existing callers are unaffected.
  `countCrossingMoves`, `countPushMoves`, `countEatMoves`, `countBoxLines`
  are kept (general, not reverse-walk-specific). `countGroupsUsed` and
  `countFillerBoxesUsed` are deleted — both take a `SeedGroup`/filler-id list
  that no longer exists.
- Two geometry facts from `seed.ts`, extracted into a shared util rather than
  kept in the deleted file:
  1. `getEntryCell`-based math for finding a container's interior entry cell
     (already exported from `src/game/engine/rules.ts` — no extraction
     needed, just import it directly in the new generator).
  2. The **container-blockability fact**, confirmed by hand-reading
     `resolveBlocked`: pushing a piece into a container only triggers "enter"
     if the container itself cannot be pushed further in that same
     direction (a wall or board edge — or another piece — immediately
     behind it). A container generated in the open, with clear floor
     behind it in every direction, can only ever be pushed around and can
     never be entered — a silently broken, dead mechanic. The random
     generator's container placement rule (§5) bakes this in directly by
     construction rather than rediscovering it via trial and error.

**Rewritten:**
- `tools/generator/generateBatch.ts` — main loop becomes generate → validate →
  solve → analyze → filter → tier → dedup → save.
- `tools/generator/generatorConfig.ts` — replaced with the new config shape
  (§9).

**New:**
- `tools/generator/randomGenerator.ts` — board/box/goal/container generation.
- `tools/generator/basicValidator.ts` — cheap structural checks (md §6).
- `tools/generator/difficultyAnalyzer.ts` — branching, dead-end ratio,
  critical decisions, mechanic relevance (md §11-18).
- `tools/generator/filter.ts` — range-based `accept()` (md §20) + tier
  classification.

**Deleted** (concepts have no equivalent in the new architecture):
`seed.ts`, `seed.test.ts`, `generateLevel.ts`, `generateLevel.test.ts`,
`inverseMoves.ts`, `inverseMoves.test.ts`, `pruneUntouchedGoals.ts`,
`pruneUntouchedGoals.test.ts`, `injectObstacle.ts`, `injectObstacle.test.ts`,
`trimUnusedCells.ts`, `trimUnusedCells.test.ts`, `difficultyScorer.ts`,
`difficultyScorer.test.ts`. (`trimUnusedCells`'s cosmetic "wall off floor the
solution never visits" doesn't fit a board that started as a full random
fill rather than something carved out by a walk — dropped for v1; revisit if
shipped levels look visually cluttered.)

## 4. Random Generator (`randomGenerator.ts`)

**Root board:**
- Width and height each drawn independently from `widthRange`/`heightRange`.
- Every interior (non-border) cell is wall with probability drawn from
  `wallDensityRange` for this candidate, else floor. Border is always wall.
- No connectivity repair — an unusable layout is simply rejected by the
  validator and the whole candidate is discarded, matching the md's own
  generate → validate → discard loop (§21). This is the cheapest possible
  v1 approach; revisit only if the validator's rejection rate makes yield
  too low in diagnostics.

**Player:** one uniformly random floor cell on the root board.

**Boxes and goals** (count drawn from `boxCountRange`): boxes are generated
one at a time, in order, against a running list of "boards that exist so
far" (starts as just `[root]`, gains one entry each time a box gets a fresh
interior below). Each box makes two independent random choices:
1. **Home board**: with probability `containerProbability` *and* at least
   one existing board still below `maxNestingDepth`, this box gets a
   freshly built interior board (size drawn from `interiorSizeRange`) as
   its home, parented onto a uniformly random existing board that is below
   `maxNestingDepth` — which may be root or may be an interior board an
   earlier box already created, so nesting chains naturally deeper as more
   boxes are generated rather than every promoted box hanging directly off
   root. The new interior is appended to the "boards that exist so far"
   list (so a *later* box can nest inside *this* one). The container piece
   sits on a random floor cell of the parent board, touching a wall or
   board edge on one randomly chosen side (the container-blockability fact
   from §3), and the box itself starts inside the new interior on a random
   floor cell. Otherwise (probability roll fails, or every existing board
   is already at max depth) the box is a plain piece on a uniformly random
   already-existing board.
2. **Goal board**: independently, with probability `crossBoardGoalProbability`
   *and* at least one other board existing besides the box's own home board,
   the goal cell for this box is a `requirement: 'box'` floor cell on a
   uniformly random *different* already-existing board (forcing the box to
   be pushed across boards to win); otherwise the goal is on the box's own
   home board (plain single-board Sokoban push).

This is deliberately simple for v1: goals are always 1:1 with boxes (no
shared/either-or goals), every interior board has exactly one box in it at
generation time (no multi-box interiors yet — that's the old, shelved
multi-box-groups idea and stays shelved), and container promotion/goal
board choice are independent per box rather than jointly optimized.

## 5. Basic Validator (`basicValidator.ts`)

Cheap, synchronous, no solving. Rejects (returns a reason string) on:
- board width/height out of configured range (defensive; shouldn't happen
  given the generator draws from the same range, but a real check costs
  nothing and documents the invariant)
- any two pieces starting on the same cell
- any piece starting on a wall cell
- player piece missing
- goal count != box count
- any board (root or interior) whose floor cells are not a single connected
  region (flood fill from any floor cell; every other floor cell must be
  reachable) — an unreachable pocket makes the whole candidate suspect
  even if the player's own starting region happens to be fine
- any interior board with zero or more-than-one container referencing it
- nesting depth exceeding `maxNestingDepth`
- a container whose all 4 neighboring cells (in its own board) are floor
  with no piece on them — i.e., nothing blocks it in *any* direction, so it
  can never be entered (the container-blockability fact from §3; catches
  a rare generator bug rather than being expected to fire often, since the
  generator already places one blocking side by construction)

## 6. Solver enrichment (`solver.ts`)

`solve()`'s search loop already expands states and tracks
`expandedStates`/`visitedStates`/`maxFrontierSize`. Add one more piece of
bookkeeping, no change to search order or the returned path:

```ts
export interface SolveResult {
  moves: Direction[]
  expandedStates: number
  maxFrontierSize: number
  visitedStates: number
  // NEW: branchingFactors[i] = number of the 4 directions that produced a
  // valid (non-null) next state when the i-th expanded state was expanded,
  // in expansion order. Length === expandedStates.
  branchingFactors: number[]
}
```

This is the only change to `solve()`. Every existing caller that destructures
specific fields keeps working; every existing test that builds a `SolveResult`
literal (there are a couple) needs one extra field — mechanical, cheap fix
during implementation, not a design concern.

## 7. Difficulty Analyzer (`difficultyAnalyzer.ts`)

Produces one `DifficultyVector` per solved candidate:

```ts
export interface DifficultyVector {
  solutionLength: number
  expandedStates: number
  generatedStates: number       // = SolveResult.visitedStates
  maxQueueSize: number          // = SolveResult.maxFrontierSize
  avgBranching: number
  maxBranching: number
  deadEndRatio: number
  criticalDecisions: number
  spaceTransitions: number      // = countCrossingMoves(world, moves)
  nestedBoxUsed: boolean        // spaceTransitions > 0
  nestedBoxRequired: boolean    // see "mechanic relevance" below
  maxContainerDepthUsed: number // deepest board nesting level actually
                                 // entered along the solution path
}
```

Each metric's v1 definition, with honest simplifications flagged (this
project's own established rule: never silently upgrade an approximation to
sound more rigorous than it is):

- **avgBranching / maxBranching**: mean/max of `SolveResult.branchingFactors`.
  Direct, no simplification.
- **deadEndRatio**: `(# of branchingFactors[i] === 0) / expandedStates`.
  **Simplification**: this only counts states that are *immediately* stuck
  (zero legal moves at all), not "states from which the goal is provably
  unreachable" (the md's fuller intent in §15) — that would require either
  exhaustive BFS past the first solution (expensive, and this project
  already caps search via `maxSolverExpandedStates` for cost reasons) or a
  separate backward-reachability pass from the goal. Flagged in code
  comments exactly like this; if diagnostics later show this narrow
  definition doesn't correlate with anything useful (the same fate as
  `boxLineCount` earlier this session), it gets dropped from scoring, not
  quietly redefined to something it doesn't measure.
- **criticalDecisions**: for each state S on the optimal solution path with
  `remaining = solutionLength - stepIndex` moves left, look at every legal
  action from S other than the one actually taken. For each such
  alternative, re-`solve()` from the resulting state with
  `maxDepth = remaining + 1` (one move of slack, so an equally-short
  alternate solution still counts as "not a dead end", matching the md's
  own framing — a critical decision is one where the WRONG branch dead-ends,
  not one where multiple equally-good branches exist). If every alternative
  fails to reach the goal within that budget while the actual move
  succeeded, S counts as a critical decision. This reuses the same
  re-solve-to-verify pattern already proven out this session
  (`removeUnnecessaryFillerBoxes`, `tryInjectObstacle`), and stays cheap
  because it only runs for states actually on the optimal path (at most
  `solutionLength` of them) with a small `maxDepth` budget each.
- **spaceTransitions / nestedBoxUsed**: `countCrossingMoves` already counts
  exactly this (any move where some piece changes board) — reused directly.
- **nestedBoxRequired** ("mechanic relevance", md §18): freeze every
  container in the candidate world (replace each container piece's root
  cell with a plain wall, deleting the piece and its interior board along
  with it — nothing can be pushed into a wall) and re-`solve()` the frozen
  world with the same budget. If the frozen world is unsolvable, containers
  were load-bearing: `nestedBoxRequired = true`. Same freeze-and-resolve
  shape as the filler-box necessity check from earlier this session,
  applied to "the mechanic" instead of "one specific box".
- **maxContainerDepthUsed**: replay `moves` against `world`, track the
  current board's nesting depth (root = 0, each `boardRef` step +1) at
  every step, report the maximum.

## 8. Filter + Tier + Integration (`filter.ts` + rewritten `generateBatch.ts`)

```ts
export interface RangeFilter { min?: number; max?: number }
export interface DifficultyFilter {
  solutionLength?: RangeFilter
  expandedStates?: RangeFilter
  criticalDecisions?: RangeFilter
  deadEndRatio?: RangeFilter
  avgBranching?: RangeFilter
  requireNestedBox?: boolean
}
export function accept(vector: DifficultyVector, filter: DifficultyFilter): boolean
```

Direct port of the md's §20 `accept()` — every present range is a hard
requirement, absent ranges are unconstrained.

**Tier**: three named `DifficultyFilter` presets (`easy`/`medium`/`hard`) in
the new `GeneratorConfig`. `classifyTier(vector, tiers)` checks presets in a
fixed order — **`hard` first, then `medium`, then `easy`** — and returns the
first one whose `accept()` succeeds, or `'reject'` if none do. Checking the
most exclusive preset first (rather than least) means a candidate that
happens to satisfy both `hard` and `medium`'s ranges is classified `hard`,
matching the old scorer's own "check hard requirements first" priority and
avoiding ambiguity when presets overlap. **Concrete threshold numbers are
explicitly NOT
decided in this document** — this project has been burned twice already
this session by writing down plausible-looking thresholds before measuring
the real distribution (`hard.minMoveCount: 20` and `minScore: 25` from the
original spec both turned out structurally unreachable; the actual working
values came only from diagnostics against real generated candidates). The
implementation plan must include a diagnostic pass against the new
generator's own real output before any tier threshold is committed —
exactly the same discipline already used for `minReverseSteps`,
`obstacleBoxProbability`, and `boxLineCount` earlier this session.

**generateBatch.ts main loop:**
```
loop until each tier's quota is full or maxAttempts hit:
  candidate = randomGenerate(config)
  reason = basicValidate(candidate)
  if reason: record + continue
  solved = solve(candidate, maxDepth, maxSolverExpandedStates)
  if !solved: record "unsolvable" + continue
  if checkWin(candidate): record "already solved" + continue   // shouldn't
                                                                 // happen pre-solve,
                                                                 // kept as a
                                                                 // defensive guard
                                                                 // like the old loop had
  key = canonicalKey(candidate); dedupe against seenLevels
  vector = analyze(candidate, solved)
  tier = classifyTier(vector, config.tiers)  // first matching preset, or "reject"
  if tier === reject: record + continue
  if tier === 'hard': push to hardCandidate pool (existing selectDiverseTopN
                       + profileDistance machinery, ported to key off the
                       new DifficultyVector fields instead of the old
                       Approach-A-specific ones) else fill tier bucket directly
save selected levels, same JSON output shape (parseLevel/serializeLevel
unchanged — World is World regardless of how it was generated)
```

`selectDiverseTopN`/`profileDistance` are kept (cheap, already tested,
directly addresses the md's own §25 diversity concern without needing full
mutation/evolution) but their distance terms are rewritten against
`DifficultyVector` fields (`solutionLength`, `expandedStates`,
`criticalDecisions`, `avgBranching`, `spaceTransitions`) instead of the
deleted `survivingGroupCount`/`groupsUsed`.

## 9. New `GeneratorConfig` shape

```ts
export interface RandomGeneratorConfig {
  widthRange: [number, number]
  heightRange: [number, number]
  wallDensityRange: [number, number]
  boxCountRange: [number, number]
  containerProbability: number
  crossBoardGoalProbability: number
  interiorSizeRange: [number, number]
  maxNestingDepth: number
}

export interface GeneratorConfig {
  generator: RandomGeneratorConfig
  maxSolveDepth: number
  maxSolverExpandedStates: number
  tiers: { easy: DifficultyFilter; medium: DifficultyFilter; hard: DifficultyFilter }
  hardCandidatePoolSize: number
  diversityWeight: number
  maxAttempts: number
}
```

Starting values for `RandomGeneratorConfig` come straight from the md's own
§5 example (`width/height: [6,10]`, `wall_density: [0.15, 0.40]`,
`boxes: [1,4]`) as a documented starting point, explicitly expected to be
retuned once real yield/difficulty diagnostics come back — not treated as
final on arrival, same as every other number in this file.

## 10. Testing strategy

- `randomGenerator.test.ts`: deterministic `sequenceRng`-style tests (same
  style as the old `seed.test.ts`) proving each random choice consumes the
  RNG it's supposed to and produces the expected structure — board size,
  container placement + blockability, goal board choice.
- `basicValidator.test.ts`: one test per rejection reason in §5, each on a
  hand-built minimal world that trips exactly that condition and no other.
- `difficultyAnalyzer.test.ts`: hand-built worlds with known ground truth
  for each metric (a state with a known dead branch for `criticalDecisions`,
  a container that's provably load-bearing vs. one that isn't for
  `nestedBoxRequired`, etc.) — same rigor already used for
  `countBoxLines`'s tests this session.
- `filter.test.ts`: boundary tests on `accept()`'s range inclusion.
- `generateBatch.test.ts`: rewritten against the new pipeline, same
  contracts as before (tier quota reporting, no-duplicate-canonical-states,
  every accepted level unsolved and round-trips through
  `parseLevel`/`serializeLevel`).
- No changes needed to `src/game/engine/*` tests — the engine itself is
  untouched.

## 11. Rollout

1. Build + unit-test each new module in isolation (generator, validator,
   analyzer, filter) against hand-built worlds — no wiring yet.
2. Wire into a new `generateBatch.ts`, run a diagnostic pass (yield rate,
   solved rate, difficulty vector distributions) before choosing any tier
   threshold, exactly like every prior tuning round this session.
3. Set tier thresholds from the observed distribution, not from a guess.
4. Delete the old reverse-walk modules and their tests (§3's deleted list).
5. Full `tsc`/test suite, regenerate shipped levels, verify JSON, verify
   dev server, commit.
