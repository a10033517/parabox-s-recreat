# Parabox Level Generator — Multi-Box Groups

## Phase 1: Multi-box groups

**Status:** Accepted for implementation. Supersedes the initial draft (same filename, prior commit `d3695a9`) — that draft's §4.2 claim that old single-box RNG sequences stay valid at `multiBoxProbability = 0` was wrong (the unconditional `isMultiBox` draw shifts the stream regardless of its result); this revision's §2.3 versioned-seed-contract policy replaces that claim.
**Builds on:** `2026-09-06-parabox-generator-full-design.md`
**Scope:** This phase adds groups containing two boxes. Nested containers and real use of `enter` remain deferred to Phase 2.
**Pre-implementation verification (§2.4/§12 step 1), done:** confirmed against current `src/game/engine/rules.ts` — `checkWin` (line 154) scans every board's every requirement cell globally and independently; any non-player occupant satisfies a `'box'` requirement (so two requirement cells on one interior board are already supported with zero engine changes). `getEntryCell` (line 30) maps each of the 4 directions to a distinct cell for both interior size 3 and size 5 (hand-verified: size 3 → {(1,2),(1,0),(2,1),(0,1)}; size 5 → {(2,4),(2,0),(4,2),(0,2)}, all four distinct in both cases). This phase requires no engine change.

---

## 1. Executive summary

The current generator creates a group with one container, one interior board, one wall/entry direction, and one box requirement. A group therefore normally resolves through one `eat` event.

This phase introduces a group with either:

- **one box** — existing behavior;
- **two boxes** — two distinct wall directions and two distinct box requirements on the same interior board.

The implementation must preserve the following invariants:

1. Every generated group has one container and one interior board.
2. A group has exactly one or two boxes.
3. Every box belongs to exactly one group and is placed on its own interior board.
4. Two-box groups use two distinct cardinal wall directions.
5. The two requirement cells are distinct and valid.
6. Untouched groups are pruned only when **all** of their boxes remain at their seed positions.
7. Existing single-box behavior remains available when `multiBoxProbability = 0`.
8. No Phase 2 behavior is introduced: no nested containers, no hierarchy deeper than root + one interior, and no changes to `enter`/`inverseEnter`.

> Important: A two-box group does not automatically guarantee that the final level requires two `eat` events. The generator must measure how often both boxes are actually displaced. This is an empirical acceptance criterion, not an assumption.

---

## 2. Problems corrected from the previous draft

### 2.1 Do not equate probability with surviving-level incidence

`multiBoxProbability` is the probability of selecting a two-box seed **before** reverse-walk generation and pruning. The final percentage of surviving groups that are multi-box can differ because:

- multi-box groups have more pieces that can be touched;
- multi-box groups may be more or less likely to survive pruning;
- the reverse walk and cooldown logic may bias which groups are displaced;
- invalid or rejected candidates may affect the final population.

Diagnostics must therefore report at least three separate values:

1. seed-time multi-box draw rate;
2. surviving-group multi-box rate;
3. shipped-level multi-box rate.

Do not treat any one of these as a direct assertion that the configured probability is being respected.

### 2.2 Two boxes do not prove two-stage gameplay

A two-box group only creates the possibility of two independent `eat` events. It does not guarantee that both boxes leave their seed positions during the reverse walk.

The design must measure:

- zero displaced boxes — group should normally be pruned;
- one displaced box — surviving group may require one `eat`;
- two displaced boxes — surviving group may require two `eat`s.

If the two-displaced-box rate is too low, the implementation must add per-box targeting or another explicitly tested mechanism before shipping.

### 2.3 RNG compatibility needs an explicit policy

Adding an unconditional `isMultiBox` draw changes the RNG stream even when the configured probability is `0`. This is not compatible with the old seed sequences.

The implementation must choose one of these policies explicitly:

- **Recommended:** accept a new RNG contract and rewrite all hand-authored RNG fixtures;
- **Compatibility mode:** if `multiBoxProbability === 0`, use the old single-box seed path without the new draw;
- **Versioned seed contract:** include a generator version in seed metadata and maintain separate expected fixtures.

