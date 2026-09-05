# Parabox PWA — Multi-Goal Seed & Level Pruning Review

## Review scope

This review checks the proposed Sub-project 4b design for logical correctness, implementation safety, and whether the proposed tests actually establish the claims made by the spec. The source proposes replacing the single-goal seed with 3–4 goal groups and pruning groups that appear untouched after reverse generation. fileciteturn1file0L5-L14

## Executive conclusion

The overall direction is reasonable, but **the pruning criterion is not correct enough to implement as written**.

The most important flaw is:

> `container is still at originalPosition` does **not** imply that the goal group was untouched.

In particular, `inverseEnter` can move the player into a container's interior without moving the container itself. The proposed pruning code would therefore classify an actually-used group as untouched. Worse, if the player is currently inside that group when it is pruned, `removeGroup()` deletes every piece whose `location.board` is the interior board; that includes the player. The resulting `World` can therefore be structurally invalid.

There are several secondary issues:

1. The claim that the fixed 2×2 grid provides “2 cells of buffer” between slots is inaccurate. The slots are adjacent: one ends at coordinate 5 and the next begins at coordinate 6.
2. The expected maximum crossing count of `6–8` is not established by the proposed seed geometry or by the current inverse patterns.
3. `steps = 3 + floor(rng() * 20)` is inconsistent with the stated need to know whether the generator actually achieved the requested number of steps; the snippet expects `generated.world`, but the earlier `generateLevel()` contract returned a bare `World`.
4. The seed test assertion that `checkWin(seed)` is always true is plausible, but it does not prove that the seed is a valid *independent multi-goal* starting state.
5. The “no overlap” test only checks selected coordinates; it should validate the complete serialized/parsed world rather than rely primarily on hand-derived geometry.
6. The spec says the downstream algorithms need no changes, but the new seed/generator contract already requires at least one existing test call-site change; this should be explicitly included in the migration plan.
7. The pruning design needs a precise definition of “touched” before implementation.

**Recommendation: do not implement `pruneUntouchedGoals.ts` exactly as currently specified.** Keep the multi-goal seed idea, but redesign pruning around explicit generation provenance/touch tracking.

---

# P0 — Must fix before implementation

## 1. `container position unchanged` is not a valid untouched test

The current proposal says:

```ts
const current = next.locations[group.containerId]

if (
  current.board === 'root' &&
  current.x === group.originalPosition.x &&
  current.y === group.originalPosition.y
) {
  next = removeGroup(next, group.containerId)
}
```

The accompanying claim is that an unchanged container means the group was never disturbed. fileciteturn1file0L160-L170

That implication is false.

### Counterexample

Suppose the reverse walk performs:

```text
seed
  ↓ inverseEnter
player enters goal0's interior
```

The container remains at exactly the same root coordinate.

Therefore:

```text
container position unchanged
BUT
goal0 was used
```

The group must not be pruned.

This is especially important because `inverseEnter` is explicitly one of the three generation patterns. fileciteturn1file0L128-L136

### Required change

Do not define “touched” from the final container coordinate.

Instead, record whether each goal group participated in **any reverse transition**.

The cleanest design is for generation to return provenance:

```ts
interface GenerationResult {
  world: World
  appliedSteps: number
  touchedGroups: Set<string>
}
```

Whenever an inverse operation successfully applies, determine which goal group it affects and add that group to `touchedGroups`.

This is much stronger than trying to reconstruct history from the final state.

---

## 2. `removeGroup()` can delete the player

The current implementation removes every location whose `board` equals the container's interior board:

```ts
for (const [pieceId, pieceLoc] of Object.entries(next.locations)) {
  if (pieceLoc.board === interiorId) {
    delete next.pieces[pieceId]
    delete next.locations[pieceId]
  }
}
```

The player is also a piece and has a location.

Therefore, if the player is inside an apparently untouched container, this code can delete:

```ts
pieces[PLAYER_ID]
locations[PLAYER_ID]
```

That violates the `World` invariant.

This is not merely a theoretical edge case: `inverseEnter` exists specifically to move the player into a container interior.

### Required change

Pruning must never silently delete the player.

Better still, pruning should only remove a group that the generation provenance says was never touched. Then an actually entered group cannot reach this code path.

Add an explicit defensive assertion:

