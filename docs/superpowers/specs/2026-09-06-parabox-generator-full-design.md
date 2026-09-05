# Parabox Level Generator — Full Design: Approach A + Complexity-Aware Hard-Level Generation

**Status:** Draft for review (sub-project 4c)
**Supersedes:** `2026-09-05-parabox-generator-multigoal-design.md` (sub-project 4b) — that spec's seed/pruning design is described here as it exists today, with Approach A and the hard-level redesign layered on top. 4b's spec is not deleted; this document is the current source of truth for the generator going forward.
**Incorporates:** the design proposed in `2026-09-06-parabox-generator-hard-level-design (1).md`, and a subsequent review of that integrated design, `2026-09-06-parabox-generator-hard-level-design-review.md` — both adapted and hand-verified against the actual current codebase. The review caught a real crash bug in the previous draft of this document (§4.6) plus several genuine design weaknesses (§9-§10); this revision fixes all of them.

## 1. Purpose

This document is self-contained: it describes the entire level-generator pipeline, specifies **Approach A** (fixing 4b's mechanic-usage regression), and specifies a **complexity-aware hard-level redesign** layered on top of Approach A (fixing 4b's separately-identified player-start skew and the generator's general inability to reliably produce structurally hard levels).

Three problems motivate this, all measured on the 4b-shipped generator:

1. **Mechanic-usage regression:** 0 of 10 shipped levels had any board-crossing move in their optimal solution (vs 3/10 pre-4b). Root cause: a goal's win condition sat on the container's own root cell, and any non-player occupant (including the container itself) satisfies it — so leaving the container untouched was always a sufficient win. **Fixed by Approach A** (§4).
2. **Player-start skew:** the player always starts in the same slot, so per-group touch frequency was heavily skewed (measured: goal0=659, goal2=113, goal1=92, goal3=7 over 1417 walks) — capping observed multi-group participation and suspected to suppress the 'hard' tier. **Fixed by player-start diversification** (§6.1).
3. **Difficulty is under-measured:** a single `moveCount + crossingMoveCount*5` score conflates a long-but-trivial walk with a genuinely complex one, gives no minimum structural requirements for 'hard', and the batch generator accepts the first candidate that clears a tier rather than selecting the best/most diverse ones. **Fixed by BFS instrumentation, a multi-factor score anchored on eat interactions and surviving goal groups (not board-crossings in general), a hard-biased seed profile, and marginal-value candidate ranking** (§7-§10).

The design continues to treat the real forward engine (`applyMove`) and the real BFS solver as the sole source of truth for both correctness and difficulty — no heuristic, reverse-walk length, or score formula is ever treated as proof that a level is difficult until it is measured from an actual solved candidate.

## 2. Engine primitives (unchanged, out of scope)

- `World = { boards, pieces, locations }` (`src/game/engine/types.ts`). `Board { id, size, cells }`, `Cell { type: 'floor'|'wall', requirement?: 'player'|'box' }`, `Piece { id, kind: 'player'|'normal'|'container', boardRef? }`, `Location { board, x, y }`.
- `occupantAt(world, location)`, `findContainerFor(world, boardId)`, `cloneWorld` (= `structuredClone`), `step`, `opposite`, `inBounds` — small geometry/lookup helpers used throughout the generator.
- `checkWin(world)` (`rules.ts:154-169`): scans **every board's every cell**; for each cell with a `requirement`, finds its occupant (`occupantAt`) and fails the whole check if the cell is unoccupied, or if `requirement==='player'` and the occupant isn't a player, or if `requirement==='box'` and the occupant *is* a player. Any non-player occupant (a plain box, or a container) satisfies a `'box'` requirement. This scan is global and board-agnostic — a requirement cell on an interior board is checked exactly like one on `root`. This is what makes Approach A possible without any engine change.
- `getEntryCell(board, dir, relativeCoord)` (`rules.ts:30-`) — given a board, a direction, and a `Fraction` offset along that edge, returns the cell on that edge (or `null` if out of bounds). The generator always calls this with `HALF = makeFraction(1,2)` (center of the edge), which always resolves to an in-bounds cell for any board size ≥ 1.
- `applyMove(world, dir)` — the **forward** move engine, entered via `tryMovePiece(world, PLAYER_ID, dir, ...)`. Its resolution order (`resolveBlocked`, `rules.ts:125-152`), verified by hand-tracing a concrete example in this session: when the player (or, recursively, a piece already in motion) is blocked by an occupant, it tries, in order: (a) push the occupant forward; (b) have the mover **enter** the occupant, if the occupant is a container; (c) have the occupant be **eaten** into the mover, if the *mover* is a container. Point (c) is why "eat" in this codebase means *a container swallows whatever's blocking it as the container itself advances* — concretely, for the generator's own seed geometry (player → container → box → wall, four cells in a row), pushing the player into the container pushes the container into the box, the box can't be pushed further (wall beyond it), so the box gets swallowed into the container's own interior while the container advances into the box's old cell. This hand-verified trace is the basis for §8's `countEatMoves`.
- `canonicalKey(world)` (`canonical.ts`) — deterministic, key-sorted JSON hash, used for cycle detection during generation and visited-state dedup during solving.

## 3. Pipeline overview

```text
createSeedWorld(rng, seedProfile)                 (seed.ts)
  → SeedResult { world, groups }
generateLevel(seed, groups, steps, rng)           (generateLevel.ts)
  → GenerationResult { world, events } | null
pruneUntouchedGoals(world, groups)                (pruneUntouchedGoals.ts)
  → World
getSurvivingGroups(world, groups)                 (pruneUntouchedGoals.ts)
  → SeedGroup[]
Approach-A invariant check (every surviving group's box has moved)
checkWin / canonicalKey dedup                     (rules.ts / canonical.ts)
solve(world, maxDepth)                            (solver.ts)
  → SolveResult { moves, expandedStates, maxFrontierSize, visitedStates } | null
countCrossingMoves / countEatMoves / countGroupsUsed(..., survivingGroups)   (solver.ts)
  → DifficultyMetrics
difficultyTier(metrics) / checkHardRequirements(metrics)   (difficultyScorer.ts)
  → 'easy' | 'medium' | 'hard'  (+ which hard requirement, if any, was missed)
[hard only] pool → marginal-value ranked selection   (generateBatch.ts)
serializeLevel                                    (levelSchema.ts, unchanged)
```

Compared to the first integrated draft of this document, this revision: (1) introduces `getSurvivingGroups` and threads its result into every post-pruning group-based metric, fixing a crash where `countGroupsUsed` dereferenced pieces that pruning had already deleted (§4.6); (2) makes `eatCount` and `survivingGroupCount` — not `crossingMoveCount` — the primary hard-tier structural gates (§9); (3) gives hard-pool generation attempts a distinct, more structurally-generous seed profile once easy/medium quotas are filled (§6.4); (4) replaces the earlier threshold-based diversity filter with marginal-value greedy selection, removing the need to validate a `diversityMinDistance` threshold at all (§10).

## 4. Approach A: move the win condition into the interior

**Core change:** a goal group's `'box'` requirement cell moves from the container's root cell to the box's own cell inside the container's interior. Winning a group now means "a non-player piece occupies the cell the box started on, inside that interior" — and since nothing but a real forward *eat* move (or its reverse-walk counterpart, `inverseEat`) ever changes that cell's occupant, every surviving group structurally requires the eat mechanic to solve.

### 4.1 Why this needs no engine change

`checkWin` already treats every board's requirement cells uniformly (§2) — moving *where* a requirement lives is entirely a `seed.ts`-level change.

### 4.2 The one-way-door property (soundness of a position-based pruning check)

Re-verified by hand-tracing `inverseMoves.ts` fresh in this session: `inversePush` and `inverseEat` both keep the player on the *same* board — neither ever changes `world.locations[PLAYER_ID].board`. `inverseEnter` is the only function that ever changes the player's board at all, and only in one direction (interior → parent): its precondition (`findContainerFor(world, loc.board)` — the player's *current* board must already be some container's interior) requires the player to already be standing inside an interior *before* this step runs. Since the player starts on `root` at the seed (`world_0`), and by induction no step from `world_0` to any later `world_i` ever moves the player onto a non-root board (the only candidate, `inverseEnter`, only ever moves the player *off* one), the player's board is invariantly `root` for the entire walk, at every step — not merely "at the end," and not merely "usually." `inverseEnter`'s precondition can therefore never be satisfied at any point in a root-seeded walk (empirically confirmed in 4b: 1000+ sampled walks, `enter: 0` fired, every time), so it is permanently dead in this generator. `inverseEat` is the *only* function that ever moves a container or box, and it only ever **extracts** a box from its interior to `root` — its precondition requires a piece already occupying the interior's entry cell, so once that cell is empty, this exact container can't fire `inverseEat` again, and no other function ever inserts a piece back onto an interior board. So "is the box still at its seed-placed interior cell" is a genuine one-way-door fact: true until (at most) one extraction, false forever after. This is safe in a way the *container's* root position never was (which is why 4b's reviewer correctly rejected container-position pruning): in a hypothetical engine where the player *could* end up inside an interior without moving its container, a container could stay at its seed position while the group is genuinely in play — the box has no equivalent ambiguity, because nothing but eat/un-eat ever touches it in either direction.

**Cross-check against 4b's review file** (`2026-09-05-parabox-generator-multigoal-review.md`), whose core objection was exactly "position-unchanged does not imply untouched": that objection targeted the *container's* position specifically because `inverseEnter` could (in principle) put the player inside a group's interior without moving that group's container. The scenario the review actually feared — player standing inside a group's interior whose box hasn't moved, silently pruned away — requires the player's board to become that interior in the first place, which the paragraph above shows can never happen at any point in a root-seeded walk (not just "inverseEnter doesn't fire," but "no function ever moves the player onto a non-root board at all," which is the stronger and more precisely correct claim). So this is not a live risk for Approach A's box-position check today. It remains a *hypothetical* risk this design does not rely on being permanently impossible: `pruneUntouchedGoals.ts`'s `removeGroup` keeps the same defensive throw 4b added for exactly this class of risk (§4.5) — if the player is ever found on a board being pruned, it throws rather than silently corrupting the `World`, regardless of which position check triggered the prune decision or which future change to `inverseMoves.ts` might one day make the scenario reachable. The throw is what actually keeps this safe against the future; the position check is only an optimization that is provably correct *today*, on the code as it exists.

### 4.3 `SeedGroup` changes

`SeedGroup` gains `boxOriginalPosition: { x: number; y: number }` — the box's position inside its own interior, which pruning checks. The existing `originalPosition` (container's root position) is kept for descriptive completeness but is no longer consulted by pruning.

### 4.4 `pruneUntouchedGoals.ts` changes

`computeTouchedGroups` and all `GenerationEvent`-derived provenance tracking are removed. A group is untouched iff its box is still exactly where the seed placed it:

```ts
export function isGroupUntouched(world: World, group: SeedGroup): boolean {
  const loc = world.locations[group.boxId]
  return (
    loc.board === group.interiorId &&
    loc.x === group.boxOriginalPosition.x &&
    loc.y === group.boxOriginalPosition.y
  )
}
```

`isGroupUntouched` is exported (not merely a private helper) because §4.6's Approach-A invariant check reuses it directly, rather than duplicating the position comparison.

### 4.5 `removeGroup` keeps its defensive throw

`removeGroup` keeps its defensive player-deletion throw (still provably unreachable today, still free insurance — see §4.2's cross-check), but drops the "clear the container's root cell requirement" step, since under Approach A the root cell never carries a requirement. `pruneUntouchedGoals(world, groups)` stays 2-argument. Full code is in §11.3's merged `pruneUntouchedGoals.ts` listing.

### 4.6 Surviving groups after pruning (fixes a crash bug found in review)

After `pruneUntouchedGoals` runs, some `SeedGroup` entries in the original `groups` array no longer correspond to anything in `world` — their container/box pieces and interior board have been deleted. The first integrated draft of this design passed the *original, unpruned* `groups` array straight into `countGroupsUsed(world, moves, groups)` (§8) — for a removed group, `world.locations[group.boxId]` is `undefined`, and `countGroupsUsed`'s body dereferenced `.board` off that `undefined` value without a guard, so it would throw on the very first pruned batch run. This was caught by review, not by the original hand-verification pass, and is fixed by introducing an explicit "surviving groups" concept and using it everywhere a metric needs to iterate live groups:

```ts
export function getSurvivingGroups(world: World, groups: SeedGroup[]): SeedGroup[] {
  return groups.filter(
    (group) =>
      world.pieces[group.containerId] !== undefined &&
      world.pieces[group.boxId] !== undefined &&
      world.boards[group.interiorId] !== undefined,
  )
}
```

Two independent protections are applied, per the review's own reasoning for keeping both: `getSurvivingGroups` gives every downstream metric the *correct semantic scope* (only groups that still exist), and `countGroupsUsed` itself (§8) additionally guards against missing pieces defensively, so it stays safe even if a future caller forgets to filter first. `getSurvivingGroups` lives in `pruneUntouchedGoals.ts`, next to the pruning logic it inspects.

**Approach-A invariant, checked once per candidate in `generateBatch.ts`:** every surviving group's box must actually be away from its seed position — that is, by definition, `!isGroupUntouched(world, group)` for every `group` in `getSurvivingGroups(world, groups)`. This should be tautologically true given correct pruning (a group survives *because* it wasn't untouched), but checking it explicitly, using the exported `isGroupUntouched` rather than re-deriving the condition, catches a future edit to `pruneUntouchedGoals` or `getSurvivingGroups` that silently desyncs the two. It throws (rather than discarding-and-continuing) because — like `removeGroup`'s player-deletion guard — this should be provably impossible today; a violation means the generator's own invariants are broken, not that this particular candidate was unlucky.

### 4.7 Soundness of "every surviving group requires eat"

1. No engine change needed (§4.1).
2. After pruning, only groups whose box has moved from its seed position survive — and the box can only have moved via a real eat interaction (§4.2).
3. BFS finds the *shortest* solution, so if there were a shorter push-only solve available, it would be found instead. Approach A removes that shorter solve from existing at all for a surviving group, because leaving the box out of place means `checkWin` reports `false` for that group — there is no trivial win to fall back to.
4. `inverseEnter`'s irrelevance and the defensive throw's insurance are both unaffected by Approach A (§4.2).

## 5. Recap: 4b's still-current provisions (unaffected by this document)

- The 2×2 slot-grid seed layout, 3-4 goal groups, randomized wall direction, randomized interior size (3 or 5) — kept, and generalized with helper functions in §6.1.
- Slots occupy disjoint 5×5 coordinate blocks with **no gap between them** (corrected from 4b's original "2-cell buffer" claim, which an earlier review caught as false: slot 0 spans x=1..5, slot 1 spans x=6..10, adjacent with no buffer). The actual invariant: each slot's container sits at local (2,2), and its 4 possible wall cells stay within the same local 5×5 block (center ±1 in one axis), so no slot's geometry ever reaches into another slot's block regardless of layout randomization.
- `verifyPredecessor` (`inverseMoves.ts`) re-applies the real forward engine to every candidate inverse move and checks canonical-key equality before accepting it — "forward engine is the source of truth," unchanged and load-bearing for every generation heuristic added below (heuristics only ever choose *among* already-forward-verified candidates; they never bypass verification).

## 6. Player-start diversification and complexity-aware reverse walk

### 6.1 Randomize player start, derived from slot geometry

The player always starting at root `(2,2)` is exactly slot 0's own safe-diagonal-offset position. Generalizing: extract `getSlotOrigin`/`getSlotCenter` helpers (also removes the hand-duplicated `slotOriginX`/`slotOriginY`/`containerX`/`containerY` arithmetic 4b's seed had inlined), and pick the player's start from one of the 4 slot quadrants (the grid is always 2 columns × 2 rows regardless of whether `groupCount` is 3 or 4):

```ts
function getSlotOrigin(index: number): { x: number; y: number } {
  const row = Math.floor(index / GRID_COLS)
  const col = index % GRID_COLS
  return { x: 1 + col * SLOT_SIZE, y: 1 + row * SLOT_SIZE }
}

function getSlotCenter(index: number): { x: number; y: number } {
  const origin = getSlotOrigin(index)
  const center = Math.floor(SLOT_SIZE / 2) // = 2
  return { x: origin.x + center, y: origin.y + center }
}
```

The player's candidate position for slot `k` is one cell diagonally inside the slot from its center: `(getSlotCenter(k).x - 1, getSlotCenter(k).y - 1)`. For `k=0` this is exactly `(2,2)`, matching 4b's fixed position.

**Safety proof (hand-verified, not merely asserted):** a slot's 4 possible wall cells are the center ± 1 in exactly one axis (cardinal-adjacent); the player candidate is the center − 1 in *both* axes (diagonal) — these can never coincide, since the player candidate always differs from center in both coordinates while a wall cell always matches center in one coordinate. The candidate also never equals the container's own cell (nonzero offset). And since every slot occupies its own disjoint 5×5 block (§5), a candidate for slot `k` can never collide with any other slot's container/wall geometry, regardless of which slots currently host a group. So all 4 candidates are unconditionally safe, independent of `groupCount`, `playerSlot`, or the random wall-direction/interior-size draws for any group — including a slot with no group at all, which is simply plain floor.

### 6.2 Avoiding an unintended "remote start" confound (review §8)

An unconditional `playerSlot = Math.floor(rng() * 4)` mixes two different effects when `groupCount === 3`: sometimes the player lands in one of the 3 active slots (genuine balanced access), and sometimes it lands in the always-inactive 4th slot — which isn't "balanced access to existing groups," it's "the player starts somewhere with no groups nearby at all." The review correctly points out these are different phenomena for a difficulty generator and should not be silently conflated into one random draw. The fix keeps both effects, but makes the second one an explicit, separately-tunable probability rather than an automatic 1-in-4 side effect of slot count:

```ts
// Picks the player's starting slot. When every slot hosts a group
// (groupCount === PLAYER_START_SLOTS), every slot is a "balanced access"
// candidate. When some slots are inactive (groupCount === 3), balanced
// access normally means "among the 3 active slots" — a small, explicit
// probability instead sends the player to an inactive slot as a
// deliberate remote start, kept distinct from balanced access rather than
// silently mixed into it.
function pickPlayerSlot(rng: () => number, groupCount: number, profile: SeedProfile): number {
  if (groupCount >= PLAYER_START_SLOTS) {
    return Math.floor(rng() * PLAYER_START_SLOTS)
  }
  if (rng() < profile.remoteStartProbability) {
    const inactiveCount = PLAYER_START_SLOTS - groupCount
    return groupCount + Math.floor(rng() * inactiveCount)
  }
  return Math.floor(rng() * groupCount)
}
```

`profile.remoteStartProbability` is `0` in the default/general `SeedProfile` (§6.4) — so general-purpose seeding never produces a remote start, keeping the "balanced group accessibility" diagnostic (§12) clean — and nonzero only in the hard-biased profile, where a deliberately-remote player start is a plausible additional source of structural complexity worth measuring on its own terms. The §6.1 safety proof already covers this branch: an inactive slot's candidate cell is trivially safe (there's no container/wall there at all).