The preferred choice for this phase is the **versioned seed contract**, because it makes generated output reproducible and prevents silent changes to old fixtures.

### 2.4 The `checkWin` assumption must be verified

The design assumes that the existing global `checkWin` scan considers both requirement cells and succeeds only when both are satisfied. This must be verified against the actual implementation.

Before implementation, confirm:

- whether a requirement is satisfied by a box occupying the cell or by another condition;
- whether a requirement can be satisfied while the box is still at its seed position;
- whether `eat` removes/replaces the box or transfers it between boards;
- whether `checkWin` scans all boards or only the active board;
- whether two requirements on one interior board are supported by the current world model.

If any answer is incompatible, this phase requires an engine change and is no longer a generator-only change.

---

## 3. Mechanical definition

A two-box group has:

- one root container cell;
- two cardinal-adjacent wall cells around the container;
- one interior board;
- two distinct entry cells on that interior board;
- two normal boxes, each initially occupying one requirement cell.

Let the two wall directions be `d1` and `d2`, with `d1 !== d2`.

For each direction `d`:

```ts
const wallPos = step(containerPosition, d)
const eatenCell = getEntryCell(interior, opposite(d), HALF)
```

The implementation must verify that:

```ts
wallPos !== playerCandidatePosition
```

and that the two calculated interior cells are distinct:

```ts
entryCell(d1) !== entryCell(d2)
```

Do not rely only on comments or an informal proof. Add executable assertions in tests.

### 3.1 Win semantics

A group is considered solved only when all of its requirement cells are satisfied.

For a two-box group:

- both requirements satisfied at seed time: the group is untouched and should be pruned;
- one box displaced: the group survives and may need one `eat`;
- both boxes displaced: the group survives and may need two `eat`s;
- the container or either box is missing unexpectedly: the world is invalid and generation must fail loudly rather than silently shipping the level.

The phrase “two independent `eat`s” must be treated as a measured outcome, not a guaranteed property of every two-box group.

---

## 4. Data model

### 4.1 `GroupBox`

```ts
export interface GroupBox {
  boxId: string
  originalPosition: { x: number; y: number }
}
```

### 4.2 `SeedGroup`

```ts
export interface SeedGroup {
  containerId: string
  interiorId: string
  originalPosition: { x: number; y: number }
  boxes: GroupBox[] // exactly 1 or 2
}
```

### 4.3 Runtime validation

Add a validation helper and call it after seed construction in tests and diagnostic generation:

```ts
function assertValidSeedGroup(group: SeedGroup): void {
  if (group.boxes.length !== 1 && group.boxes.length !== 2) {
    throw new Error(`Invalid box count for group ${group.containerId}`)
  }

  const ids = new Set(group.boxes.map((box) => box.boxId))
  if (ids.size !== group.boxes.length) {
    throw new Error(`Duplicate box id in group ${group.containerId}`)
  }
}
```

The exact helper name may differ, but the invariant must be enforced somewhere in the implementation or test boundary.

This is a breaking type change. Remove the old `boxId` and `boxOriginalPosition` fields rather than retaining two competing representations.

---

## 5. Seed generation

### 5.1 `SeedProfile`

```ts
export interface SeedProfile {
  fourGroupProbability: number
  largeInteriorProbability: number
  remoteStartProbability: number
  multiBoxProbability: number
}
```

Initial proposed values:

```ts
seedProfile.multiBoxProbability = 0.3
hardSeedProfile.multiBoxProbability = 0.5
```

These values are provisional. They must not be treated as validated difficulty settings until the diagnostic pass is complete.

### 5.2 Direction selection

Use a bounded, rejection-free selection for two distinct directions:

```ts
function pickWallDirs(rng: () => number, count: 1 | 2): Direction[] {
  const first = Math.floor(rng() * DIRECTIONS.length)

  if (count === 1) {
    return [DIRECTIONS[first]]
  }

  const offset = 1 + Math.floor(rng() * (DIRECTIONS.length - 1))
  const second = (first + offset) % DIRECTIONS.length

  return [DIRECTIONS[first], DIRECTIONS[second]]
}
```