```ts
if (pieceId === PLAYER_ID) {
  throw new Error('Cannot prune a goal containing the player')
}
```

The exact policy can instead be “return failure and discard the generated level,” but silently deleting the player should not be allowed.

---

## 3. Final-state comparison is also vulnerable to “touched then returned”

Even if `inverseEnter` were ignored, comparing the final container position still has a second problem:

```text
seed
  ↓ move group
  ↓ move group back
final
```

The final position is identical to the seed position, but the group was clearly involved in the generated history.

Therefore:

```text
final state == seed position
```

does not imply:

```text
group was never touched
```

This is a general temporal-information problem: the final `World` does not contain enough information to reconstruct whether a piece temporarily moved.

### Required change

Use explicit provenance/touch tracking during generation rather than attempting to infer history from the final `World`.

---

# P0 — Generation contract must be fixed

## 4. The new `generateBatch.ts` expects a different `generateLevel()` return type

The proposed wiring contains:

```ts
const generated = generateLevel(seed, steps, rng)

if (!generated) {
  ...
}

const world = pruneUntouchedGoals(generated.world, groups)
```

But the existing generator contract described in the previous design returned a `World` directly.

This proposal also says `generateLevel.ts` is explicitly out of scope and unchanged. fileciteturn1file0L17-L21

Those two statements conflict.

If `generateLevel()` remains:

```ts
generateLevel(...): World
```

then:

```ts
generated.world
```

is invalid.

If it changes to:

```ts
generateLevel(...): GenerationResult
```

then `generateLevel.ts` is no longer unchanged.

### Required decision

Pick one of these designs explicitly.

### Recommended

Change the generator contract:

```ts
interface GenerationResult {
  world: World
  appliedSteps: number
  touchedGroups: Set<string>
}
```

Then update:

- `generateLevel.ts`
- `generateLevel.test.ts`
- `generateBatch.ts`

This is the most robust solution because it simultaneously solves:

- incomplete reverse walks
- touched-group tracking
- diagnostics
- future generation statistics

---

## 5. A requested `steps` count must not silently become fewer steps

The earlier generator stopped when it exhausted attempts and returned whatever state it had reached.

This proposal increases the requested range to:

```ts
const steps = 3 + Math.floor(rng() * 20)
```

but then treats `generated` as though generation failure can be represented by a falsy return.

Unless `generateLevel()` is changed, there is no such failure signal.

### Required behavior

A level-generation request should distinguish:

```text
requestedSteps
appliedSteps
```

and the batch generator should decide whether incomplete generation is acceptable.

For quality-controlled generation, the safer rule is:

```ts
if (generated.appliedSteps !== steps) {
    discard
}
```

Otherwise a requested 22-step generation can become a 5-step level while still being accepted.

If partial walks are intentionally allowed, the spec should say so and scoring should use `appliedSteps` only as diagnostic information, not as an assumed target.

---

# P1 — Seed geometry/spec inconsistencies

## 6. The “2-cell buffer between slots” claim is incorrect

The spec says:

> “2 cells of buffer floor separate it from every board edge and from every other slot's slot boundary.” fileciteturn1file0L24-L29

But the actual geometry is:

```text
ROOT_SIZE = 12

slot 0: x = 1..5
slot 1: x = 6..10
```

So the slots are adjacent:

```text
... 4 5 | 6 7 ...
```

There is no two-cell gap between slot boundaries.

The **container centers** have a 5-cell separation, and the randomized wall cells remain inside their respective slots, so overlap can still be impossible. But that is a different claim.

### Required change

Replace the “2 cells of buffer between slots” explanation with the actual invariant:

> Each slot occupies a disjoint 5×5 coordinate range. The container is at local `(2,2)`, so its four possible wall cells are also inside the same slot. Therefore the group geometry cannot overlap another slot.

This is simpler and exactly matches the code.

---

## 7. Player placement needs a stronger invariant

The player is always placed at:

```ts
{ board: 'root', x: 2, y: 2 }
```

This is safe from the first group's possible wall cells, but the spec should prove the stronger property that it cannot collide with any generated group geometry.

For group 0:

```text
container = (3,3)
possible wall = (2,3), (4,3), (3,2), (3,4)
player = (2,2)
```

So group 0 is safe.

Groups 1–3 are farther away.