### 6.3 Complexity-aware weighted reverse walk

4b's `generateLevel` picked uniformly among valid inverse-move candidates (shuffle-then-take-first-valid == uniform random choice among valid options). The redesign replaces uniform choice with **weighted** choice, still restricted to real-engine-verified candidates, favoring `eat` and favoring touching groups that haven't been touched yet in this walk — while never blocking any option (all weights stay positive).

`generateLevel` takes `groups: SeedGroup[]` so it can attribute a candidate to a goal group (a candidate belongs to group `g` if it moves `g.containerId` or `g.boxId`):

```ts
function candidateWeight(
  kind: GenerationEventKind,
  moved: string[],
  groups: SeedGroup[],
  touchCounts: Map<string, number>,
  weights: GeneratorWeights,
): number {
  let weight = weights[kind]
  for (const group of groups) {
    if (!moved.includes(group.containerId) && !moved.includes(group.boxId)) continue
    const touches = touchCounts.get(group.containerId) ?? 0
    weight += touches === 0 ? weights.newGroupBonus : weights.repeatedGroupWeight / touches
  }
  return weight
}
```

This single mechanism deliberately covers both "reward activating a new group" and "de-emphasize a group the walk keeps returning to": a group's own weight contribution shrinks every time it's picked again (`repeatedGroupWeight / touches`), so an untouched group's flat `newGroupBonus` naturally becomes relatively more attractive over time, without ever hard-blocking repeat use (some good hard puzzles naturally concentrate on one container).