Required properties:

- exactly one RNG call for the first direction;
- exactly one additional RNG call for the second direction;
- no rejection loop;
- no duplicate directions;
- no dependence on direction enum ordering beyond the existing `DIRECTIONS` array.

### 5.3 RNG contract

If using the new versioned seed contract, document the order exactly:

1. draw `isMultiBox`;
2. draw the first wall direction;
3. if multi-box, draw the second-direction offset;
4. draw interior size;
5. construct the group;
6. continue to the next group.

Do not claim that old RNG fixtures remain unchanged unless the compatibility mode described in §2.3 is implemented.

### 5.4 Construction pseudocode

```ts
for (let i = 0; i < groupCount; i++) {
  const { x: containerX, y: containerY } = getSlotCenter(i)

  const isMultiBox = rng() < profile.multiBoxProbability
  const wallDirs = pickWallDirs(rng, isMultiBox ? 2 : 1)
  const interiorSize = rng() < profile.largeInteriorProbability ? 5 : 3

  for (const wallDir of wallDirs) {
    const wallPos = step(containerX, containerY, wallDir)
    cells[wallPos.y][wallPos.x] = { type: 'wall' }
  }

  cells[containerY][containerX] = { type: 'floor' }

  const interiorId = `goal${i}Inside`
  const containerId = `goal${i}`
  const interior = {
    id: interiorId,
    size: interiorSize,
    cells: makeFloorCells(interiorSize),
  }

  const boxes: GroupBox[] = []

  for (const [boxIndex, wallDir] of wallDirs.entries()) {
    const boxId = wallDirs.length === 1
      ? `box${i}`
      : `box${i}_${boxIndex}`

    const { cell: eatenCell } = getEntryCell(
      interior,
      opposite(wallDir),
      HALF,
    )

    if (eatenCell === null) {
      throw new Error(
        `createSeedWorld: invalid entry cell for ${containerId}`,
      )
    }

    interior.cells[eatenCell.y][eatenCell.x] = {
      type: 'floor',
      requirement: 'box',
    }

    pieces[boxId] = { id: boxId, kind: 'normal' }
    locations[boxId] = {
      board: interiorId,
      x: eatenCell.x,
      y: eatenCell.y,
    }

    boxes.push({
      boxId,
      originalPosition: { x: eatenCell.x, y: eatenCell.y },
    })
  }

  boards[interiorId] = interior
  pieces[containerId] = {
    id: containerId,
    kind: 'container',
    boardRef: interiorId,
  }
  locations[containerId] = {
    board: 'root',
    x: containerX,
    y: containerY,
  }

  groups.push({
    containerId,
    interiorId,
    originalPosition: { x: containerX, y: containerY },
    boxes,
  })
}
```

After construction, validate:

- exactly one or two boxes;
- unique box IDs globally;
- every box exists in `pieces` and `locations`;
- every box location points to the group interior;
- every box location is a requirement cell;
- two-box entry cells are distinct;
- all wall positions are in bounds;
- no wall overlaps the player candidate or another required root cell.

---

## 6. Pruning

### 6.1 `isGroupUntouched`

```ts
export function isGroupUntouched(
  world: World,
  group: SeedGroup,
): boolean {
  return group.boxes.every((box) => {
    const loc = world.locations[box.boxId]
    if (!loc) return false

    return (
      loc.board === group.interiorId &&
      loc.x === box.originalPosition.x &&
      loc.y === box.originalPosition.y
    )
  })
}
```

The missing-location case must be handled explicitly. Returning `true` for a missing box would incorrectly prune a broken group.

### 6.2 Surviving groups

```ts
export function getSurvivingGroups(
  world: World,
  groups: SeedGroup[],
): SeedGroup[] {
  return groups.filter((group) =>
    world.pieces[group.containerId] !== undefined &&
    world.boards[group.interiorId] !== undefined &&
    group.boxes.every((box) =>
      world.pieces[box.boxId] !== undefined,
    ),
  )
}
```