### Required change

Turn this into an executable seed invariant rather than relying only on prose.

For example:

```ts
expect(occupantAt(world, playerPosition)).toBe(PLAYER_ID)
```

and assert that no wall/container/other piece occupies the player coordinate.

---

## 8. “Independent groups” needs a formal definition

The spec repeatedly calls the groups “independent” and “self-contained.” fileciteturn1file0L11-L14

But the reverse walk operates on the whole `World`, so pieces can potentially interact across groups if a valid push chain reaches them.

The current slot geometry prevents initial overlap, but it does not necessarily prove behavioral independence after arbitrary reverse moves.

### Required change

Define “independent” narrowly:

> Independent at seed construction means each group has its own container, interior board, box, and requirement cell, and the seed contains no overlapping geometry or shared board ownership.

Do **not** claim behavioral independence unless it is tested.

---

# P1 — Pruning semantics need redesign

## 9. “Untouched group” should be provenance-based, not state-based

The strongest implementation model is:

```ts
interface SeedGroup {
  containerId: string
  interiorId: string
  requirementPosition: {
    board: string
    x: number
    y: number
  }
}
```

Then generation records:

```ts
touchedGroups: Set<string>
```

The pruning operation becomes conceptually:

```ts
for (const group of groups) {
    if (!touchedGroups.has(group.containerId)) {
        removeGroup(...)
    }
}
```

This correctly handles:

- `inversePush`
- `inverseEnter`
- `inverseEat`
- move then move back
- player entering a container without moving it
- future inverse patterns

without needing to infer history from the final `World`.

---

## 10. `SeedGroup` should probably carry `interiorId`

The current spec says only:

```ts
interface SeedGroup {
  containerId: string
  originalPosition: { x: number, y: number }
}
```

and relies on:

```ts
container.boardRef
```

to find the interior. fileciteturn1file0L53-L60

That works with the current immutable piece schema, but the purpose of `SeedGroup` is to describe the seed-time identity of the group.

Including:

```ts
interiorId
```

makes the group definition explicit and allows stronger tests:

```ts
expect(world.boards[group.interiorId]).toBeDefined()
```

It also avoids coupling pruning to the assumption that `boardRef` can never change.

This is not strictly necessary if the engine guarantees `boardRef` immutability, so it is P1 rather than P0.

---

# P1 — Difficulty expectations are too optimistic

## 11. `6–8` crossing events are not guaranteed

The spec says the ceiling may rise to:

```text
6–8
```

because there are 3–4 groups and “up to 2 events × 3–4 groups.” fileciteturn1file0L219-L223

This is not established by the current implementation.

There are several constraints:

- the reverse walk may not successfully touch every group;
- the groups may not all be reachable by the available inverse patterns;
- groups may interact;
- a group can be touched without producing two board crossings;
- solver-optimal solutions may omit some generated history;
- pruning changes the world after generation.

### Required change

Treat `6–8` only as a hypothesis.

The implementation plan should measure:

```text
distribution of:
- appliedSteps
- touchedGroupCount
- optimalMoveCount
- crossingMoveCount
- difficulty score
- tier
```

over a large deterministic sample.

Do not use the theoretical `2 × groupCount` calculation as an expected production ceiling.

---

## 12. `crossingMoveCount >= 2` is too weak as a diversity metric

The diagnostic currently proposes checking that at least some levels have:

```text
crossingMoveCount >= 2
```

That would still allow the generator to produce many levels with almost identical structure.

### Recommended diagnostics

Measure at least:

```text
touchedGroupCount
crossingMoveCount
solutionLength
difficultyScore
solution event sequence
```

and report histograms or frequency tables.

The key question is not merely:

> “Did some generated level use the container mechanic?”

but:

> “Are the generated levels materially diverse in how many and which goal groups participate in the optimal solution?”

---

# P1 — Testing gaps

## 13. Add an explicit `inverseEnter` pruning regression test

The current pruning tests focus on:

> group A unchanged, group B moved

but do not test the exact failure mode introduced by the design. fileciteturn1file0L225-L230

Add:

```text
group A container stays at seed coordinate
player is inside group A's interior
prune must NOT remove group A
```

This should be a mandatory regression test.

---

## 14. Add “touched then returned” test

Construct a generation history equivalent to:

```text
seed
→ group A moved
→ group A restored
```

Then verify:

```text
group A is still marked touched
```

This directly proves that the implementation is tracking history rather than final position.

---

## 15. Add player-preservation invariant

After every pruning operation:

```ts
expect(world.pieces[PLAYER_ID]).toBeDefined()
expect(world.locations[PLAYER_ID]).toBeDefined()
```

More generally, `parseLevel()` should be treated as a structural validator, not the only validator.

---

## 16. `parseLevel()` should not be the only post-prune assertion

The current plan says the pruned result should pass `parseLevel()` validation. fileciteturn1file0L228-L229

That is useful, but insufficient.

Also verify:

```text
- player still exists
- every remaining piece has a valid location
- every referenced board exists
- every deleted interior is no longer referenced
- every remaining requirement has the intended semantics
- no remaining piece references a removed group
```

---

## 17. Test all 4 wall directions and both interior sizes

The seed uses:

```ts
DIRECTIONS = ['up', 'down', 'left', 'right']
INTERIOR_SIZES = [3, 5]
```

but the tests should deliberately cover all eight combinations rather than relying on random RNG draws.

Use deterministic RNG values or a dependency-injected sequence.

This is particularly important because the spec itself relies on hand verification of `getEntryCell()` for both sizes. fileciteturn1file0L124-L127

---

# P2 — Recommended improvements

## 18. Replace hand-maintained geometry constants with helper functions

The current seed logic directly computes:

```ts
slotOriginX
slotOriginY
center
containerX
containerY
```

A helper such as:

```ts
getSlotOrigin(index)
getSlotCenter(index)
```

would make the geometry invariant easier to test and reduce arithmetic duplication.

Not required for correctness, but worthwhile.

---

## 19. Avoid asserting that `getEntryCell()` behavior is “straightforward affine scaling”

The spec argues that size 5 follows the size 3 behavior by straightforward scaling. fileciteturn1file0L127-L127

For implementation correctness, the better approach is simply:

```ts
const entry = getEntryCell(...)
if (!entry.cell) throw ...
```

followed by deterministic unit tests for sizes 3 and 5.

The generator should trust the actual engine helper rather than rely on a mathematical description of its internals.

---

## 20. Make RNG deterministic in tests

The production function already accepts:

```ts
rng: () => number
```

which is good.

Use this deliberately in tests:

```ts
const rng = sequence([
  0.0,
  ...
])
```

and test boundary values near:

```text
0
just below 0.5
just below 1
```

for group count and direction selection.

This gives reproducible coverage.

---

# Proposed revised architecture

The most important structural change I recommend is:

```text
createSeedWorld(rng)
        ↓
SeedResult
  ├── world
  └── groups
        ↓
generateLevel(seed, steps, rng)
        ↓
GenerationResult
  ├── world
  ├── appliedSteps
  └── touchedGroups
        ↓
pruneUntouchedGoals(result.world, groups, result.touchedGroups)
        ↓
checkWin
        ↓
canonical duplicate check
        ↓
solve
        ↓
countCrossingMoves
        ↓
scoreDifficulty
        ↓
tier
```

The critical distinction is:

```text
SeedGroup = static identity of a goal group
touchedGroups = historical fact recorded during generation
```

Do not try to infer the second from the first after generation.

---

# Suggested interfaces

```ts
export interface SeedGroup {
  containerId: string
  interiorId: string
  originalPosition: {
    x: number
    y: number
  }
}

export interface SeedResult {
  world: World
  groups: SeedGroup[]
}

export interface GenerationResult {
  world: World
  appliedSteps: number
  touchedGroups: Set<string>
}
```

Then:

```ts
export function generateLevel(
  seed: World,
  groups: SeedGroup[],
  steps: number,
  rng: () => number,
): GenerationResult
```

If passing `groups` into the low-level generator is undesirable, the generator can instead infer group ownership from the initial seed and return a generic set of affected piece IDs. The important requirement is that the information be captured during generation.

---

# Suggested pruning contract

Prefer:

```ts
export function pruneUntouchedGoals(
  world: World,
  groups: SeedGroup[],
  touchedGroups: ReadonlySet<string>,
): World
```

rather than:

```ts
pruneUntouchedGoals(world, groups)
```

Then the function has no ambiguous definition of “untouched.”

