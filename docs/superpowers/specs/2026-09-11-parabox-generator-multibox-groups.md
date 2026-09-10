# Parabox Level Generator — Multi-Box Groups (Phase 1 of a two-phase mechanic-variety project)

**Status:** Draft for review
**Builds on:** `2026-09-06-parabox-generator-full-design.md` (Approach A, hard-tier scoring, seed profiles, direction-seeking walk, push-move metric — all unchanged and load-bearing here)
**Scope:** This document covers **Phase 1 only** — multi-box groups. Phase 2 (nested containers, using the currently-dead `enter` mechanic for real) is a separate, larger, and riskier change deferred to its own future spec once Phase 1 is validated in production.

## 1. Motivation

Live user feedback across several rounds of playtesting the shipped generator (session of 2026-09-10/11, commits `db2641c`, `7065427`, `e58d948`, `1521dc1`) converged on the same complaint in different words: every generated level has the *same shape*. Concretely: a "group" (container + box + interior) always resolves the same way — walk to the container, optionally push something out of the way, perform one `eat`, done. Adding `pushMoveCount` (commit `1521dc1`) made that walk contain more real box-pushing, but it did not change the fact that winning a group is always exactly one atomic event.

The user's own diagnosis, confirmed by re-reading `inverseMoves.ts` and the full design spec's own §4.2 proof: the player's board is invariant at `root` for the entire reverse walk, so the `enter` mechanic never fires — the only mechanic that has ever produced a win in this generator is `eat`. No amount of weight/threshold tuning can change that; it is a structural fact about what the seed can currently construct.

The user asked for two specific mechanic-variety features:

1. **Multi-stage boxes**: a single group requires more than one `eat` to fully solve, so a group *itself* has internal sequencing/variety, not just "more groups."
2. **Nested containers**: a container inside another group's interior, requiring the player to genuinely walk *into* an interior (finally exercising `enter`) to reach it.

Per this session's own established practice (small, diagnosable, one-variable-at-a-time changes — every larger simultaneous change this session had to be partially reverted), the two features are split into separate sub-projects. **This spec is Phase 1: multi-box groups only.** It does not touch `enter`, board hierarchy depth, or `inverseEnter`'s dead-code status at all — that is entirely Phase 2's concern.

## 2. What "multi-box" means, mechanically

A group's container can have **two** walls instead of one — two of its four root-adjacent cells are walls instead of one, on two independently-chosen directions. Each wall direction independently enables an `eat` toward its own entry cell on the *same* interior board (per `getEntryCell(interior, dir, HALF)`, every one of the 4 possible directions maps to a distinct edge-center cell of that interior — up/down/left/right entry cells never coincide, for any interior size ≥ 3, regardless of which subset of directions is walled). The interior gets **two** independent `requirement: 'box'` cells, one per wall direction, each pre-occupied by its own box at seed time.

