# Parabox Level Generator — Full Design: Approach A + Complexity-Aware Hard-Level Generation

**Status:** Draft for review (sub-project 4c)
**Supersedes:** `2026-09-05-parabox-generator-multigoal-design.md` (sub-project 4b) — that spec's seed/pruning design is described here as it exists today, with Approach A and the hard-level redesign layered on top. 4b's spec is not deleted; this document is the current source of truth for the generator going forward.
**Incorporates:** the design proposed in `2026-09-06-parabox-generator-hard-level-design (1).md`, adapted and hand-verified against the actual current codebase (that document's own code was illustrative pseudocode; every function below has been checked against the real `src/game/engine/*` and `tools/generator/*` sources).

## 1. Purpose

This document is self-contained: it describes the entire level-generator pipeline, specifies **Approach A** (fixing 4b's mechanic-usage regression), and specifies a **complexity-aware hard-level redesign** layered on top of Approach A (fixing 4b's separately-identified player-start skew and the generator's general inability to reliably produce structurally hard levels).

Three problems motivate this, all measured on the 4b-shipped generator:

1. **Mechanic-usage regression:** 0 of 10 shipped levels had any board-crossing move in their optimal solution (vs 3/10 pre-4b). Root cause: a goal's win condition sat on the container's own root cell, and any non-player occupant (including the container itself) satisfies it — so leaving the container untouched was always a sufficient win. **Fixed by Approach A** (§4).
2. **Player-start skew:** the player always starts in the same slot, so per-group touch frequency was heavily skewed (measured: goal0=659, goal2=113, goal1=92, goal3=7 over 1417 walks) — capping observed multi-group participation and suspected to suppress the 'hard' tier. **Fixed by player-start diversification** (§6.1).
3. **Difficulty is under-measured:** a single `moveCount + crossingMoveCount*5` score conflates a long-but-trivial walk with a genuinely complex one, gives no minimum structural requirements for 'hard', and the batch generator accepts the first candidate that clears a tier rather than selecting the best/most diverse ones. **Fixed by BFS instrumentation, a multi-factor score with explicit minimums, and candidate ranking/diversity filtering** (§7-§10).

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
createSeedWorld(rng)                              (seed.ts)
  → SeedResult { world, groups }
generateLevel(seed, groups, steps, rng)           (generateLevel.ts)
  → GenerationResult { world, events } | null
pruneUntouchedGoals(world, groups)                (pruneUntouchedGoals.ts)
  → World
checkWin / canonicalKey dedup                     (rules.ts / canonical.ts)
solve(world, maxDepth)                            (solver.ts)
  → SolveResult { moves, expandedStates, maxFrontierSize, visitedStates } | null
countCrossingMoves / countEatMoves / countGroupsUsed   (solver.ts)
  → DifficultyMetrics
difficultyTier(metrics)                           (difficultyScorer.ts)
  → 'easy' | 'medium' | 'hard'
[hard only] pool → rank → diversity-filter → select   (generateBatch.ts)
serializeLevel                                    (levelSchema.ts, unchanged)
```

The two structural changes from 4b's pipeline are: (1) `generateLevel` now takes `groups` (needed for its weighted candidate selection, §6.2) and `pruneUntouchedGoals` drops the `touchedGroups` argument (Approach A, §4); (2) `solve` and the crossing/scoring functions now produce a richer `DifficultyMetrics`, and hard-tier acceptance is a pool-then-select process rather than first-match (§7-§10).

## 4. Approach A: move the win condition into the interior

**Core change:** a goal group's `'box'` requirement cell moves from the container's root cell to the box's own cell inside the container's interior. Winning a group now means "a non-player piece occupies the cell the box started on, inside that interior" — and since nothing but a real forward *eat* move (or its reverse-walk counterpart, `inverseEat`) ever changes that cell's occupant, every surviving group structurally requires the eat mechanic to solve.

### 4.1 Why this needs no engine change

`checkWin` already treats every board's requirement cells uniformly (§2) — moving *where* a requirement lives is entirely a `seed.ts`-level change.

### 4.2 The one-way-door property (soundness of a position-based pruning check)

Re-verified by hand-tracing `inverseMoves.ts` fresh in this session: `inversePush` and `inverseEat` both keep the player on the *same* board — neither ever changes `world.locations[PLAYER_ID].board`. `inverseEnter` is the only function that ever changes the player's board at all, and only in one direction (interior → parent): its precondition (`findContainerFor(world, loc.board)` — the player's *current* board must already be some container's interior) requires the player to already be standing inside an interior *before* this step runs. Since the player starts on `root` at the seed (`world_0`), and by induction no step from `world_0` to any later `world_i` ever moves the player onto a non-root board (the only candidate, `inverseEnter`, only ever moves the player *off* one), the player's board is invariantly `root` for the entire walk, at every step — not merely "at the end," and not merely "usually." `inverseEnter`'s precondition can therefore never be satisfied at any point in a root-seeded walk (empirically confirmed in 4b: 1000+ sampled walks, `enter: 0` fired, every time), so it is permanently dead in this generator. `inverseEat` is the *only* function that ever moves a container or box, and it only ever **extracts** a box from its interior to `root` — its precondition requires a piece already occupying the interior's entry cell, so once that cell is empty, this exact container can't fire `inverseEat` again, and no other function ever inserts a piece back onto an interior board. So "is the box still at its seed-placed interior cell" is a genuine one-way-door fact: true until (at most) one extraction, false forever after. This is safe in a way the *container's* root position never was (which is why 4b's reviewer correctly rejected container-position pruning): in a hypothetical engine where the player *could* end up inside an interior without moving its container, a container could stay at its seed position while the group is genuinely in play — the box has no equivalent ambiguity, because nothing but eat/un-eat ever touches it in either direction.

**Cross-check against 4b's review file** (`2026-09-05-parabox-generator-multigoal-review.md`), whose core objection was exactly "position-unchanged does not imply untouched": that objection targeted the *container's* position specifically because `inverseEnter` could (in principle) put the player inside a group's interior without moving that group's container. The scenario the review actually feared — player standing inside a group's interior whose box hasn't moved, silently pruned away — requires the player's board to become that interior in the first place, which the paragraph above shows can never happen at any point in a root-seeded walk (not just "inverseEnter doesn't fire," but "no function ever moves the player onto a non-root board at all," which is the stronger and more precisely correct claim). So this is not a live risk for Approach A's box-position check today. It remains a *hypothetical* risk this design does not rely on being permanently impossible: `pruneUntouchedGoals.ts`'s `removeGroup` keeps the same defensive throw 4b added for exactly this class of risk (§4.4) — if the player is ever found on a board being pruned, it throws rather than silently corrupting the `World`, regardless of which position check triggered the prune decision or which future change to `inverseMoves.ts` might one day make the scenario reachable. The throw is what actually keeps this safe against the future; the position check is only an optimization that is provably correct *today*, on the code as it exists.

### 4.3 `SeedGroup` changes

`SeedGroup` gains `boxOriginalPosition: { x: number; y: number }` — the box's position inside its own interior, which pruning checks. The existing `originalPosition` (container's root position) is kept for descriptive completeness but is no longer consulted by pruning.

### 4.4 `pruneUntouchedGoals.ts` changes

`computeTouchedGroups` and all `GenerationEvent`-derived provenance tracking are removed. A group is untouched iff its box is still exactly where the seed placed it:

```ts
function isGroupUntouched(world: World, group: SeedGroup): boolean {
  const loc = world.locations[group.boxId]
  return (
    loc.board === group.interiorId &&
    loc.x === group.boxOriginalPosition.x &&
    loc.y === group.boxOriginalPosition.y
  )
}
```

`removeGroup` keeps its defensive player-deletion throw (still provably unreachable today, still free insurance — see §4.2's cross-check), but drops the "clear the container's root cell requirement" step, since under Approach A the root cell never carries a requirement. `pruneUntouchedGoals(world, groups)` becomes 2-argument. Full code is in §11's merged `pruneUntouchedGoals.ts` listing (unchanged by the hard-level redesign — Approach A is the only thing that touches this file).

### 4.5 Soundness of "every surviving group requires eat"

1. No engine change needed (§4.1).
2. After pruning, only groups whose box has moved from its seed position survive — and the box can only have moved via a real eat interaction (§4.2).
3. BFS finds the *shortest* solution, so if there were a shorter push-only solve available, it would be found instead. Approach A removes that shorter solve from existing at all for a surviving group, because leaving the box out of place means `checkWin` reports `false` for that group — there is no trivial win to fall back to.
4. `inverseEnter`'s irrelevance and the defensive throw's insurance are both unaffected by Approach A (§4.2).

## 5. Recap: 4b's still-current provisions (unaffected by this document)

- The 2×2 slot-grid seed layout, 3-4 goal groups, randomized wall direction, randomized interior size (3 or 5) — kept, and generalized with helper functions in §6.1.
- Slots occupy disjoint 5×5 coordinate blocks with **no gap between them** (corrected from 4b's original "2-cell buffer" claim, which the review file caught as false: slot 0 spans x=1..5, slot 1 spans x=6..10, adjacent with no buffer). The actual invariant: each slot's container sits at local (2,2), and its 4 possible wall cells stay within the same local 5×5 block (center ±1 in one axis), so no slot's geometry ever reaches into another slot's block regardless of layout randomization.
- `verifyPredecessor` (`inverseMoves.ts`) re-applies the real forward engine to every candidate inverse move and checks canonical-key equality before accepting it — "forward engine is the source of truth," unchanged and load-bearing for every generation heuristic added below (heuristics only ever choose *among* already-forward-verified candidates; they never bypass verification).

## 6. Player-start diversification and complexity-aware reverse walk

### 6.1 Randomize player start, derived from slot geometry

The player always starting at root `(2,2)` is exactly slot 0's own safe-diagonal-offset position. Generalizing: extract `getSlotOrigin`/`getSlotCenter` helpers (also removes the hand-duplicated `slotOriginX`/`slotOriginY`/`containerX`/`containerY` arithmetic 4b's seed had inlined), and pick the player's start from one of the 4 slot quadrants (the grid is always 2 columns × 2 rows regardless of whether `groupCount` is 3 or 4 — an unused 4th slot when `groupCount===3` is still plain floor, so it's always a valid candidate):

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

The player's candidate position for slot `k` is one cell diagonally inside the slot from its center: `(getSlotCenter(k).x - 1, getSlotCenter(k).y - 1)`. For `k=0` this is exactly `(2,2)`, matching 4b's fixed position; for `k=1,2,3` it generalizes to `(7,2)`, `(2,7)`, `(7,7)` — the same four candidates the hard-level design document proposed, but derived from the actual slot geometry instead of hardcoded.

**Safety proof (hand-verified, not merely asserted):** a slot's 4 possible wall cells are the center ± 1 in exactly one axis (cardinal-adjacent); the player candidate is the center − 1 in *both* axes (diagonal) — these can never coincide, since the player candidate always differs from center in both coordinates while a wall cell always matches center in one coordinate. The candidate also never equals the container's own cell (nonzero offset). And since every slot occupies its own disjoint 5×5 block (§5), a candidate for slot `k` can never collide with any other slot's container/wall geometry, regardless of which slots currently host a group. So all 4 candidates are unconditionally safe, independent of `groupCount` or the random wall-direction/interior-size draws for any group.

`createSeedWorld` picks `playerSlot = Math.floor(rng() * 4)` once, after `groupCount`, before the per-group loop (an explicit ordering decision — it changes the rng-draw sequence relative to 4b's seed, so existing seed tests with hardcoded rng sequences will need updating, same as every other rng-sequence-sensitive test already affected by Approach A).

### 6.2 Complexity-aware weighted reverse walk

4b's `generateLevel` picked uniformly among valid inverse-move candidates (shuffle-then-take-first-valid == uniform random choice among valid options). The redesign replaces uniform choice with **weighted** choice, still restricted to real-engine-verified candidates, favoring `eat` and favoring touching groups that haven't been touched yet in this walk — while never blocking any option (all weights stay positive).

`generateLevel` now takes `groups: SeedGroup[]` so it can attribute a candidate to a goal group (a candidate belongs to group `g` if it moves `g.containerId` or `g.boxId`):

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

This single mechanism deliberately covers both "reward activating a new group" and "de-emphasize a group the walk keeps returning to" (the hard-level design document's §6.4 and §6.5) without two separate rules: a group's own weight contribution shrinks every time it's picked again (`repeatedGroupWeight / touches`), so an untouched group's flat `newGroupBonus` naturally becomes relatively more attractive over time, without ever hard-blocking repeat use (the document explicitly says not to — "some good hard puzzles naturally concentrate on one container").

**"Avoid immediately undoing the previous event" is already structurally guaranteed and needs no separate heuristic.** The hard-level document's §6.2 asked for this as a new rule, but the existing `seen: Set<string>` cycle-avoidance (unchanged since sub-project 4) already rejects any candidate whose resulting `canonicalKey` was already visited this walk — and undoing the immediately-preceding event produces exactly the state from before that event, which is already in `seen`. Adding a second, weaker heuristic for something the state-dedup already forbids outright would be redundant; this document notes the requirement is met and moves on, per the project's practice of not adding mechanisms beyond what's needed. (The document's related §6.6, "penalize a move likely to be undone shortly," is a much softer and vaguer property that would need a real definition and its own justification to implement — this design deliberately omits it, matching the document's own framing of it as optional/soft, and can be revisited if diagnostics ever show a concrete need.)

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

**Note on `movedPieceIds` vs. Approach A's removed `affectedPieceIds`:** Approach A removed the *public* `affectedPieceIds` field from `GenerationEvent` because pruning switched to a direct position check and no longer needs event provenance (§4.4). `movedPieceIds` here is a *private* helper local to `generateLevel.ts`, used only to compute generation-time heuristic weights — it is never attached to `GenerationEvent`, and `pruneUntouchedGoals` still never consumes it. The two concerns (pruning correctness vs. generation-time heuristic weighting) remain fully decoupled; this is a coincidental reuse of the same diffing logic for an unrelated purpose, not a reintroduction of provenance tracking into the public contract.

### 6.3 Wider reverse-step range

`steps = 3 + floor(rng()*20)` (range 3-22) becomes a config-driven range, `GENERATOR_CONFIG.minReverseSteps=12` to `maxReverseSteps=50`. This only enlarges the candidate pool per the document's own framing (§2.1 of the source document) — it is not itself a difficulty guarantee, and final acceptance is still gated entirely on `solve()`'s measured output (§7-§9). The wider range plausibly increases per-walk runtime and `generateLevel`'s own attempt budget (`Math.max(steps,1)*20`, unchanged formula, now up to 1000 attempts per walk instead of 440) — flagged in §12 as something the mandatory diagnostic pass must measure, not assume is free.

## 7. Solver instrumentation

`solve` returns a `SolveResult` instead of a bare `Direction[] | null`, adding cheap-to-track BFS bookkeeping. No changes to move semantics, `applyMove` usage, or `canonicalKey`-based visited-set dedup — the shortest-path property is untouched.

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

`countCrossingMoves(world, moves)` is unchanged. Two new functions replay the solution with the real forward engine (never inferring from coordinates alone, per the source document's explicit caution) to measure the mechanics Approach A actually cares about:

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

`countEatMoves` derives "which boards are container interiors" from the piece table (`kind==='container'` → its `boardRef`) rather than from `SeedGroup`, since `Piece.boardRef` is immutable for the life of a `World` (§2) — this makes it usable on any `World`, not just ones with `SeedGroup` metadata still available, and mirrors the hand-verified forward mechanic from §2: a non-player piece's board changing *to* a container interior is, in this generator's piece vocabulary, exactly a box being eaten (there is no other piece kind or mechanic that produces this transition). `countGroupsUsed` counts a group as "used" if its container *or* box moves at all during the replayed solution (any move, not just a crossing) — matching the source document's "materially involved in at least one relevant solution transition," which is intentionally broader than crossing/eating alone (e.g., a plain push of the container still counts as using that group).

`DifficultyMetrics` (consumed by `difficultyScorer.ts`, §9) is assembled by `generateBatch.ts` from `solve`'s `SolveResult` plus these three counting functions — there is no single "solve-and-measure-everything" function; each piece stays independently testable, per this project's file-boundary conventions.

## 9. Multi-factor difficulty score and hard-tier acceptance

Replacing the single `moveCount + crossingMoveCount*5` formula:

```ts
export interface DifficultyMetrics {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
  groupsUsed: number
  expandedStates: number
}

export function scoreDifficulty(metrics: DifficultyMetrics): number {
  const { scoring } = GENERATOR_CONFIG
  return (
    metrics.moveCount +
    metrics.crossingMoveCount * scoring.crossingMoveWeight +
    metrics.eatCount * scoring.eatWeight +
    metrics.groupsUsed * scoring.groupsUsedWeight +
    Math.log2(metrics.expandedStates + 1) * scoring.expandedStatesLogWeight
  )
}

export function difficultyTier(metrics: DifficultyMetrics): 'easy' | 'medium' | 'hard' {
  const score = scoreDifficulty(metrics)
  const { hard } = GENERATOR_CONFIG
  const isHard =
    score >= hard.minScore &&
    metrics.moveCount >= hard.minMoveCount &&
    metrics.crossingMoveCount >= hard.minCrossingMoveCount &&
    metrics.groupsUsed >= hard.minGroupsUsed
  if (isHard) return 'hard'
  return score < 10 ? 'easy' : 'medium'
}
```

`log2(expandedStates+1)` is used (not the raw count) because BFS state counts can grow much faster than move counts and would otherwise dominate the score outright; the logarithm lets search-space size matter without overwhelming solution length and mechanic complexity. `difficultyTier` requires **all** of the explicit minimums *and* the score threshold for 'hard' — without the minimums, a level could reach a high score purely from a large `expandedStates` term while using only one goal group and zero crossings, which would not represent a genuine "hard" Parabox puzzle. A candidate that clears the score threshold but misses a minimum falls through to 'medium', not 'easy' (an accepted-but-not-flagged-hard result should never be miscategorized as trivially easy).

All weights and thresholds live in one place (§9.1), and every one of them is an **initial tuning value**, not a proven-optimal constant — the mandatory diagnostic pass (§12) must validate or revise them against measured distributions before they're trusted for a real batch.

### 9.1 `generatorConfig.ts` (new file)

Centralizing every tunable in one place (the source document's own explicit request, §18 of the hard-level document):

```ts
export interface GeneratorWeights {
  push: number
  enter: number
  eat: number
  newGroupBonus: number
  repeatedGroupWeight: number
}

export interface GeneratorConfig {
  minReverseSteps: number
  maxReverseSteps: number
  weights: GeneratorWeights
  scoring: {
    crossingMoveWeight: number
    eatWeight: number
    groupsUsedWeight: number
    expandedStatesLogWeight: number
  }
  hard: {
    minMoveCount: number
    minCrossingMoveCount: number
    minGroupsUsed: number
    minScore: number
  }
  hardCandidatePoolSize: number
  diversityMinDistance: number
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
  scoring: {
    crossingMoveWeight: 8,
    eatWeight: 4,
    groupsUsedWeight: 8,
    expandedStatesLogWeight: 3,
  },
  hard: {
    minMoveCount: 20,
    minCrossingMoveCount: 2,
    minGroupsUsed: 2,
    minScore: 25,
  },
  hardCandidatePoolSize: 60,
  diversityMinDistance: 0.5,
}
```

## 10. Candidate ranking and diversity filtering (hard tier only)

Easy and medium keep 4b's simple first-match acceptance (accept the first candidate that clears the tier and isn't full) — the source document explicitly allows this ("Easy and medium can continue using simpler acceptance if runtime becomes an issue"). Hard levels instead accumulate into a bounded candidate pool, then get ranked and diversity-filtered at the end, so the final 5 hard levels aren't just "the first 5 that crossed the threshold" (which the document's §5.5/§10 correctly points out can all be near-duplicates).

```ts
export interface DifficultyProfile {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
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
    term(a.groupsUsed, b.groupsUsed, 2) +
    term(a.expandedStates, b.expandedStates, 5000)
  )
}

// Highest score first; skip a candidate only while a diverse quota can still
// be filled without it. If diversity filtering would leave the pool short of
// `n`, backfill with the remaining highest-scoring candidates — diversity is
// a tie-breaker among already-acceptable hard levels, never a reason to ship
// fewer than requested.
export function selectDiverseTopN(candidates: HardCandidate[], n: number): HardCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const selected: HardCandidate[] = []
  for (const candidate of sorted) {
    if (selected.length >= n) break
    const tooSimilar = selected.some(
      (chosen) => profileDistance(chosen.profile, candidate.profile) < GENERATOR_CONFIG.diversityMinDistance,
    )
    if (tooSimilar) continue
    selected.push(candidate)
  }
  if (selected.length < n) {
    for (const candidate of sorted) {
      if (selected.length >= n) break
      if (selected.includes(candidate)) continue
      selected.push(candidate)
    }
  }
  return selected
}
```

The distance function's per-dimension `scale` constants are normalization guesses (so no single dimension dominates purely due to its numeric range), listed here as tuning values subject to the same diagnostic-validation requirement as everything in `generatorConfig.ts`. `DifficultyProfile` and `DifficultyMetrics` currently have identical shape but serve different roles (scoring input vs. diversity distance) and are kept as separate types, matching the source document's own separation (§7.4 vs §10.1) — a future change to one (e.g., adding `maxFrontierSize` to the profile only) shouldn't need to touch the other.

`selectDiverseTopN` and `profileDistance` are exported from `generateBatch.ts` so they can be unit-tested directly against synthetic candidate lists, rather than only indirectly through a full random batch run (§13).

## 11. Full merged file listings

The following are the complete, final contents of every file this design touches, incorporating Approach A and the hard-level redesign together (no separate "Approach-A-only" version of these files is shown elsewhere in this document — this section is authoritative).

### 11.1 `tools/generator/generatorConfig.ts` (new)

See §9.1 for the full listing — reproduced there in full, not duplicated here.

### 11.2 `tools/generator/seed.ts`

```ts
import {
  Cell, Direction, PLAYER_ID, World,
  step, opposite,
} from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'