Pseudo-logic:

```ts
for (const group of groups) {
  if (touchedGroups.has(group.containerId)) {
    continue
  }

  removeGroup(...)
}
```

Before removing:

```ts
assert(player is not inside the group's interior)
```

If this assertion ever fires, that indicates a generator bookkeeping bug and the level should be discarded rather than silently corrupting the world.

---

# Revised testing matrix

## Seed

Test:

- group count = 3
- group count = 4
- all 4 wall directions
- interior size = 3
- interior size = 5
- all group IDs unique
- all interior board IDs unique
- all requirement cells exist
- all containers are on root
- all boxes are in their own interiors
- no initial coordinate overlap
- player exists and is not overlapping any group geometry
- `checkWin(seed) === true`
- serialize → parse succeeds

## Generation

Test:

- `steps = 0` produces an unchanged world
- successful generation reports `appliedSteps`
- incomplete generation is distinguishable from complete generation
- touched group is recorded for `inversePush`
- touched group is recorded for `inverseEnter`
- touched group is recorded for `inverseEat`
- touched group remains touched after moving away and returning

## Pruning

Test:

- untouched group is removed
- touched group is preserved
- entered-but-not-moved container is preserved
- moved-then-returned container is preserved
- player inside a group prevents that group from being pruned
- player always survives pruning
- its interior board is removed only when the group is removed
- its interior contents are removed only when the group is removed
- requirement cell is cleared only when the group is removed
- resulting world passes `parseLevel()`

## Batch

Test:

- target quota is actually satisfied
- incomplete quota is reported as failure
- generated levels are unsolved
- generated levels parse
- no duplicate canonical states
- discard statistics sum correctly
- distribution of touched groups is measurable

---

# Revised acceptance criteria

The sub-project should not be considered complete merely because the new code compiles.

Require all of the following:

1. **No group is pruned merely because its container happens to finish at its seed coordinate.**
2. `inverseEnter` cannot cause a used group to be pruned.
3. A player can never be deleted by pruning.
4. Generation reports whether it actually achieved the requested step count.
5. Deterministic tests cover all wall directions and both interior sizes.
6. A deterministic sampling run demonstrates that the new seed materially increases multi-group/container-mechanic usage.
7. The sampling report includes at least:
   - successful generation rate
   - touched-group distribution
   - optimal solution length distribution
   - crossing-move distribution
   - difficulty-tier distribution
8. The hard-tier reachability claim is based on measured output, not the theoretical maximum.
9. The generated JSON is parsed/validated before being committed as builtin content.

---

# Implementation priority

| Priority | Change | Reason |
|---|---|---|
| **P0** | Replace final-position pruning with generation-time touch tracking | Current pruning can delete genuinely used goals |
| **P0** | Prevent pruning from deleting `PLAYER_ID` | Can corrupt `World` |
| **P0** | Resolve `generateLevel()` return-type contradiction | Current `generated.world` conflicts with the stated unchanged generator |
| **P0** | Explicitly handle incomplete reverse walks | Requested steps must not silently become fewer steps |
| **P1** | Correct the fixed-grid geometry explanation | Current “2-cell buffer” claim is false |
| **P1** | Add inverseEnter and move-then-return pruning regressions | Covers the two main semantic failures |
| **P1** | Expand deterministic seed tests | Random tests can miss direction/size edge cases |
| **P1** | Add generation-quality diagnostics | Needed to verify the claimed diversity improvement |
| **P2** | Refactor slot geometry helpers | Maintainability |
| **P2** | Expand SeedGroup metadata | Makes ownership explicit |
| **P2** | Improve post-prune structural assertions | Defense in depth |

---

# Bottom line

**Keep the multi-goal seed redesign. Change the pruning mechanism.**

The 3–4 goal groups, 12×12 root board, randomized wall side, and 3×5 interior sizes are reasonable directions. The critical conceptual mistake is treating:

```text
container final position == seed position
```

as equivalent to:

```text
group was never used
```

Those are not equivalent because the player can enter a container without moving its container piece, and because a group can move and later return to its original position.

The robust rule is:

```text
generation history → touchedGroups → pruning
```

rather than:

```text
final World → infer touchedGroups
```

Once that is fixed, the rest of the proposal becomes substantially safer to implement.