**"Avoid immediately undoing the previous event" is already structurally guaranteed and needs no separate heuristic.** The existing `seen: Set<string>` cycle-avoidance (unchanged since sub-project 4) already rejects any candidate whose resulting `canonicalKey` was already visited this walk — and undoing the immediately-preceding event produces exactly the state from before that event, which is already in `seen`.

**A slower A-B-A-B oscillation through a small region is a real, separate concern the `seen` set does *not* catch** (correctly identified by review §9): cycling through two or more distinct *states* forever revisits new canonical keys each time (so `seen` never rejects any of them), even though the walk isn't making net progress. This design deliberately **defers** adding a dedicated countermeasure (e.g. a `recentGroups` cooldown penalizing a group touched within the last few events) rather than building it in now: the weighted-selection mechanism above should be measured on its own first (§14, phase 5), since it's not yet established that A-B-A-B oscillation is common enough, under the new weights, to matter. If diagnostics after phase 5 show it does, a bounded-history soft penalty (`repeatPenalty = 1 / (1 + recentTouchCount)`, applied only within a short lookback window) is the recommended follow-up — never a hard prohibition, matching this design's general principle that heuristics only ever bias which forward-verified candidate is picked, never forbid one outright.

Full candidate collection and weighted pick:

```ts
function movedPieceIds(before: World, after: World): string[] {
  const ids: string[] = []
  for (const pieceId of Object.keys(before.locations)) {
    const a = before.locations[pieceId]
    const b = after.locations[pieceId]
    if (a.board !== b.board || a.x !== b.x || a.y !== b.y) ids.push(pieceId)
  }
  return ids
}

function weightedPick<T>(items: { weight: number; value: T }[], rng: () => number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng() * total
  for (const item of items) {
    roll -= item.weight
    if (roll <= 0) return item.value
  }
  return items[items.length - 1].value
}
```

**Note on `movedPieceIds` vs. Approach A's removed `affectedPieceIds`:** Approach A removed the *public* `affectedPieceIds` field from `GenerationEvent` because pruning switched to a direct position check and no longer needs event provenance (§4.4). `movedPieceIds` here is a *private* helper local to `generateLevel.ts`, used only to compute generation-time heuristic weights — it is never attached to `GenerationEvent`, and `pruneUntouchedGoals` still never consumes it. The two concerns (pruning correctness vs. generation-time heuristic weighting) remain fully decoupled.

### 6.4 Seed profiles: general vs. hard-biased (review §7)

The seed's `groupCount` (3 or 4) and each group's `interiorSize` (3 or 5) were flat 50/50 coin flips regardless of which tier a walk would eventually produce — reasonable for a general-purpose seed, but self-defeating for hard-candidate generation specifically, since 4 groups and larger interiors are a natural source of the structural capacity a hard level needs. `createSeedWorld` now takes an explicit `SeedProfile`:

```ts
export interface SeedProfile {
  fourGroupProbability: number
  largeInteriorProbability: number
  remoteStartProbability: number
}
```

`GENERATOR_CONFIG.seedProfile` (the default, `{ fourGroupProbability: 0.5, largeInteriorProbability: 0.5, remoteStartProbability: 0 }`) exactly reproduces the old flat-coin-flip behavior — this is a pure generalization, not a behavior change, for any caller that doesn't pass a different profile. `GENERATOR_CONFIG.hardSeedProfile` (`{ fourGroupProbability: 0.8, largeInteriorProbability: 0.8, remoteStartProbability: 0.25 }`) is what `generateBatch.ts` switches to once easy and medium quotas are already filled (§11.9) — at that point every further attempt exists solely to fill the hard candidate pool, so there's no reason not to bias fully toward hard-favorable seed structure. Before that point, general seeding is kept for all attempts, since hard-biased seeds could actually make it *harder* to fill easy/medium (larger, more-group seeds skew toward harder outcomes generally) — this trigger condition (switch profiles only once easy+medium are both already full) is this design's own resolution of an otherwise-unspecified detail in the source review, chosen because it cleanly separates "seeding that serves double duty for all three tiers" from "seeding that exists purely to feed the hard pool," without needing a second, separate generation loop.

As the review stresses: **larger structural capacity is a candidate-generation bias, not a guarantee of difficulty.** A hard-biased seed still goes through the exact same weighted reverse walk, pruning, solving, and hard-requirement gating as any other candidate — it is simply more likely, not certain, to end up satisfying them.

### 6.5 Wider reverse-step range

`steps = 3 + floor(rng()*20)` (range 3-22) becomes a config-driven range, `GENERATOR_CONFIG.minReverseSteps=12` to `maxReverseSteps=50`. This only enlarges the candidate pool — it is not itself a difficulty guarantee, and final acceptance is still gated entirely on `solve()`'s measured output (§7-§9). `generateLevel` already guarantees, by construction, that a non-null result has `events.length === steps` exactly (`if (events.length < steps) return null`) — so "requested reverse steps" and "actually achieved reverse steps" are always identical for any walk that survives to be scored; there is no separate bookkeeping needed here beyond reporting the (single) `reverseSteps` value in diagnostics (§12). The wider range plausibly increases per-walk runtime and `generateLevel`'s own attempt budget (`Math.max(steps,1)*20`, unchanged formula, now up to 1000 attempts per walk instead of 440) — flagged in §12 as something the mandatory diagnostic pass must measure, not assume is free.

## 7. Solver instrumentation