**Winning the group** means: both requirement cells are simultaneously satisfied (per `checkWin`'s existing global scan — unchanged, no engine modification). This can happen via two separate `eat` events (usually at different points in the solve), or, if the reverse walk only ever displaced one of the two boxes, the other box's requirement is already trivially met from the start (it never left) and only one `eat` is actually needed to finish that group.

**This is the source of the "variety" the user asked for, and it falls out for free — no new generation heuristic is required to produce it:** whether a multi-box group ends up needing one `eat` or two depends entirely on how many of its boxes the reverse walk happens to displace. The existing touch-count/cooldown machinery (§6.3 of the full design spec, and this session's oscillation-cooldown addition) already governs that stochastically. Every group is still, individually, either "fully solved already" (untouched, pruned away) or "has ≥1 unsatisfied requirement" (survives) — multi-box only changes how many atomic events satisfying that group can take, not the pruning/survival logic's shape.

## 3. Data model change: `SeedGroup.boxes`

The single biggest change is replacing `SeedGroup`'s flat `boxId`/`boxOriginalPosition` fields with an array, because every group-aware function in the pipeline (`pruneUntouchedGoals`, `generateLevel`'s `candidateWeight`, `solver`'s `countGroupsUsed`) currently assumes exactly one box per group.

```ts
// seed.ts
export interface GroupBox {
  boxId: string
  originalPosition: { x: number; y: number } // the box's cell on its own interior board
}

export interface SeedGroup {
  containerId: string
  interiorId: string
  originalPosition: { x: number; y: number } // container's root position (unchanged meaning)
  boxes: GroupBox[] // length 1 (ordinary group) or 2 (multi-box group)
}
```

This is a **breaking** change to the type, not an additive one — the old `boxId`/`boxOriginalPosition` fields are removed entirely, not kept alongside `boxes`. Every consumer is updated below. There is no external caller of `SeedGroup` outside `tools/generator/*` (confirmed by the same grep sweep the original full-design spec did), so this is safe to do as a hard rename rather than a deprecate-and-migrate.

## 4. `seed.ts` changes

### 4.1 `SeedProfile` gains `multiBoxProbability`

```ts
export interface SeedProfile {
  fourGroupProbability: number
  largeInteriorProbability: number
  remoteStartProbability: number
  multiBoxProbability: number // NEW: chance a given group gets 2 boxes instead of 1
}
```

Per the user's own choice: this applies uniformly to *every* group draw in *both* `seedProfile` (general) and `hardSeedProfile`, exactly like `fourGroupProbability`/`largeInteriorProbability` already do — not gated to hard-only. Proposed values: `seedProfile.multiBoxProbability = 0.3`, `hardSeedProfile.multiBoxProbability = 0.5` (hard-biased runs skew toward the more complex shape, consistent with how the other two probabilities are already biased upward for hard). These are initial values, not validated — same status as every other weight in `generatorConfig.ts`, subject to the mandatory diagnostic pass in §8 before shipping.

### 4.2 Picking 1 or 2 *distinct* wall directions with minimal RNG-contract disruption

The existing single-wall draw is exactly one `rng()` call: `DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]`. To keep every existing single-box test sequence valid unchanged when `multiBoxProbability` rolls false, the two-direction case is built as "first direction, then a distinct second direction via a nonzero offset" — never a full reshuffle (which would cost 3 `rng()` calls even for the 1-direction case and silently break every existing hand-tuned test sequence in `seed.test.ts`):

```ts
function pickWallDirs(rng: () => number, count: 1 | 2): Direction[] {
  const first = Math.floor(rng() * DIRECTIONS.length)
  if (count === 1) return [DIRECTIONS[first]]
  // A nonzero offset in [1, DIRECTIONS.length-1] guarantees `second !== first`
  // without rejection sampling (which would consume a variable, unbounded
  // number of rng() calls).
  const offset = 1 + Math.floor(rng() * (DIRECTIONS.length - 1))
  const second = (first + offset) % DIRECTIONS.length
  return [DIRECTIONS[first], DIRECTIONS[second]]
}
```

**RNG-call contract per group** (this is the part every rewritten test in §7 must match exactly):
1. `isMultiBox = rng() < profile.multiBoxProbability` — **1 call, always**, drawn *before* the wall-direction pick.
2. `wallDirs = pickWallDirs(rng, isMultiBox ? 2 : 1)` — **1 call if single-box, 2 calls if multi-box**.
3. `interiorSize = rng() < profile.largeInteriorProbability ? 5 : 3` — **1 call, always** (unchanged draw, now sequenced after the wall-direction pick instead of before — this shifts every downstream `rng()` call index for every group after this one, which is why every existing seed.test.ts sequence needs rebuilding, not just extending).

### 4.3 Per-group construction loop (replaces the current single-box body)

```ts
for (let i = 0; i < groupCount; i++) {
  const { x: containerX, y: containerY } = getSlotCenter(i)

  const isMultiBox = rng() < profile.multiBoxProbability
  const wallDirs = pickWallDirs(rng, isMultiBox ? 2 : 1)
  for (const wallDir of wallDirs) {
    const wallPos = step(containerX, containerY, wallDir)
    cells[wallPos.y][wallPos.x] = { type: 'wall' }
  }
  cells[containerY][containerX] = { type: 'floor' }

  const interiorSize = rng() < profile.largeInteriorProbability ? 5 : 3
  const interiorId = `goal${i}Inside`
  const containerId = `goal${i}`
  const interior = { id: interiorId, size: interiorSize, cells: makeFloorCells(interiorSize) }

  const boxes: GroupBox[] = []
  for (const [boxIndex, wallDir] of wallDirs.entries()) {
    // Single-box groups keep the old id shape (`box0`) exactly, so any code
    // or fixture that assumed that naming outside this file is unaffected.
    const boxId = wallDirs.length > 1 ? `box${i}_${boxIndex}` : `box${i}`
    const { cell: eatenCell } = getEntryCell(interior, opposite(wallDir), HALF)
    if (eatenCell === null) {
      // Provably unreachable, same reasoning as the single-box case: HALF
      // always maps to an in-bounds center-of-edge cell for any board size
      // >= 1, for any of the 4 directions independently.
      throw new Error(`createSeedWorld: getEntryCell unexpectedly returned null for interior size ${interiorSize}`)
    }
    interior.cells[eatenCell.y][eatenCell.x] = { type: 'floor', requirement: 'box' }
    pieces[boxId] = { id: boxId, kind: 'normal' }
    locations[boxId] = { board: interiorId, x: eatenCell.x, y: eatenCell.y }
    boxes.push({ boxId, originalPosition: { x: eatenCell.x, y: eatenCell.y } })
  }
  boards[interiorId] = interior

  pieces[containerId] = { id: containerId, kind: 'container', boardRef: interiorId }
  locations[containerId] = { board: 'root', x: containerX, y: containerY }

  groups.push({
    containerId,
    interiorId,
    originalPosition: { x: containerX, y: containerY },
    boxes,
  })
}
```

### 4.4 Safety proof for two walls (extends §6.1 of the full design spec, does not replace it)

The existing proof already covers this without modification: "a slot's 4 possible wall cells are the center ± 1 in exactly one axis (cardinal-adjacent); the player candidate is the center − 1 in *both* axes (diagonal) — these can never coincide." That statement is about *any* subset of the 4 cardinal-adjacent cells relative to the fixed diagonal player candidate — it was never dependent on exactly one of the four being chosen. Two walls instead of one changes nothing about this proof. The two entry cells on the interior (for two different directions) are likewise always distinct: `getEntryCell` maps each of the 4 directions to a different edge-center cell (top/bottom/left/right center), and no two distinct directions ever produce the same cell, for any interior size ≥ 3 — this needs no new proof, it is a direct property of `getEntryCell`'s existing per-direction formula (unchanged, out of scope).

## 5. `pruneUntouchedGoals.ts` changes

```ts
export function isGroupUntouched(world: World, group: SeedGroup): boolean {
  return group.boxes.every((box) => {
    const loc = world.locations[box.boxId]
    return (
      loc.board === group.interiorId &&
      loc.x === box.originalPosition.x &&
      loc.y === box.originalPosition.y
    )
  })
}

export function getSurvivingGroups(world: World, groups: SeedGroup[]): SeedGroup[] {
  return groups.filter(
    (group) =>
      world.pieces[group.containerId] !== undefined &&
      world.boards[group.interiorId] !== undefined &&
      group.boxes.every((box) => world.pieces[box.boxId] !== undefined),
  )
}

function removeGroup(world: World, group: SeedGroup): World {
  const next = cloneWorld(world)
  // This loop already deletes every piece located on the interior board
  // generically — for any number of boxes, not just one — so no per-box
  // enumeration is needed here at all (this is actually a simplification
  // versus the single-box version, which had a redundant explicit
  // `delete next.pieces[group.boxId]` alongside this same loop).
  for (const [pieceId, loc] of Object.entries(next.locations)) {
    if (loc.board !== group.interiorId) continue
    if (pieceId === PLAYER_ID) {
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
  delete next.pieces[group.containerId]
  delete next.locations[group.containerId]
  return next
}
```

`pruneUntouchedGoals` itself (the loop calling `isGroupUntouched`/`removeGroup` per group) is unchanged — it already treats a group as one opaque unit.

**A multi-box group only gets pruned if *every* one of its boxes is still exactly at its seed position.** If even one box moved, the *entire* group survives — including the box(es) that never moved, which keep their (already-satisfied) requirement. This is the mechanism described in §2: a surviving multi-box group may need one or two more `eat`s depending on how much the reverse walk actually displaced, and that is intentional, emergent variety, not a bug.

## 6. `generateLevel.ts` changes

Both places `candidateWeight` and the touch-count-update loop check "did this candidate touch group X" need to check the box *array*, not a single id:

```ts
// candidateWeight's per-group loop:
for (const group of groups) {
  const touchedThisGroup =
    moved.includes(group.containerId) || group.boxes.some((box) => moved.includes(box.boxId))
  if (!touchedThisGroup) continue
  const touches = touchCounts.get(group.containerId) ?? 0
  const recentCount = recentTouches.filter((id) => id === group.containerId).length
  const repeatPenalty = 1 / (1 + recentCount)
  weight += (touches === 0 ? weights.newGroupBonus : weights.repeatedGroupWeight / touches) * repeatPenalty
}
```

```ts
// after weightedPick, the touch-count/recency update loop:
for (const group of groups) {
  const touchedThisGroup =
    accepted.moved.includes(group.containerId) || group.boxes.some((box) => accepted.moved.includes(box.boxId))
  if (touchedThisGroup) {
    touchCounts.set(group.containerId, (touchCounts.get(group.containerId) ?? 0) + 1)
    recentTouches.push(group.containerId)
    if (recentTouches.length > OSCILLATION_RECENT_WINDOW) recentTouches.shift()
  }
}
```

Touch-count/cooldown tracking stays keyed by `containerId` (group-level), not per-box — deliberately: this is Phase 1's simplest correct option. If diagnostics (§8) show multi-box groups rarely get *both* boxes displaced (because touching one box already marks the whole group as "touched", making the second box's displacement look like a discouraged repeat rather than a fresh target), per-box touch tracking is the natural documented follow-up — not implemented preemptively here, matching this design's own established principle of not building a mechanism until diagnostics show it's needed (see the full design spec's §6.3 on the oscillation cooldown itself, which was deferred for exactly this reason and only added once diagnostics confirmed the need).

`directionSeekWeights`/`untouchedGroupPositions` are unaffected — they already operate on `group.originalPosition` (the container's root position), never on box identity.

## 7. `solver.ts` changes

`countGroupsUsed`'s inner loop generalizes from a fixed 2-element list to the container plus every box:

```ts
export function countGroupsUsed(world: World, moves: Direction[], groups: SeedGroup[]): number {
  const usedGroups = new Set<string>()
  let current = world
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countGroupsUsed received an invalid move for this world')
    for (const group of groups) {
      if (usedGroups.has(group.containerId)) continue
      for (const pieceId of [group.containerId, ...group.boxes.map((b) => b.boxId)]) {
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

A multi-box group counts as "used" if *either* box (or the container) moved at all — same semantic as before, just generalized. `countEatMoves`/`countCrossingMoves`/`countPushMoves` are already piece-agnostic (they scan every piece in `world.locations`, not specific group members) and need **no changes at all**.

## 8. `generatorConfig.ts` changes

```ts
export interface SeedProfile {
  fourGroupProbability: number
  largeInteriorProbability: number
  remoteStartProbability: number
  multiBoxProbability: number
}

export const GENERATOR_CONFIG: GeneratorConfig = {
  // ...
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
  // ... (everything else unchanged)
}
```

`generateBatch.ts` needs no changes beyond this — it never references `boxId` directly, only `getSurvivingGroups`/`isGroupUntouched`/`countGroupsUsed`, all already updated above.

## 9. Mandatory diagnostic pass before shipping (same discipline as every prior phase this session)

Per this project's own established practice (every phase of the original full-design spec, and every change this session — several of which were reverted after diagnostics showed they made things worse), a diagnostic batch must run and report before regenerating shipped JSON:

- **Multi-box incidence**: fraction of surviving groups that are multi-box, compared against `multiBoxProbability` (sanity-check the draw rate survives pruning proportionally, not skewed).
- **Both-boxes-displaced rate**: among surviving multi-box groups, what fraction have *both* boxes away from their seed position (needing 2 `eat`s to finish) versus only one (needing 1, same as an ordinary group)? This is the number that validates or refutes §6's "no extra heuristic needed" claim — if it's very low (e.g., <10%), the per-box touch-tracking follow-up flagged in §6 should be implemented before shipping, not deferred further.
- **Score/tier distribution shift**: multi-box groups don't change `scoreDifficulty`'s formula, but they do change what `eatCount`/`groupsUsed` values are achievable for a *single* surviving group — re-measure the easy/medium/hard split (currently `EASY_MEDIUM_SCORE_THRESHOLD = 45`) in case it needs retuning, same as every previous metric addition this session required.
- **Crash/invariant check**: the Approach-A invariant check in `generateBatch.ts` (every surviving group must have `!isGroupUntouched`) must never fire on a real batch run — this is the direct multi-box analog of the crash the original full-design spec's own review caught for the single-box case.
- **Regression baseline**: single-box behavior (when `multiBoxProbability` rolls false, the overwhelming majority of groups) must be measurably unchanged from the `1521dc1` baseline — same `pushMoveCount`/`eatCount`/`moveCount` distributions for those groups, confirming the RNG-contract change in §4.2 didn't silently alter unrelated behavior.

## 10. Test impact

- **`seed.test.ts`**: full rewrite of every hand-tuned RNG sequence (the §4.2 call-order change shifts every downstream draw). New coverage: a multi-box group has exactly 2 walls and 2 distinct `requirement: 'box'` cells on its interior, at the correct entry cells for its two wall directions; `boxes.length` matches the `isMultiBox` draw; a single-box group's exact RNG consumption (1 call for `isMultiBox` returning false, 1 call for the wall direction) matches the documented contract; `pickWallDirs(rng, 2)` always returns two distinct directions for every possible `first` value (0-3) crossed with every possible `offset` value (1-3) — a small exhaustive table, not a probabilistic spot-check.
- **`pruneUntouchedGoals.test.ts`**: `makeGroup` test helper rebuilt to construct `boxes: GroupBox[]`. New: a multi-box group where only one box moved survives with *both* boxes intact (the untouched one keeps its satisfied requirement); a multi-box group where *neither* box moved gets fully pruned (container + interior + both boxes deleted); `getSurvivingGroups` correctly requires *every* box's piece to exist, not just one.
- **`generateLevel.test.ts`**: any inline `SeedGroup` literal updated to the `boxes` shape. New: a candidate that moves the *second* box of a multi-box group (not the first) is still recognized as touching that group by `candidateWeight`.
- **`solver.test.ts`**: `countGroupsUsed`'s existing `SeedGroup` fixture updated to `boxes` shape; new test with a 2-box group where only the second box moves (still counts as 1 used group, same as either box alone).
- **`generateBatch.test.ts`**: no `SeedGroup` literals directly constructed here (it drives the real pipeline end-to-end) — existing tests should pass unchanged once the above compile; add one assertion that a real batch run's shipped levels include at least one multi-box group somewhere in a large-enough sample (guards against the feature silently never firing).
- **New empirical diagnostic pass** (§9) — required before regenerating `src/levels/builtin/generated/*.json`, matching this project's own precedent every single time before this.

## 11. Explicitly deferred to Phase 2 (nested containers) — not in this spec

- Any change to `inverseEnter`'s dead-code status, or to the "player's board is invariant at root" proof (full design spec §4.2).
- Seeding a container whose "root" is another group's interior board.
- Any seed construction that starts the reverse walk with the player already inside an interior (required for `inverseEnter` to ever have a valid predecessor to reverse into).
- Any change to board-hierarchy depth beyond the current 2 tiers (root + one level of interiors).

Phase 2 is a separate brainstorming → spec → plan cycle, only after Phase 1 ships and its diagnostics are reviewed.