A multi-box group survives if at least one box was displaced, assuming the container, interior, and all expected pieces still exist.

### 6.3 Removal

The removal routine should delete all pieces located on the interior board generically, then delete the board and container. It must reject removal if the player is inside the interior.

Add a test specifically covering:

- one untouched box and one moved box;
- both boxes removed from the world unexpectedly;
- a missing location entry;
- the player inside the interior.

---

## 7. `generateLevel.ts`

Both candidate scoring and touch-count updates must treat a group as touched when the container **or any box** moved.

```ts
const touchedThisGroup =
  moved.includes(group.containerId) ||
  group.boxes.some((box) => moved.includes(box.boxId))
```

The group-level counter can remain keyed by `containerId` for the first implementation, but this is a known risk:

> Touching box A can make touching box B look like a repeated group touch, even when box B has never moved.

Therefore, diagnostics must report the displacement rate of the first and second boxes separately. If the two-box displacement rate is below the agreed threshold, implement per-box touch tracking before shipping.

### 7.1 Recommended acceptance threshold

Use the following as an initial engineering threshold, not a gameplay truth:

- if fewer than **10%** of surviving two-box groups have both boxes displaced, stop and investigate;
- if the rate is acceptable but the resulting difficulty distribution is too low, tune scoring separately;
- do not hide a low two-box displacement rate by increasing `multiBoxProbability` alone.

The final threshold may be changed after observing a sufficiently large diagnostic sample.

---

## 8. `solver.ts`

Generalize `countGroupsUsed` from a fixed container + one box list to the container plus every box:

```ts
export function countGroupsUsed(
  world: World,
  moves: Direction[],
  groups: SeedGroup[],
): number {
  const usedGroups = new Set<string>()
  let current = world

  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) {
      throw new Error(
        'countGroupsUsed received an invalid move for this world',
      )
    }

    for (const group of groups) {
      if (usedGroups.has(group.containerId)) continue

      const pieceIds = [
        group.containerId,
        ...group.boxes.map((box) => box.boxId),
      ]

      for (const pieceId of pieceIds) {
        const before = current.locations[pieceId]
        const after = next.locations[pieceId]
        if (!before || !after) continue

        if (
          before.board !== after.board ||
          before.x !== after.x ||
          before.y !== after.y
        ) {
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

Add tests proving that moving only the second box counts as one used group.

Do not modify `countEatMoves`, `countCrossingMoves`, or `countPushMoves` until tests demonstrate that their current piece-agnostic scans are insufficient.

---

## 9. Configuration

```ts
export const GENERATOR_CONFIG: GeneratorConfig = {
  // ... existing settings
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
}
```

Validate configuration values at startup:

```ts
function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a probability in [0, 1]`)
  }
}
```

`generateBatch.ts` should not need direct box-ID logic if all group-aware helpers are correctly generalized.

---

## 10. Required diagnostics before shipping

Run a large batch using fixed seeds and report both absolute counts and percentages.

### 10.1 Seed composition

Report:

- total seeded groups;
- number of single-box groups;
- number of two-box groups;
- actual seed-time multi-box rate;
- configured `multiBoxProbability`.

### 10.2 Survival and pruning

Report separately:

- surviving single-box groups;
- surviving two-box groups;
- surviving-group multi-box rate;
- number of groups pruned as untouched;
- number of invalid groups rejected.

### 10.3 Two-box displacement

Among surviving two-box groups, report:

- neither box displaced;
- only box 0 displaced;
- only box 1 displaced;
- both boxes displaced;
- percentage requiring one potential `eat`;
- percentage requiring two potential `eat`s.

The “neither displaced” category should normally be zero among correctly surviving groups. If not, investigate `isGroupUntouched`, reverse-walk bookkeeping, or pruning order.

### 10.4 Difficulty distribution

Compare the new output with the `1521dc1` baseline:

- `moveCount`;
- `pushMoveCount`;
- `eatCount`;
- `groupsUsed`;
- score distribution;
- easy/medium/hard tier distribution;
- percentage of generated levels rejected by validation.