`solve` returns a `SolveResult` instead of a bare `Direction[] | null`, adding cheap-to-track BFS bookkeeping. No changes to move semantics, `applyMove` usage, or `canonicalKey`-based visited-set dedup — the shortest-path property is untouched. (The review's own §23 confirms this instrumentation should be kept exactly as designed — no changes here.)

```ts
export interface SolveResult {
  moves: Direction[]
  expandedStates: number
  maxFrontierSize: number
  visitedStates: number
}

export function solve(initialWorld: World, maxDepth = 200): SolveResult | null {
  if (checkWin(initialWorld)) {
    return { moves: [], expandedStates: 0, maxFrontierSize: 1, visitedStates: 1 }
  }

  const visited = new Set<string>([canonicalKey(initialWorld)])
  let frontier: { world: World; path: Direction[] }[] = [{ world: initialWorld, path: [] }]
  let depth = 0
  let expandedStates = 0
  let maxFrontierSize = frontier.length

  while (frontier.length > 0 && depth < maxDepth) {
    maxFrontierSize = Math.max(maxFrontierSize, frontier.length)
    const nextFrontier: typeof frontier = []
    for (const { world, path } of frontier) {
      expandedStates++
      for (const direction of DIRECTIONS) {
        const next = applyMove(world, direction)
        if (!next) continue
        const key = canonicalKey(next)
        if (visited.has(key)) continue
        visited.add(key)
        const newPath = [...path, direction]
        if (checkWin(next)) {
          return { moves: newPath, expandedStates, maxFrontierSize, visitedStates: visited.size }
        }
        nextFrontier.push({ world: next, path: newPath })
      }
    }
    frontier = nextFrontier
    depth++
  }
  return null
}
```

`solve` is only called from `generateBatch.ts` and tests (confirmed by grepping every call site in `tools/generator`) — there is no external caller needing backward compatibility, so this is a direct signature change, not an additive/optional field.

## 8. Solution-mechanic metrics: `countEatMoves`, `countGroupsUsed`

`countCrossingMoves(world, moves)` is unchanged. Two new functions replay the solution with the real forward engine (never inferring from coordinates alone) to measure the mechanics Approach A actually cares about:

```ts
export function countEatMoves(world: World, moves: Direction[]): number {
  const interiorIds = new Set(
    Object.values(world.pieces)
      .filter((piece) => piece.kind === 'container' && piece.boardRef !== undefined)
      .map((piece) => piece.boardRef as string),
  )
  let current = world
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countEatMoves received an invalid move for this world')
    for (const pieceId of Object.keys(current.locations)) {
      if (pieceId === PLAYER_ID) continue
      if (current.locations[pieceId].board === next.locations[pieceId].board) continue
      if (interiorIds.has(next.locations[pieceId].board)) {
        count++
        break
      }
    }
    current = next
  }
  return count
}

// `groups` MUST be the surviving groups (see section 4.6's getSurvivingGroups)
// — a group whose pieces were deleted by pruning has no entry in
// `current.locations`/`next.locations`, and the `!before || !after` guard
// below is a second, independent layer of defense (not a substitute for
// passing the right list): it keeps this function safe even if a future
// caller forgets to filter first, but callers should still always pass
// survivors so the metric's semantic scope is correct.
export function countGroupsUsed(world: World, moves: Direction[], groups: SeedGroup[]): number {
  const usedGroups = new Set<string>()
  let current = world
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countGroupsUsed received an invalid move for this world')
    for (const group of groups) {
      if (usedGroups.has(group.containerId)) continue
      for (const pieceId of [group.containerId, group.boxId]) {
        const before = current.locations[pieceId]
        const after = next.locations[pieceId]
        if (!before || !after) continue
        if (before.board !== after.board || before.x !== after.x || before.y !== after.y) {
          usedGroups.add(group.containerId)
          break
        }
      }
    }
    current = next
  }
  return usedGroups.size
}
```

**This is the crash bug the review found** (§4.6): the first draft of this document called `countGroupsUsed(world, solved.moves, groups)` with the *original, pre-pruning* `groups` array against the *post-pruning* `world` — for any removed group, `current.locations[group.boxId]` is `undefined`, and dereferencing `.board` off it throws. The fix is two-layered, matching the review's own reasoning for keeping both: callers must pass `getSurvivingGroups(world, groups)` (correct semantic scope — a metric like "how many groups participate in the solution" should only ever range over groups that still exist), and `countGroupsUsed` itself now also skips a pair with a missing location defensively (keeps the helper independently safe against future callers or malformed input, without relying on every caller getting the first part right).

`countEatMoves` derives "which boards are container interiors" from the piece table (`kind==='container'` → its `boardRef`) rather than from `SeedGroup`, since `Piece.boardRef` is immutable for the life of a `World` (§2) — this makes it usable on any `World`, not just ones with `SeedGroup` metadata still available, and mirrors the hand-verified forward mechanic from §2: a non-player piece's board changing *to* a container interior is, in this generator's piece vocabulary, exactly a box being eaten. `countGroupsUsed` counts a group as "used" if its container *or* box moves at all during the replayed solution (any move, not just a crossing) — intentionally broader than crossing/eating alone (e.g., a plain push of the container still counts as using that group).

`DifficultyMetrics` (§9) is assembled by `generateBatch.ts` from `solve`'s `SolveResult`, `getSurvivingGroups`'s count, plus these counting functions.

## 9. Multi-factor difficulty score and hard-tier acceptance

### 9.1 `crossingMoveCount` is the wrong primary hard-tier gate (review §5)

The first draft of this document gated 'hard' on `crossingMoveCount >= 2`. The review correctly points out that `countCrossingMoves` counts *any* move where a piece changes boards — which, in principle, includes an `enter` interaction, not only `eat`. Since Approach A's entire premise is that a surviving group's goal can only be satisfied by an eat interaction, the metric that actually measures "how many goal-restoring interactions this solution performs" is `eatCount`, not the more general `crossingMoveCount`. `crossingMoveCount` is kept in the score and in diagnostics (it's still a real, meaningful signal), but it is no longer one of the hard-tier's *structural minimums* — `eatCount` and `survivingGroupCount` (§9.2) take its place there.

### 9.2 `survivingGroupCount` is not the same thing as `groupsUsed` (review §4)

`survivingGroupCount` (how many goal groups remain in the level *at all* after pruning) and `groupsUsed` (how many of those materially participate in the shortest *solution*) answer different questions. Under Approach A they should normally track closely — every surviving group's goal requires an eat interaction to satisfy, so a fully-solved level should use every surviving group — but keeping both as separate, independently-measured metrics is valuable exactly because it catches an implementation mistake (a group that survives pruning but is somehow *not* required by the shortest solve would be a real bug, and having both numbers visible in diagnostics surfaces that immediately, rather than only ever seeing one blended number).

```ts
export interface DifficultyMetrics {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  survivingGroupCount: number
  groupsUsed: number
  expandedStates: number
  maxFrontierSize: number
}
```

`maxFrontierSize` is carried in `DifficultyMetrics` for diagnostics (it helps detect levels that are expensive for BFS in a way total `expandedStates` alone doesn't capture) but, per §9.3, deliberately does not enter the score formula.

### 9.3 Score and hard requirements

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

export interface HardRequirementCheck {
  isHard: boolean
  meetsMinMoveCount: boolean
  meetsMinEatCount: boolean
  meetsMinSurvivingGroupCount: boolean
  meetsMinGroupsUsed: boolean
  meetsMinScore: boolean
}

export function checkHardRequirements(metrics: DifficultyMetrics): HardRequirementCheck {
  const { hard } = GENERATOR_CONFIG
  const meetsMinMoveCount = metrics.moveCount >= hard.minMoveCount
  const meetsMinEatCount = metrics.eatCount >= hard.minEatCount
  const meetsMinSurvivingGroupCount = metrics.survivingGroupCount >= hard.minSurvivingGroupCount
  const meetsMinGroupsUsed = metrics.groupsUsed >= hard.minGroupsUsed
  const meetsMinScore = scoreDifficulty(metrics) >= hard.minScore
  return {
    isHard:
      meetsMinMoveCount && meetsMinEatCount && meetsMinSurvivingGroupCount &&
      meetsMinGroupsUsed && meetsMinScore,
    meetsMinMoveCount,
    meetsMinEatCount,
    meetsMinSurvivingGroupCount,
    meetsMinGroupsUsed,
    meetsMinScore,
  }
}

export function difficultyTier(metrics: DifficultyMetrics): 'easy' | 'medium' | 'hard' {
  if (checkHardRequirements(metrics).isHard) return 'hard'
  return scoreDifficulty(metrics) < 10 ? 'easy' : 'medium'
}
```

`checkHardRequirements` is a separate exported function (rather than inlining its logic into `difficultyTier`) specifically so `generateBatch.ts` can reuse the exact same predicate to report *which* hard requirement a near-miss candidate failed (§11.9's rejection-reason counters, §12) — without duplicating the condition logic in two places that could drift out of sync. `log2(expandedStates+1)` is used (not the raw count) because BFS state counts can grow much faster than move counts and would otherwise dominate the score outright — and, per the review's §10, `expandedStates`/`maxFrontierSize` measure *solver search effort*, not directly what a human player experiences, so they are kept as the lowest-precedence score component and, critically, `checkHardRequirements` never depends on them at all: a level cannot become 'hard' solely because BFS happened to explore many states while the underlying puzzle has one simple goal interaction. A candidate that clears the score threshold but misses a structural minimum falls through to 'medium', not 'easy'.

All weights and thresholds live in one place (§9.4), and every one of them is an **initial tuning value**, not a proven-optimal constant — the mandatory diagnostic pass (§12) must validate or revise them against measured distributions before they're trusted for a real batch.

### 9.4 `generatorConfig.ts` (new file)

```ts
export interface GeneratorWeights {
  push: number
  enter: number
  eat: number
  newGroupBonus: number
  repeatedGroupWeight: number
}

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
  hard: {
    minMoveCount: 20,
    minEatCount: 2,
    minSurvivingGroupCount: 2,
    minGroupsUsed: 2,
    minScore: 25,
  },
  hardCandidatePoolSize: 60,
  diversityWeight: 10,
}
```

`seedProfile` reproduces the previous flat-50/50 behavior exactly (§6.4); `hardSeedProfile` is the hard-biased profile. `diversityWeight` replaces the earlier draft's `diversityMinDistance` — see §10 for why a fixed rejection threshold is no longer needed at all, rather than needing to be separately validated.

## 10. Candidate ranking and diversity selection (hard tier only)

Easy and medium keep 4b's simple first-match acceptance (accept the first candidate that clears the tier and isn't full). Hard levels instead accumulate into a bounded candidate pool, then get selected via a marginal-value greedy algorithm — replacing this document's earlier threshold-based diversity filter (sort by score, reject anything within a fixed `diversityMinDistance` of an already-selected candidate, backfill if that leaves the quota short).

**Why the threshold approach is replaced (review §14-§15):** a fixed `diversityMinDistance = 0.5` was an unvalidated guess, and — because the profile's dimensions have very different natural scales — no single threshold is obviously right without first measuring pairwise distances across a real candidate pool. The review's suggested alternative, greedy marginal-value selection, sidesteps needing a validated threshold at all: instead of a hard accept/reject cutoff, each remaining candidate's *value* for the next pick is its own score plus a bonus for how different it is from what's already been selected, and the highest-value candidate is picked each round.

```ts
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

// Greedy marginal-value selection: repeatedly pick whichever remaining
// candidate maximizes (its own score) + (diversityWeight * its distance to
// the nearest already-selected candidate). The first pick is always the
// single highest-scoring candidate (no diversity bonus applies yet).
// Unlike a hard distance cutoff, this always fills up to
// min(n, candidates.length) — when every remaining candidate is similar to
// what's selected, the algorithm still picks the best-scoring one available
// each round, so there is no separate "backfill" pass to reason about.
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
```

`DifficultyProfile` now includes `survivingGroupCount` (added alongside `eatCount`, per review §11-§13's emphasis that these are the dimensions that actually distinguish structurally different hard levels — e.g. "2-group, many eats" vs. "3-group, long solution" are genuinely different puzzle families). The review's §12-§13 additionally proposed a wholly separate categorical "complexity signature" type and a two-layer (numeric distance + categorical distance) diversity comparison; this design deliberately does **not** add that second, parallel representation — `survivingGroupCount` and `eatCount` are already first-class dimensions of `DifficultyProfile`, weighted into the same `profileDistance` used for selection, which addresses the review's actual underlying concern (don't ship five hard levels that are all the same structural family) with one mechanism instead of two. If diagnostics ever show the numeric profile distance is insufficient to separate genuinely different puzzle families, a categorical signature is a reasonable follow-up — it is not added preemptively here.

`selectDiverseTopN`, `profileDistance`, and `HardCandidate` are all exported from `generateBatch.ts` so they can be unit-tested directly against synthetic candidate lists (§13), rather than only indirectly through a full random batch run.

## 11. Full merged file listings

The following are the complete, final contents of every file this design touches. No separate "earlier draft" version of these files is shown elsewhere in this document — this section is authoritative.

### 11.1 `tools/generator/generatorConfig.ts` (new)

See §9.4 for the full listing — reproduced there in full, not duplicated here.

### 11.2 `tools/generator/seed.ts`

```ts
import {
  Cell, Direction, PLAYER_ID, World,
  step, opposite,
} from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { GENERATOR_CONFIG, SeedProfile } from './generatorConfig'

const GRID_COLS = 2
const SLOT_SIZE = 5
const ROOT_SIZE = 2 + GRID_COLS * SLOT_SIZE // = 12
// GRID_COLS(2) x 2 rows, matching ROOT_SIZE's own derivation (groupCount is
// always 3 or 4, and ceil(3/2) === ceil(4/2) === 2 rows).
const PLAYER_START_SLOTS = 4
const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function makeFloorCells(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const })))
}