const GRID_COLS = 2
const SLOT_SIZE = 5
const ROOT_SIZE = 2 + GRID_COLS * SLOT_SIZE // = 12
// GRID_COLS(2) x 2 rows, matching ROOT_SIZE's own derivation (groupCount is
// always 3 or 4, and ceil(3/2) === ceil(4/2) === 2 rows). Every slot is a
// valid player-start candidate regardless of groupCount — an unused slot is
// still plain floor.
const PLAYER_START_SLOTS = 4
const INTERIOR_SIZES = [3, 5]
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

export function createSeedWorld(rng: () => number = Math.random): SeedResult {
  const groupCount = 3 + Math.floor(rng() * 2) // 3 or 4
  const playerSlot = Math.floor(rng() * PLAYER_START_SLOTS)

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

    const interiorSize = INTERIOR_SIZES[Math.floor(rng() * INTERIOR_SIZES.length)]
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

Unchanged by the hard-level redesign (Approach A is the only thing that touches this file — see §4.4):

```ts
import { World, cloneWorld, PLAYER_ID } from '../../src/game/engine/types'
import { SeedGroup } from './seed'

// A group is untouched iff its box still sits exactly where the seed placed
// it, on its own interior board — a one-way-door check (see the full design
// spec's section 4.2): nothing but a real eat/inverse-eat move ever changes
// the box's board or position, and once it leaves its interior nothing ever
// puts it back. So "unmoved" and "untouched" are the same fact for the box —
// unlike the container's root position, which inverseEnter could in
// principle leave unchanged while the group is genuinely in play.
function isGroupUntouched(world: World, group: SeedGroup): boolean {
  const loc = world.locations[group.boxId]
  return (
    loc.board === group.interiorId &&
    loc.x === group.boxOriginalPosition.x &&
    loc.y === group.boxOriginalPosition.y
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

// Weight favors the event's own kind (eat is scarce and structurally
// valuable under Approach A) and, for whichever group(s) the event's moved
// pieces belong to, a bonus that is large the first time a group is touched
// and shrinks on repeat touches — rewarding new-group activation and
// naturally de-emphasizing (never forbidding) a group the walk keeps
// returning to, via one mechanism instead of two competing rules.
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
  groupsUsed: number
  expandedStates: number
}

export function scoreDifficulty(metrics: DifficultyMetrics): number {
  const { scoring } = GENERATOR_CONFIG
  return (
    metrics.moveCount +
    metrics.crossingMoveCount * scoring.crossingMoveWeight +
    metrics.eatCount * scoring.eatWeight +
    metrics.groupsUsed * scoring.groupsUsedWeight +
    Math.log2(metrics.expandedStates + 1) * scoring.expandedStatesLogWeight
  )
}

export function difficultyTier(metrics: DifficultyMetrics): 'easy' | 'medium' | 'hard' {
  const score = scoreDifficulty(metrics)
  const { hard } = GENERATOR_CONFIG
  const isHard =
    score >= hard.minScore &&
    metrics.moveCount >= hard.minMoveCount &&
    metrics.crossingMoveCount >= hard.minCrossingMoveCount &&
    metrics.groupsUsed >= hard.minGroupsUsed
  if (isHard) return 'hard'
  return score < 10 ? 'easy' : 'medium'
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
import { DifficultyMetrics, difficultyTier, scoreDifficulty } from './difficultyScorer'
import { canonicalKey } from './canonical'
import { pruneUntouchedGoals } from './pruneUntouchedGoals'
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
}

export interface BatchResult {
  levels: GeneratedLevel[]
  complete: boolean
  counts: Record<Tier, number>
  stats: BatchStats
}

export interface DifficultyProfile {
  moveCount: number
  crossingMoveCount: number
  eatCount: number
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
// 4b. This redesign changes both the reverse-step range (now 12-50, was
// 3-22) and the hard-acceptance rule (explicit minimums + a candidate pool,
// not first-match-on-a-single-score), so this number must be re-measured by
// the mandatory diagnostic pass (section 12) before being trusted — it is
// carried forward only as a starting point, not a re-validated value.
const MAX_ATTEMPTS = 1000

export function profileDistance(a: DifficultyProfile, b: DifficultyProfile): number {
  const term = (x: number, y: number, scale: number) => Math.abs(x - y) / scale
  return (
    term(a.moveCount, b.moveCount, 20) +
    term(a.crossingMoveCount, b.crossingMoveCount, 3) +
    term(a.eatCount, b.eatCount, 3) +
    term(a.groupsUsed, b.groupsUsed, 2) +
    term(a.expandedStates, b.expandedStates, 5000)
  )
}

export function selectDiverseTopN(candidates: HardCandidate[], n: number): HardCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const selected: HardCandidate[] = []
  for (const candidate of sorted) {
    if (selected.length >= n) break
    const tooSimilar = selected.some(
      (chosen) => profileDistance(chosen.profile, candidate.profile) < GENERATOR_CONFIG.diversityMinDistance,
    )
    if (tooSimilar) continue
    selected.push(candidate)
  }
  if (selected.length < n) {
    for (const candidate of sorted) {
      if (selected.length >= n) break
      if (selected.includes(candidate)) continue
      selected.push(candidate)
    }
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
  }

  while (
    stats.attempts < maxAttempts &&
    (counts.easy < targetPerTier || counts.medium < targetPerTier || hardCandidates.length < hardPoolTarget)
  ) {
    stats.attempts++

    const { world: seed, groups } = createSeedWorld(rng)
    const steps =
      GENERATOR_CONFIG.minReverseSteps +
      Math.floor(rng() * (GENERATOR_CONFIG.maxReverseSteps - GENERATOR_CONFIG.minReverseSteps + 1))
    const generated = generateLevel(seed, groups, steps, rng)
    if (!generated) {
      stats.discardedGenerationFailed++
      continue
    }

    const world = pruneUntouchedGoals(generated.world, groups)

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
      groupsUsed: countGroupsUsed(world, solved.moves, groups),
      expandedStates: solved.expandedStates,
    }
    const tier = difficultyTier(metrics)

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

  return { levels: results, complete, counts, stats }
}

function main() {
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/levels/builtin/generated')
  // Overwrite policy: each run replaces the entire generated set rather
  // than appending numbered files on top of a stale previous run.
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
      `(attempts=${batch.stats.attempts}, ` +
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

`selectDiverseTopN` is exported (alongside the existing `generateLevelBatch`) specifically so tests can exercise ranking/diversity behavior against small synthetic `HardCandidate`-shaped inputs, without needing a full random batch run to produce enough real hard candidates (§13).

## 12. Diagnostics required before regenerating shipped levels

Per this project's established discipline (sub-project 4's Task 11, 4b's Task 5, both mandatory empirical-measurement passes before committing generated content) — a diagnostic batch must run and report actual distributions before `src/levels/builtin/generated/*.json` is regenerated for real:

- Distributions of: `reverseSteps` (as actually achieved, not just requested), `moveCount`, `crossingMoveCount`, `eatCount`, `groupsUsed`, `expandedStates`, `maxFrontierSize`, `score`.
- Counts of: generation failures, already-solved discards, unsolvable discards, duplicate discards, tier-full discards.
- **Group participation by slot index** (e.g. "group 0: X%, group 1: Y%, ...") — the direct measurement of whether player-start diversification (§6.1) actually flattened 4b's measured skew (goal0=659 vs goal3=7 out of 1417). The desired result is not exact equality, but the previous extreme first-slot dominance should disappear.
- **Crossing-move histogram** (0 / 1 / 2 / 3+ crossings, as percentages) — compared directly against 4b's baseline (0/10 shipped levels crossing, 0.75% of 399 sampled levels having any crossing at all).
- **Search-space percentiles** (P50/P75/P90/P95/P99 for `expandedStates` and `maxFrontierSize`) — used to sanity-check the `log2` scoring weight and the hard-tier minimums, not assumed in advance.
- **Hard-tier fill behavior**: how many attempts it actually takes to fill `hardCandidatePoolSize` (60) candidates, whether `MAX_ATTEMPTS` (1000) is sufficient, and the batch's total wall-clock/memory behavior with the wider reverse-step range (12-50) and larger per-candidate solver cost (BFS now also collecting `expandedStates`/`maxFrontierSize`, though this is O(1) extra work per state and shouldn't materially change runtime).

If the diagnostic pass shows `hardCandidatePoolSize`, `MAX_ATTEMPTS`, or any `generatorConfig.ts` weight/threshold needs adjustment, that is expected and should be done before shipping — none of these are being asserted as correct in advance, exactly as this document's source insisted throughout.

## 13. Test impact

- **`seed.test.ts`**: existing geometry/no-overlap/interior-size tests continue to apply (unaffected by requirement placement or player-start changes). New: container's root cell has no requirement; the box's interior cell does; `boxOriginalPosition` matches the box's actual placed location; player-start position is derived correctly for all 4 `playerSlot` draws (deterministic rng forcing each of the 4 branches), and never collides with any group's container/wall cells for either `groupCount` value (3 or 4).
- **`generateLevel.test.ts`**: call sites gain the `groups` argument (`generateLevel(seed, groups, steps, rng)`). `affectedPieceIds` assertions are removed (never existed under the merged design — see §6.2's note distinguishing `movedPieceIds` from the removed public field). New: deterministic-rng tests proving weighted selection actually favors `eat` and un-touched groups (e.g., construct an `rng` sequence that forces a specific weighted-pick outcome and assert the chosen event kind/group matches the expected bias); a candidate is never accepted unless it independently round-trips through `verifyPredecessor` (already guaranteed by `inverseMoves.ts`, but worth a regression test at this layer too); cycle detection (the `seen` set) still prevents immediate undos.
- **`pruneUntouchedGoals.test.ts`**: unaffected by the hard-level redesign (only Approach A changed this file — already covered in §4.4's design, tests unchanged from that scope).
- **`solver.test.ts`**: update all call sites to use `.moves` instead of a bare array. New: `expandedStates`/`maxFrontierSize`/`visitedStates` are non-negative and internally consistent (`visitedStates >= moves.length + 1`, `maxFrontierSize >= 1`); replaying a returned `.moves` solution via `applyMove` actually reaches a `checkWin`-true state; `countEatMoves` correctly counts a known constructed eat scenario and returns 0 for a push-only solution; `countGroupsUsed` correctly counts a known multi-group scenario.
- **`difficultyScorer.test.ts`**: test each metric's independent contribution to the score (high `moveCount` alone, high `crossingMoveCount` alone, high `eatCount` alone, high `groupsUsed` alone, high `expandedStates` alone, all combined); test that 'hard' requires every explicit minimum (a metrics object that clears `minScore` but misses e.g. `minGroupsUsed` must resolve to 'medium', not 'hard').
- **`generateBatch.test.ts`**: update call sites for the new `solve`/`generateLevel`/`pruneUntouchedGoals` signatures. New: `selectDiverseTopN` and `profileDistance`-driven behavior tested directly against small synthetic `HardCandidate` lists (e.g., two near-identical high-score profiles plus one lower-score-but-distinct profile should prefer diversity when picking 2 of them, but backfill correctly when the pool is smaller than `targetPerTier`); a full `generateLevelBatch` run (small `targetPerTier`, deterministic rng) still produces solvable, non-duplicate, tier-appropriate levels; incomplete-quota still reports `complete: false`.
- **New empirical diagnostic pass** (§12) before regenerating `src/levels/builtin/generated/*.json` — required, not optional, matching sub-project 4's and 4b's own precedent.

## 14. Recommended implementation phasing

For whichever plan implements this (writing-plans will turn this into concrete tasks), the source document's own phased sequence remains sound and is adopted here as the task-ordering guidance:

1. Approach A alone (§4) — requirement relocation, `boxOriginalPosition`, simplified pruning, `affectedPieceIds` removal — verified with its own diagnostic sample before moving on.
2. Player-start diversification (§6.1) — measure group-participation-by-slot before touching anything else.
3. Wider reverse-step range (§6.3) — measure solver performance impact in isolation.
4. Weighted reverse-walk heuristics (§6.2) — measure whether the candidate pool actually shifts toward more crossings/multi-group participation.
5. Solver instrumentation (§7) and solution-mechanic metrics (§8).
6. Multi-factor difficulty scoring and hard minimums (§9) — do not fix `generatorConfig.ts`'s numeric weights until diagnostics from steps 1-5 are available.
7. Candidate ranking and diversity filtering (§10).
8. Full regression pass + a real full-batch generation run, verifying both quality (§12's diagnostics) and runtime/memory behavior, before regenerating shipped JSON.

Each phase should be independently measurable — the point of this ordering is that if something doesn't work, it's obvious which change caused it, rather than diagnosing a single giant diff.

## 15. What should not be changed

- `applyMove`, `checkWin`, `computeTarget`, `getEntryCell`, and everything else under `src/game/engine/*`.
- `inverseMoves.ts`'s three functions and their forward-verification discipline (`verifyPredecessor`).
- `canonicalKey`'s hashing scheme.
- The BFS shortest-path property itself (only its bookkeeping is extended).
- Level serialization (`levelSchema.ts`).

## 16. Acceptance criteria

This design is not considered validated merely because the code compiles and unit tests pass. It requires an empirical batch comparison (§12) against the 4b baseline showing:

1. A substantial increase in the percentage of levels with `crossingMoveCount > 0` (baseline: 0.75% of 399 sampled).
2. A substantial increase in levels with `groupsUsed >= 2`.
3. Materially flatter group-participation-by-slot distribution than 4b's measured 659/113/92/7.
4. Hard-tier levels that satisfy every explicit structural minimum, not just the scalar score.
5. The final hard-level batch is not composed of near-identical difficulty profiles.
6. `MAX_ATTEMPTS` and `hardCandidatePoolSize` are confirmed sufficient (or retuned) for a real `targetPerTier=5` run to complete within reasonable wall-clock time and memory.

## 17. Files touched summary

| File | Change |
|---|---|
| `tools/generator/generatorConfig.ts` | New — centralizes every tunable weight/threshold/range |
| `tools/generator/seed.ts` | Approach A requirement relocation + `boxOriginalPosition`; slot-geometry helpers; player-start diversification |
| `tools/generator/pruneUntouchedGoals.ts` | Approach A only — direct box-position check, 2-arg signature |
| `tools/generator/generateLevel.ts` | Takes `groups`; weighted candidate selection replacing uniform shuffle-and-take-first |
| `tools/generator/solver.ts` | `solve` returns `SolveResult`; adds `countEatMoves`, `countGroupsUsed` |
| `tools/generator/difficultyScorer.ts` | Multi-factor `DifficultyMetrics`-based scoring and tiering with explicit hard minimums |
| `tools/generator/generateBatch.ts` | New config-driven step range; hard-tier candidate pool + ranking + diversity selection; easy/medium unchanged first-match |
| `tools/generator/*.test.ts` | Updated/added per §13 |
| `src/levels/builtin/generated/*.json` | Regenerated only after §12's diagnostic pass |

Unchanged: `tools/generator/inverseMoves.ts`, `tools/generator/canonical.ts`, all of `src/game/engine/*`, `src/game/engine/levelSchema.ts`.