Do not assume that the old threshold `EASY_MEDIUM_SCORE_THRESHOLD = 45` remains appropriate.

### 10.5 Regression and invariants

The diagnostic run must verify:

- no duplicate piece IDs;
- no missing locations;
- every group has one or two boxes;
- every box belongs to the correct interior;
- all two-box requirement cells are distinct;
- no wall overlaps the player candidate;
- `isGroupUntouched` is false for every surviving group;
- solver replay succeeds for every shipped level;
- no generation crash occurs in the full batch.

---

## 11. Test plan

### 11.1 `seed.test.ts`

Add tests for:

1. one-box and two-box group construction;
2. exactly two walls for a two-box group;
3. distinct wall directions;
4. distinct requirement cells;
5. correct entry cell for every direction;
6. exact box count;
7. unique box IDs;
8. invalid probability rejection;
9. exhaustive `pickWallDirs(rng, 2)` combinations;
10. the documented RNG contract;
11. versioned or compatibility seed behavior, depending on the chosen policy.

### 11.2 `pruneUntouchedGoals.test.ts`

Cover:

- one-box untouched group is pruned;
- two-box untouched group is pruned;
- only first box moved → group survives;
- only second box moved → group survives;
- both boxes moved → group survives;
- untouched box remains present when the other box moved;
- missing box/location does not classify the group as untouched;
- player inside the interior prevents removal.

### 11.3 `generateLevel.test.ts`

Cover:

- moving the container touches the group;
- moving the first box touches the group;
- moving the second box touches the group;
- touch counts remain keyed by `containerId`;
- candidate scoring does not silently ignore the second box.

### 11.4 `solver.test.ts`

Cover:

- moving the container counts one group;
- moving the first box counts one group;
- moving only the second box counts one group;
- moving both boxes still counts one group;
- unrelated movement does not count the group.

### 11.5 `generateBatch.test.ts`

Cover:

- end-to-end generation with `multiBoxProbability = 0`;
- end-to-end generation with a nonzero probability;
- fixed-seed reproducibility;
- at least one two-box group in a sufficiently large sample;
- no surviving untouched group;
- all shipped levels pass solver/invariant validation.

---

## 12. Implementation order

1. Confirm the actual semantics of `checkWin`, `eat`, `getEntryCell`, and world locations.
2. Add `GroupBox` and replace the old single-box fields.
3. Add runtime validation for group structure.
4. Implement direction selection and seed construction.
5. Decide and document the RNG compatibility/versioning policy.
6. Update pruning.
7. Update candidate scoring and touch tracking.
8. Update `countGroupsUsed`.
9. Rewrite and extend unit tests.
10. Run fixed-seed diagnostics.
11. Tune `multiBoxProbability`, scoring, or touch tracking only after reviewing measurements.
12. Regenerate built-in JSON only after all diagnostics pass.

---

## 13. Explicitly deferred to Phase 2

The following are out of scope:

- nested containers;
- placing a container inside another group's interior;
- starting the reverse walk with the player inside an interior;
- changing `inverseEnter`;
- changing the proof that the player's board remains at root;
- hierarchy deeper than root + one interior;
- any engine-wide change to board traversal;
- any new win condition unrelated to the two box requirements.

Phase 2 must have its own design, implementation plan, invariant review, and diagnostic pass.

---

## 14. Final shipping criteria

Phase 1 is ready to ship only when all of the following are true:

- [ ] The actual engine semantics support two simultaneous requirements on one interior.
- [ ] All group consumers use `boxes`, not the removed single-box fields.
- [ ] Two-box groups always have two distinct valid directions and requirement cells.
- [ ] The RNG policy is explicit and all fixtures use it.
- [ ] Untouched two-box groups are pruned correctly.
- [ ] The second box is recognized by scoring, touch tracking, pruning, and solver metrics.
- [ ] The two-box displacement rate is measured and acceptable.
- [ ] Difficulty/tier distributions are reviewed against the baseline.
- [ ] Full regression and invariant tests pass.
- [ ] Fixed-seed generation is reproducible.
- [ ] Built-in generated JSON is regenerated only after diagnostics pass.