function getSlotOrigin(index: number): { x: number; y: number } {
  const row = Math.floor(index / GRID_COLS)
  const col = index % GRID_COLS
  return { x: 1 + col * SLOT_SIZE, y: 1 + row * SLOT_SIZE }
}

function getSlotCenter(index: number): { x: number; y: number } {
  const origin = getSlotOrigin(index)
  const center = Math.floor(SLOT_SIZE / 2) // = 2
  return { x: origin.x + center, y: origin.y + center }
}

// Picks the player's starting slot. When every slot hosts a group
// (groupCount === PLAYER_START_SLOTS), every slot is a "balanced access"
// candidate. When some slots are inactive (groupCount === 3), balanced
// access normally means "among the active slots" — a small, explicit
// probability instead sends the player to an inactive slot as a
// deliberate remote start, kept distinct from balanced access.
function pickPlayerSlot(rng: () => number, groupCount: number, profile: SeedProfile): number {
  if (groupCount >= PLAYER_START_SLOTS) {
    return Math.floor(rng() * PLAYER_START_SLOTS)
  }
  if (rng() < profile.remoteStartProbability) {
    const inactiveCount = PLAYER_START_SLOTS - groupCount
    return groupCount + Math.floor(rng() * inactiveCount)
  }
  return Math.floor(rng() * groupCount)
}

// A group's identity as constructed by the seed. `boxOriginalPosition` is
// the box's position on its own interior board — this is both the group's
// win condition and the one-way-door pruning check (see
// pruneUntouchedGoals.ts): nothing but a real eat move ever changes it, in
// either direction. `originalPosition` (the container's root position) is
// kept for descriptive completeness but is no longer consulted by pruning.
export interface SeedGroup {
  containerId: string
  boxId: string
  interiorId: string
  originalPosition: { x: number; y: number }
  boxOriginalPosition: { x: number; y: number }
}

export interface SeedResult {
  world: World
  groups: SeedGroup[]
}

export function createSeedWorld(
  rng: () => number = Math.random,
  profile: SeedProfile = GENERATOR_CONFIG.seedProfile,
): SeedResult {
  const groupCount = rng() < profile.fourGroupProbability ? 4 : 3
  const playerSlot = pickPlayerSlot(rng, groupCount, profile)

  const cells: Cell[][] = Array.from({ length: ROOT_SIZE }, (_, y) =>
    Array.from({ length: ROOT_SIZE }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === ROOT_SIZE - 1 || y === ROOT_SIZE - 1
      return { type: isBorder ? 'wall' : 'floor' } as Cell
    }),
  )

  const boards: World['boards'] = {}
  const pieces: World['pieces'] = { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } }
  const locations: World['locations'] = {}
  const groups: SeedGroup[] = []

  for (let i = 0; i < groupCount; i++) {
    const { x: containerX, y: containerY } = getSlotCenter(i)

    const wallDir = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]
    const wallPos = step(containerX, containerY, wallDir)
    cells[wallPos.y][wallPos.x] = { type: 'wall' }
    // No requirement on the container's own root cell — Approach A: the
    // container merely occupying its cell must never be sufficient to win.
    cells[containerY][containerX] = { type: 'floor' }

    const interiorSize = rng() < profile.largeInteriorProbability ? 5 : 3
    const interiorId = `goal${i}Inside`
    const containerId = `goal${i}`
    const boxId = `box${i}`

    const interior = { id: interiorId, size: interiorSize, cells: makeFloorCells(interiorSize) }

    const { cell: eatenCell } = getEntryCell(interior, opposite(wallDir), HALF)
    if (eatenCell === null) {
      // Provably unreachable: HALF always maps to an in-bounds
      // center-of-edge cell for any board size >= 1.
      throw new Error(`createSeedWorld: getEntryCell unexpectedly returned null for interior size ${interiorSize}`)
    }
    // The win condition for this group: a non-player piece must occupy this
    // cell. Only the pre-placed box starts here, and it can only leave via
    // a real eat move (see the full design spec's one-way-door argument).
    interior.cells[eatenCell.y][eatenCell.x] = { type: 'floor', requirement: 'box' }
    boards[interiorId] = interior

    pieces[containerId] = { id: containerId, kind: 'container', boardRef: interiorId }
    pieces[boxId] = { id: boxId, kind: 'normal' }
    locations[containerId] = { board: 'root', x: containerX, y: containerY }
    locations[boxId] = { board: interiorId, x: eatenCell.x, y: eatenCell.y }

    groups.push({
      containerId,
      boxId,
      interiorId,
      originalPosition: { x: containerX, y: containerY },
      boxOriginalPosition: { x: eatenCell.x, y: eatenCell.y },
    })
  }

  boards.root = { id: 'root', size: ROOT_SIZE, cells }
  // The player-start candidate for slot k is one cell diagonally inside the
  // slot from its center. This is always plain floor: it can never equal
  // the slot's container cell, nor any of its 4 possible wall cells (all
  // cardinal-adjacent to the center, never diagonal), and since every slot
  // occupies its own disjoint 5x5 coordinate block, it can never collide
  // with another slot's geometry either — true whether or not that slot
  // currently hosts a group.
  const { x: playerX, y: playerY } = getSlotCenter(playerSlot)
  locations[PLAYER_ID] = { board: 'root', x: playerX - 1, y: playerY - 1 }

  return { world: { boards, pieces, locations }, groups }
}
```

### 11.3 `tools/generator/pruneUntouchedGoals.ts`

```ts
import { World, cloneWorld, PLAYER_ID } from '../../src/game/engine/types'
import { SeedGroup } from './seed'

// A group is untouched iff its box still sits exactly where the seed placed
// it, on its own interior board — a one-way-door check (see the full design
// spec's section 4.2): nothing but a real eat/inverse-eat move ever changes
// the box's board or position, and once it leaves its interior nothing ever
// puts it back. Exported because section 4.6's Approach-A invariant check
// reuses this exact condition rather than re-deriving it.
export function isGroupUntouched(world: World, group: SeedGroup): boolean {
  const loc = world.locations[group.boxId]
  return (
    loc.board === group.interiorId &&
    loc.x === group.boxOriginalPosition.x &&
    loc.y === group.boxOriginalPosition.y
  )
}

// Groups whose pieces and interior board still exist in `world` after
// pruning. Every metric that iterates groups against a post-pruning World
// must use this, not the original seed's full `groups` array — see section
// 4.6 for the crash this fixes.
export function getSurvivingGroups(world: World, groups: SeedGroup[]): SeedGroup[] {
  return groups.filter(
    (group) =>
      world.pieces[group.containerId] !== undefined &&
      world.pieces[group.boxId] !== undefined &&
      world.boards[group.interiorId] !== undefined,
  )
}

function removeGroup(world: World, group: SeedGroup): World {
  const next = cloneWorld(world)

  for (const [pieceId, loc] of Object.entries(next.locations)) {
    if (loc.board !== group.interiorId) continue
    if (pieceId === PLAYER_ID) {
      // Provably unreachable today (see the full design spec's section 4.2)
      // — kept as a loud failure rather than removed, so a future change to
      // inverseMoves.ts/generateLevel.ts that breaks that invariant
      // surfaces immediately instead of silently corrupting the World.
      throw new Error(
        `pruneUntouchedGoals: refusing to remove group ${group.containerId} — ` +
          'the player is inside its interior. This indicates isGroupUntouched ' +
          'incorrectly classified a live group as untouched.',
      )
    }
    delete next.pieces[pieceId]
    delete next.locations[pieceId]
  }
  delete next.boards[group.interiorId]
  delete next.pieces[group.boxId]
  delete next.locations[group.boxId]
  delete next.pieces[group.containerId]
  delete next.locations[group.containerId]

  return next
}

export function pruneUntouchedGoals(world: World, groups: SeedGroup[]): World {
  let next = world
  for (const group of groups) {
    if (!isGroupUntouched(next, group)) continue
    next = removeGroup(next, group)
  }
  return next
}
```

### 11.4 `tools/generator/generateLevel.ts`

Unchanged from §6.3's design — reproduced here for completeness:

```ts
import { Direction, World, cloneWorld } from '../../src/game/engine/types'
import { inverseEat, inverseEnter, inversePush } from './inverseMoves'
import { canonicalKey } from './canonical'
import { SeedGroup } from './seed'
import { GENERATOR_CONFIG, GeneratorWeights } from './generatorConfig'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export type GenerationEventKind = 'push' | 'enter' | 'eat'

export interface GenerationEvent {
  kind: GenerationEventKind
  direction: Direction
}

export interface GenerationResult {
  world: World
  events: GenerationEvent[]
}

const PATTERNS: { kind: GenerationEventKind; fn: (world: World, dir: Direction) => World | null }[] = [
  { kind: 'push', fn: inversePush },
  { kind: 'enter', fn: inverseEnter },
  { kind: 'eat', fn: inverseEat },
]

function movedPieceIds(before: World, after: World): string[] {
  const ids: string[] = []
  for (const pieceId of Object.keys(before.locations)) {
    const a = before.locations[pieceId]
    const b = after.locations[pieceId]
    if (a.board !== b.board || a.x !== b.x || a.y !== b.y) ids.push(pieceId)
  }
  return ids
}

function candidateWeight(
  kind: GenerationEventKind,
  moved: string[],
  groups: SeedGroup[],
  touchCounts: Map<string, number>,
  weights: GeneratorWeights,
): number {
  let weight = weights[kind]
  for (const group of groups) {
    if (!moved.includes(group.containerId) && !moved.includes(group.boxId)) continue
    const touches = touchCounts.get(group.containerId) ?? 0
    weight += touches === 0 ? weights.newGroupBonus : weights.repeatedGroupWeight / touches
  }
  return weight
}

function weightedPick<T>(items: { weight: number; value: T }[], rng: () => number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng() * total
  for (const item of items) {
    roll -= item.weight
    if (roll <= 0) return item.value
  }
  return items[items.length - 1].value
}

export function generateLevel(
  seed: World,
  groups: SeedGroup[],
  steps: number,
  rng: () => number,
  weights: GeneratorWeights = GENERATOR_CONFIG.weights,
): GenerationResult | null {
  let world = cloneWorld(seed)
  const events: GenerationEvent[] = []
  const seen = new Set<string>([canonicalKey(world)])
  const touchCounts = new Map<string, number>(groups.map((group) => [group.containerId, 0]))
  let attempts = 0
  const maxAttempts = Math.max(steps, 1) * 20

  while (events.length < steps && attempts < maxAttempts) {
    attempts++
    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length) % DIRECTIONS.length]

    const candidates: { kind: GenerationEventKind; world: World; moved: string[] }[] = []
    for (const pattern of PATTERNS) {
      const next = pattern.fn(world, direction)
      if (!next) continue
      if (seen.has(canonicalKey(next))) continue
      candidates.push({ kind: pattern.kind, world: next, moved: movedPieceIds(world, next) })
    }
    if (candidates.length === 0) continue

    const weighted = candidates.map((candidate) => ({
      weight: candidateWeight(candidate.kind, candidate.moved, groups, touchCounts, weights),
      value: candidate,
    }))
    const accepted = weightedPick(weighted, rng)

    for (const group of groups) {
      if (accepted.moved.includes(group.containerId) || accepted.moved.includes(group.boxId)) {
        touchCounts.set(group.containerId, (touchCounts.get(group.containerId) ?? 0) + 1)
      }
    }

    world = accepted.world
    seen.add(canonicalKey(world))
    events.push({ kind: accepted.kind, direction })
  }

  if (events.length < steps) return null
  return { world, events }
}
```

### 11.5 `tools/generator/inverseMoves.ts`

Unchanged (out of scope) — see §2 and §4.2 for the hand-verified behavior this design relies on.

### 11.6 `tools/generator/solver.ts`

```ts
import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, PLAYER_ID, World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'
import { SeedGroup } from './seed'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export interface SolveResult {
  moves: Direction[]
  expandedStates: number
  maxFrontierSize: number
  visitedStates: number
}

export function solve(initialWorld: World, maxDepth = 200): SolveResult | null {
  if (checkWin(initialWorld)) {
    return { moves: [], expandedStates: 0, maxFrontierSize: 1, visitedStates: 1 }
  }

  const visited = new Set<string>([canonicalKey(initialWorld)])
  let frontier: { world: World; path: Direction[] }[] = [{ world: initialWorld, path: [] }]
  let depth = 0
  let expandedStates = 0
  let maxFrontierSize = frontier.length

  while (frontier.length > 0 && depth < maxDepth) {
    maxFrontierSize = Math.max(maxFrontierSize, frontier.length)
    const nextFrontier: typeof frontier = []
    for (const { world, path } of frontier) {
      expandedStates++
      for (const direction of DIRECTIONS) {
        const next = applyMove(world, direction)
        if (!next) continue
        const key = canonicalKey(next)
        if (visited.has(key)) continue
        visited.add(key)
        const newPath = [...path, direction]
        if (checkWin(next)) {
          return { moves: newPath, expandedStates, maxFrontierSize, visitedStates: visited.size }
        }
        nextFrontier.push({ world: next, path: newPath })
      }
    }
    frontier = nextFrontier
    depth++
  }
  return null
}

export function countCrossingMoves(world: World, moves: Direction[]): number {
  let current = world
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countCrossingMoves received an invalid move for this world')
    for (const pieceId of Object.keys(current.locations)) {
      if (current.locations[pieceId].board !== next.locations[pieceId].board) {
        count++
        break
      }
    }
    current = next
  }
  return count
}

export function countEatMoves(world: World, moves: Direction[]): number {
  const interiorIds = new Set(
    Object.values(world.pieces)
      .filter((piece) => piece.kind === 'container' && piece.boardRef !== undefined)
      .map((piece) => piece.boardRef as string),
  )
  let current = world
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countEatMoves received an invalid move for this world')
    for (const pieceId of Object.keys(current.locations)) {
      if (pieceId === PLAYER_ID) continue
      if (current.locations[pieceId].board === next.locations[pieceId].board) continue
      if (interiorIds.has(next.locations[pieceId].board)) {
        count++
        break
      }
    }
    current = next
  }
  return count
}

// `groups` must be the SURVIVING groups (getSurvivingGroups in
// pruneUntouchedGoals.ts) — see the full design spec's section 4.6/8 for
// the crash this avoids. The `!before || !after` guard is a second,
// independent layer of defense, not a substitute for passing survivors.
export function countGroupsUsed(world: World, moves: Direction[], groups: SeedGroup[]): number {
  const usedGroups = new Set<string>()
  let current = world
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countGroupsUsed received an invalid move for this world')
    for (const group of groups) {
      if (usedGroups.has(group.containerId)) continue
      for (const pieceId of [group.containerId, group.boxId]) {
        const before = current.locations[pieceId]
        const after = next.locations[pieceId]
        if (!before || !after) continue
        if (before.board !== after.board || before.x !== after.x || before.y !== after.y) {
          usedGroups.add(group.containerId)
          break
        }
      }
    }
    current = next
  }
  return usedGroups.size
}
```

### 11.7 `tools/generator/difficultyScorer.ts`

```ts
import { GENERATOR_CONFIG } from './generatorConfig'

export interface DifficultyMetrics {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  survivingGroupCount: number
  groupsUsed: number
  expandedStates: number
  maxFrontierSize: number
}

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

export interface HardRequirementCheck {
  isHard: boolean
  meetsMinMoveCount: boolean
  meetsMinEatCount: boolean
  meetsMinSurvivingGroupCount: boolean
  meetsMinGroupsUsed: boolean
  meetsMinScore: boolean
}

export function checkHardRequirements(metrics: DifficultyMetrics): HardRequirementCheck {
  const { hard } = GENERATOR_CONFIG
  const meetsMinMoveCount = metrics.moveCount >= hard.minMoveCount
  const meetsMinEatCount = metrics.eatCount >= hard.minEatCount
  const meetsMinSurvivingGroupCount = metrics.survivingGroupCount >= hard.minSurvivingGroupCount
  const meetsMinGroupsUsed = metrics.groupsUsed >= hard.minGroupsUsed
  const meetsMinScore = scoreDifficulty(metrics) >= hard.minScore
  return {
    isHard:
      meetsMinMoveCount && meetsMinEatCount && meetsMinSurvivingGroupCount &&
      meetsMinGroupsUsed && meetsMinScore,
    meetsMinMoveCount,
    meetsMinEatCount,
    meetsMinSurvivingGroupCount,
    meetsMinGroupsUsed,
    meetsMinScore,
  }
}

export function difficultyTier(metrics: DifficultyMetrics): 'easy' | 'medium' | 'hard' {
  if (checkHardRequirements(metrics).isHard) return 'hard'
  return scoreDifficulty(metrics) < 10 ? 'easy' : 'medium'
}
```

### 11.8 `tools/generator/canonical.ts`

Unchanged (out of scope).

### 11.9 `tools/generator/generateBatch.ts`

```ts
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
// 4b. This redesign changes the reverse-step range (12-50, was 3-22), the
// hard-acceptance rule (explicit eat/surviving-group minimums + a candidate
// pool, not a single score threshold), and adds a hard-biased seed profile,
// so this number must be re-measured by the mandatory diagnostic pass
// (section 12) before being trusted — it is carried forward only as a
// starting point, not a re-validated value.
const MAX_ATTEMPTS = 1000

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

    const solved = solve(world, 150)
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
      hardCandidates.push({
        world,
        json: JSON.stringify(serializeLevel(world)),
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
    results.push({ tier, world, json: JSON.stringify(serializeLevel(world)) })
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
```

## 12. Diagnostics required before regenerating shipped levels

Per this project's established discipline (sub-project 4's Task 11, 4b's Task 5, both mandatory empirical-measurement passes before committing generated content) — a diagnostic batch must run and report actual distributions before `src/levels/builtin/generated/*.json` is regenerated for real:

- **Distributions of:** `reverseSteps` (requested = achieved by construction, §6.5), `moveCount`, `crossingMoveCount`, `eatCount`, `survivingGroupCount`, `groupsUsed`, `expandedStates`, `maxFrontierSize`, `score`.
- **Rejection reasons, separated from hard discards:** `discardedGenerationFailed`, `discardedAlreadySolved`, `discardedUnsolvable`, `discardedDuplicate`, `discardedTierFull`, and — specifically for non-hard candidates, so tuning can see *why* a solved candidate didn't reach 'hard' — `rejectedTooShort`, `rejectedTooFewEats`, `rejectedNotEnoughSurvivingGroups`, `rejectedTooFewGroupsUsed`, `rejectedTooLowScore` (§11.9's `BatchStats`). If, say, 95% of non-hard candidates are `rejectedNotEnoughSurvivingGroups`, that points at the seed/reverse-generation strategy as the bottleneck, not the scoring weights — exactly the kind of diagnosis this breakdown is for.
- **Group participation by slot index** (e.g. "group 0: X%, group 1: Y%, ...") and **player-start slot distribution** — the direct measurement of whether player-start diversification (§6.1-6.2) actually flattened 4b's measured skew (goal0=659 vs goal3=7 out of 1417). The desired result is not exact equality, but the previous extreme first-slot dominance should disappear.
- **Mechanic histograms:** crossing-move histogram (0/1/2/3+, as percentages) *and* eat-count histogram, compared directly against 4b's baseline (0/10 shipped levels crossing, 0.75% of 399 sampled levels having any crossing move at all) — since eat, not crossing in general, is now the primary structural signal (§9.1).
- **Hard-pool quality, reported separately from final selection** (review §16): attempts required to obtain `hardCandidatePoolSize` (60) candidates; the hard-candidate rate; `hardCandidatesFound` (candidates that passed hard requirements) vs. the final selected count (§11.9's `BatchResult.hardCandidatesFound` vs. `counts.hard`) — this distinguishes "the generator can't produce hard candidates at all" from "the generator produces plenty but selection discards too many," which are different problems with different fixes. Also report the final selected set's score, eat-count, and surviving-group-count distributions, and the pairwise `profileDistance` among the final selected set (P50/P75/P90) — since `diversityWeight` (§10) has no fixed acceptance threshold to separately validate, this is how its effect on the shipped set is actually observed.
- **Search-space percentiles** (P50/P75/P90/P95/P99 for `expandedStates` and `maxFrontierSize`) — used to sanity-check the `log2` scoring weight, not assumed in advance.
- **Wall-clock and memory behavior** for a full `targetPerTier=5` run, given the wider reverse-step range (12-50), the hard-biased seed profile's larger structural capacity (4 groups, 5×5 interiors more often), and the added per-candidate solver bookkeeping (`expandedStates`/`maxFrontierSize`, O(1) extra work per BFS state, expected not to matter materially).

**Required baseline comparison (review §27):** report all of the above *against* the known 4b numbers (0/10 crossing levels, 0.75% of 399 sampled with any crossing, max score 15, and the goal0=659/goal2=113/goal1=92/goal3=7 skew) rather than only in isolation — and do not define success merely as "more levels reached the hard tier," since a poorly-calibrated scoring model could produce that outcome without the underlying levels actually being harder. Success means the specific 4b pathologies (near-zero crossing/eat participation, extreme first-slot skew) are measurably improved, and that hard levels satisfy their explicit structural minimums, not just a scalar score.

If the diagnostic pass shows `hardCandidatePoolSize`, `MAX_ATTEMPTS`, `diversityWeight`, or any `generatorConfig.ts` weight/threshold needs adjustment, that is expected and should be done before shipping — none of these are being asserted as correct in advance.

## 13. Test impact

- **`seed.test.ts`**: existing geometry/no-overlap/interior-size tests continue to apply. New: container's root cell has no requirement; the box's interior cell does; `boxOriginalPosition` matches the box's actual placed location; `createSeedWorld` respects a passed `SeedProfile` (deterministic rng forcing `fourGroupProbability`/`largeInteriorProbability` branches); `pickPlayerSlot` never returns an inactive slot unless the remote-start branch is deliberately forced by rng, and returns only active slots (0..groupCount-1) otherwise; player-start position is derived correctly for every slot index and never collides with any group's container/wall cells for either `groupCount` value (3 or 4), including the remote-start (inactive-slot) case.
- **`pruneUntouchedGoals.test.ts`**: existing Approach-A tests apply unchanged. New: `getSurvivingGroups` returns exactly the groups whose pieces/board are still present after a constructed prune; a fully-untouched world returns an empty surviving-groups list; a partially-touched world (some groups touched, some not) returns exactly the touched ones.
- **`generateLevel.test.ts`**: call sites take `generateLevel(seed, groups, steps, rng)`. Deterministic-rng tests proving weighted selection favors `eat` and untouched groups; cycle detection (the `seen` set) still prevents immediate undos; every accepted candidate still round-trips through `verifyPredecessor` (already guaranteed by `inverseMoves.ts`, worth a regression test at this layer too).
- **`solver.test.ts`**: update all call sites to use `.moves`. New: `expandedStates`/`maxFrontierSize`/`visitedStates` are non-negative and internally consistent; replaying a returned `.moves` solution via `applyMove` reaches a `checkWin`-true state; `countEatMoves` correctly counts a known constructed eat scenario and returns 0 for a push-only solution; `countGroupsUsed` correctly counts a known multi-group scenario **and does not throw when passed a `groups` list containing a group whose pieces don't exist in `world`** (the defensive-guard regression test for the crash this document's review caught) — both with and without pre-filtering via `getSurvivingGroups`, to prove the two protections are independently effective.
- **`difficultyScorer.test.ts`**: test each metric's independent contribution to the score; test `checkHardRequirements` returns the correct per-requirement booleans for a metrics object that clears some but not all minimums (e.g. clears `minScore` and `minEatCount` but misses `minSurvivingGroupCount` → `isHard: false`, `meetsMinSurvivingGroupCount: false`, others `true`); `difficultyTier` never returns 'hard' unless every requirement is met, and falls to 'medium' (not 'easy') on a near-miss.
- **`generateBatch.test.ts`**: update call sites for the new `solve`/`generateLevel`/`pruneUntouchedGoals` signatures and the new `BatchStats` fields. New: `selectDiverseTopN` and `profileDistance` tested directly against small synthetic `HardCandidate` lists (e.g., two near-identical high-score profiles plus one lower-score-but-distinct profile should prefer the distinct one when picking 2 of 3, and the algorithm always fills up to `min(n, candidates.length)` even when every candidate is similar); a full `generateLevelBatch` run (small `targetPerTier`, deterministic rng) still produces solvable, non-duplicate, tier-appropriate levels; the Approach-A invariant check throws on a constructed pathological `world`/`groups` pair (a "surviving" group whose box wasn't actually moved); rejection-reason counters (`rejectedTooShort` etc.) increment correctly for constructed near-miss metrics; incomplete-quota still reports `complete: false`; `hardCandidatesFound` correctly reflects the pool size independent of how many were finally selected.
- **New empirical diagnostic pass** (§12) before regenerating `src/levels/builtin/generated/*.json` — required, not optional, matching sub-project 4's and 4b's own precedent.

## 14. Recommended implementation phasing

Reordered per review §29 — group bookkeeping (§4.6) moves to immediately after Approach A, since it's a correctness fix for a crash, not a difficulty-quality enhancement, and should land before anything downstream depends on `countGroupsUsed` working correctly at all:

1. **Approach A** (§4.1-§4.5, §4.7) — requirement relocation, `boxOriginalPosition`, simplified pruning. Verified with its own diagnostic sample before moving on.
2. **Group bookkeeping fix** (§4.6) — `getSurvivingGroups`, the defensively-guarded `countGroupsUsed`, `survivingGroupCount`. Run tests immediately; this is a correctness fix, not a tunable.
3. **Player-start diversification** (§6.1-§6.2) — measure group-participation-by-slot and player-start-slot distribution before touching anything else.
4. **Hard seed profile** (§6.4) — add the stronger 4-group/5×5-interior/remote-start bias for hard-pool attempts specifically, measured independently of the reverse-walk heuristics below.
5. **Weighted reverse-walk heuristics** (§6.3) — measure whether the candidate pool actually shifts toward more eats/multi-group participation. Only if this phase's diagnostics show real A-B-A-B oscillation is common should the deferred recent-group cooldown (§6.3) be added as a follow-up.
6. **Wider reverse-step range** (§6.5) — measure solver performance impact in isolation.
7. **Solver instrumentation** (§7) and solution-mechanic metrics (§8).
8. **Multi-factor difficulty scoring and hard minimums** (§9) — do not fix `generatorConfig.ts`'s numeric weights until diagnostics from phases 1-7 are available.
9. **Candidate ranking via marginal-value selection** (§10).
10. **Full regression pass + a real full-batch generation run**, verifying both quality (§12's diagnostics, including the required baseline comparison) and runtime/memory behavior, before regenerating shipped JSON.

Each phase should be independently measurable — the point of this ordering is that if something doesn't work, it's obvious which change caused it, rather than diagnosing a single giant diff.

## 15. What should not be changed

- `applyMove`, `checkWin`, `computeTarget`, `getEntryCell`, and everything else under `src/game/engine/*`.
- `inverseMoves.ts`'s three functions and their forward-verification discipline (`verifyPredecessor`).
- `canonicalKey`'s hashing scheme.
- The BFS shortest-path property itself (only its bookkeeping is extended).
- Level serialization (`levelSchema.ts`).

## 16. Acceptance criteria

This design is not considered validated merely because the code compiles and unit tests pass. It requires an empirical batch comparison (§12) against the 4b baseline, and the following must all hold:

**Correctness:** all tests pass; no metric function crashes on a pruned/removed group (§4.6/§8's regression test); every surviving group has an unsatisfied interior goal before solving (§4.6's invariant check never fires on a real batch run); every shipped level is solvable, not already solved, and canonical-unique.

**Mechanic complexity:** the fraction of levels with `eatCount > 0` is dramatically higher than the 4b baseline (0.75% of 399 sampled had any crossing at all); hard levels satisfy the minimum eat and surviving-group requirements, not merely a scalar score; multi-group participation (`groupsUsed >= 2`) is substantially more common than in 4b.

**Structural diversity:** hard levels show meaningful variation in `survivingGroupCount` and `eatCount`, not just move count; the final hard set is not dominated by one structural family (measured via pairwise `profileDistance`, §12).

**Search complexity:** `expandedStates` and `maxFrontierSize` are measured and remain operationally acceptable; search-space metrics contribute to the score but never alone determine 'hard' (§9.3's `checkHardRequirements` never depends on them).

**Generation quality:** `MAX_ATTEMPTS` and `hardCandidatePoolSize` are confirmed sufficient (or retuned) for a real `targetPerTier=5` run to complete within reasonable wall-clock time and memory; `hardCandidatesFound` is reported and reliably reaches a level that makes the marginal-value selection meaningful (i.e., meaningfully more than `targetPerTier` candidates are usually available to choose from, not just barely enough).

## 17. Files touched summary

| File | Change |
|---|---|
| `tools/generator/generatorConfig.ts` | New — centralizes every tunable weight/threshold/range, including seed profiles |
| `tools/generator/seed.ts` | Approach A requirement relocation + `boxOriginalPosition`; slot-geometry helpers; player-start diversification with remote-start handling; seed-profile-driven groupCount/interiorSize |
| `tools/generator/pruneUntouchedGoals.ts` | Approach A pruning; exports `isGroupUntouched` and new `getSurvivingGroups` |
| `tools/generator/generateLevel.ts` | Takes `groups`; weighted candidate selection replacing uniform shuffle-and-take-first |
| `tools/generator/solver.ts` | `solve` returns `SolveResult`; adds `countEatMoves`, defensively-guarded `countGroupsUsed` |
| `tools/generator/difficultyScorer.ts` | `DifficultyMetrics` gains `survivingGroupCount`/`maxFrontierSize`; new `checkHardRequirements`; eat/surviving-group-based hard gating |
| `tools/generator/generateBatch.ts` | Surviving-group wiring, Approach-A invariant check, hard-biased seed profile switch, expanded rejection-reason stats, marginal-value candidate selection replacing threshold+backfill |
| `tools/generator/*.test.ts` | Updated/added per §13 |
| `src/levels/builtin/generated/*.json` | Regenerated only after §12's diagnostic pass |

Unchanged: `tools/generator/inverseMoves.ts`, `tools/generator/canonical.ts`, all of `src/game/engine/*`, `src/game/engine/levelSchema.ts`.
