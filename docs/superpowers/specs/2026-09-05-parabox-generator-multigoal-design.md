# Parabox PWA — Multi-Goal Seed & Level Pruning (Sub-project 4b)

> Revision note: this spec was reviewed
> (`2026-09-05-parabox-generator-multigoal-review.md`) before implementation
> began. The review's central finding — that "container ended up back at its
> original position" does **not** imply "this goal group was never used" —
> is correct in principle, and provenance-based touch tracking (recorded
> *during* the reverse walk, not inferred from the final `World`) is still
> this spec's design. However, while implementing that fix, direct
> measurement against the shipped code (see "What's actually reachable
> today" below) found the review's specific counter-example — `inverseEnter`
> moving the player into an interior without moving the container, then
> pruning deleting the player — **cannot currently occur**: `inverseEnter`'s
> own precondition requires the player to already be on an interior board,
> which never happens starting from a root-seeded walk, confirmed by
> sampling 442 real walks (4067 accepted events) against the shipped seed —
> `enter` fired zero times, and the player's board was `root` at the end of
> every single one. The design keeps provenance tracking anyway (it's more
> robust than position-inference for the `push`/`eat` "moved then returned"
> case, and doesn't rely on an implicit, undocumented invariant to stay
> safe), but drops the `playerBoard` field the first revision added
> specifically for the `enter` case, since it can never contribute given
> what's actually reachable — see below for why keeping it would be
> carrying dead complexity, not extra safety. Two of the review's other
> findings (the claim that `generateLevel.ts` currently returns a bare
> `World`, and that requested steps can silently become fewer) turned out
> to rest on a stale premise — the shipped code already returns
> `GenerationResult | null` and already refuses to return a partial result
> (`if (events.length < steps) return null`) — confirmed by re-reading the
> actual file, not assumed. Everything else the review raised is addressed
> inline. The review document is superseded by this revision.

## Background

Sub-project 4 (solver + level generator rewrite) shipped and merged. Its final review flagged an open, un-fixed limitation: the 10 committed generated levels are near-identical variants of one puzzle, and 7 of 10 never require the container mechanic at all (their optimal solve never crosses a board boundary) — the seed's single win-condition site and lone filler box meant most of what got scrambled was decorative. Separately, the `hard` difficulty tier was found empirically unreachable (score ceiling ~23, threshold 25) because the seed only ever offered up to 2 board-crossing events total.

## Scope

**In scope:**
- `tools/generator/seed.ts`: rewritten to seed 3 or 4 independent, self-contained goal groups (container + its own pre-placed box + its own win-condition cell) on a bigger board, each group's container given a randomized wall-adjacent side (for `enter`/`eat` reachability) and a randomized interior board size (3 or 5), placed in a fixed, non-overlapping slot grid.
- `tools/generator/generateLevel.ts`: **this does need a small change**, corrected from the first draft's claim that it wouldn't. Each `GenerationEvent` gains one field (`affectedPieceIds`) recording, at the moment the event is accepted, which pieces actually moved. This is what lets pruning tell "moved and came back" apart from "never moved" — inferring "used" from the *final* `World` alone cannot distinguish those two (see "Why position-based pruning is replaced" below). `generateLevel`'s own signature, its null-on-incomplete-walk behavior, and its cycle-avoidance logic are all unchanged.
- A new `tools/generator/pruneUntouchedGoals.ts`: computes which groups were actually touched from the event history (`computeTouchedGroups`), then removes every group that wasn't (`pruneUntouchedGoals`) — container piece, its interior board, whatever's inside it, and its win-condition cell.
- `tools/generator/generateBatch.ts`: wire the new seed shape and the new touch-computation/prune steps into the pipeline, ahead of the existing `checkWin`/duplicate/solve/score checks (which need no logic changes — they already operate correctly on "whatever `World` they're handed").
- `tools/generator/seed.test.ts`, `tools/generator/generateLevel.test.ts` (one call-site fix — see Migration note), a new `pruneUntouchedGoals.test.ts`, and `generateBatch.test.ts`: updated/added for the new shapes.

**Explicitly out of scope:**
- Any change to `src/game/engine/*` — already supports everything this needs (arbitrary board sizes, multiple simultaneous requirement cells) and is unrelated to this sub-project.
- Any change to `inverseMoves.ts`, `solver.ts`, `canonical.ts`, `difficultyScorer.ts` — all four already operate generically over an arbitrary `World` and don't need to know how many goal groups exist or which were touched.
- Free-form/randomized placement of goal groups (collision detection, retry loops). See "Why a fixed slot grid" below.
- Randomizing the *number* of grid rows/columns, or the overall board size beyond what's needed for 3–4 groups.
- Re-tuning `difficultyScorer.ts`'s tier thresholds. More groups mean more *possible* crossing events, which may make `hard` reachable as a side effect — that must be measured, not assumed (see "Expected effects," which is deliberately non-committal about exact numbers).
- Symmetry/near-duplicate detection beyond the existing exact-`canonicalKey` check. Not this sub-project's problem.

## Why position-based pruning is replaced, and what's actually reachable today

The first draft of this spec defined "untouched" as "the container is still at its seed-time coordinates," and removed the whole group when that held. The review pointed out that `inverseEnter`'s only mutation is `candidate.locations[PLAYER_ID] = {...}` — it never touches the container's or the box's location — so a walk that used `inverseEnter` to put the player inside a group's interior would leave that group's container exactly where it started, while the group is very much in use, and pruning would then delete the player along with the "unused" interior.

**Verifying this before building around it turned up something the review didn't check: `inverseEnter` cannot actually fire during `generateLevel`'s walk at all.** Its precondition (`tools/generator/inverseMoves.ts`) is `findContainerFor(world, loc.board)` — the player's *current* board must already be owned by some container. The player starts every walk on `root`, which is never owned by anything (by construction — see `seed.ts`'s reachability rules). None of the three reverse functions ever move the player onto a different board except `inverseEnter` itself, whose own output moves the player *off* an interior onto its parent — so nothing can ever put the player onto an interior in the first place, and `inverseEnter`'s precondition can never become true starting from a root-seeded walk. This was confirmed empirically, not just reasoned about: sampling 442 real walks (4,067 total accepted events) against the currently-shipped 2-group seed gave `push: 3959, enter: 0, eat: 108` — `enter` fired zero times across the whole sample, and the player's final board was `root` in every single run. The review's specific deletion scenario is therefore not reachable with the code as it exists today.

That does **not** mean pruning by final position is fine, for a subtler reason the review also raised: a container that got pushed away by `inversePush` or repositioned by `inverseEat` and then pushed back to its exact starting cell would read as "unchanged" by a position check, despite genuinely having been part of the walk's history. The final `World` alone does not carry enough information to answer "was this ever touched" — only the history does. This case *is* reachable (both `push` and `eat` are real, measured mechanics), so provenance tracking is kept for this reason, not for the `enter` scenario.

**The fix:** `generateLevel` now records, per accepted event, which piece IDs actually moved (`affectedPieceIds`, computed by diffing every piece's location before and after the event). A group counts as touched if its container ID or its box ID ever appears in some event's `affectedPieceIds`. This is deliberately **not** the "player's resulting board" tracking a first pass at this design (and the external review) proposed for the `enter` case — given `enter` cannot fire, that field would never be populated with anything but `'root'` and would be dead weight, not a safety net. If a future sub-project ever makes `inverseEnter` reachable from a walk (by changing how seeds or the other two functions work), this is exactly the kind of change that would need `computeTouchedGroups` revisited — flagged here rather than silently assumed away.

The `boxId` check in `computeTouchedGroups` is currently redundant with the `containerId` check — the only way a box's board ever changes is via `inverseEat`, which always relocates the container in the same event, so `containerId` alone would already catch it. It's kept anyway as a cheap, explicit statement of what a "group" consists of, in case a future change to `inverseMoves.ts` ever decouples them; removing it would save nothing and lose that legibility.

**On the "moved then returned" case:** because the touched-set is accumulated across the *entire* event history, a group that was ever moved stays marked touched even if it happens to end up back where it started. A measured, not-actually-rare fraction of accepted levels may therefore keep a group whose requirement is, by coincidence, already satisfied at the end — post-implementation measurement found roughly 28% of walks with at least one surviving group (153 of 552 sampled) still came out fully pre-solved overall, correctly discarded by `generateBatch.ts`'s existing `checkWin` check either way, so this affects generation efficiency, not correctness. This is called out explicitly in the testing strategy below rather than hidden.

**The defensive check in `removeGroup`** (below) that refuses to delete the player is kept even though it's currently unreachable given the above — it costs one comparison and turns any future violation of "the player never leaves root" into a loud, immediate failure instead of silent `World` corruption. Keeping a cheap, currently-inert safety net is not the same thing as keeping dead complexity that actively misleads a reader (which is why `playerBoard` was cut and this was not).

## Why a fixed slot grid, not free-form placement

Sub-project 4's own history is the argument here: hand-derived geometry for even a *single* wall-adjacent container needed two separate correction rounds after integration testing (a player start position one cell from a border, and an `inversePush` bug that only manifested near walls) despite careful hand-tracing at each step. Free-form random placement of 3–4 independent groups — checking each new candidate position against every previously placed group, retrying on collision — multiplies that class of risk considerably for a benefit (more organic-looking layouts) that doesn't matter to the actual goal (more solving variety).

Instead, the root board is divided into a fixed 2×2 grid of non-overlapping 5×5 slots (using 3 of the 4 slots when `groupCount` is 3). **The precise invariant, corrected from the first draft's inaccurate "2-cell buffer between slots" claim:** slots are directly adjacent with no gap at all (slot 0 spans absolute x-coordinates 1–5, slot 1 spans 6–10) — the guarantee against overlap comes entirely from placing each slot's container at its exact center (local offset `(2,2)` in a 5-wide slot), which means all four of that container's possible wall-cell offsets (`(1,2)`, `(3,2)`, `(2,1)`, `(2,3)` in local coordinates) stay strictly inside `[0,4]×[0,4]` — i.e. inside that same slot — no matter which direction is randomly chosen. Two slots being edge-adjacent is irrelevant to correctness because neither slot's content ever reaches its own boundary. Wall side and interior size are still randomized per group for real variety; only the *positions* are fixed.

## `seed.ts` — multi-goal seed

```ts
import {
  Cell, Direction, PLAYER_ID, World,
  step, opposite,
} from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'

// A 2x2 grid of slots (square, so GRID_COLS alone determines ROOT_SIZE —
// groupCount is always 3 or 4, and ceil(3/GRID_COLS) === ceil(4/GRID_COLS)
// === 2 rows for GRID_COLS=2, so the board never needs to vary in size).
const GRID_COLS = 2
const SLOT_SIZE = 5
const ROOT_SIZE = 2 + GRID_COLS * SLOT_SIZE // = 12
const INTERIOR_SIZES = [3, 5]
const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function makeFloorCells(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const })))
}

// A group's identity as constructed by the seed. `boxId` is needed
// (not just `containerId`) so computeTouchedGroups can recognize the group
// as touched via either piece — see pruneUntouchedGoals.ts. `interiorId` is
// needed so removeGroup knows which board (and everything located on it)
// to delete when a group turns out to be untouched.
export interface SeedGroup {
  containerId: string
  boxId: string
  interiorId: string
  originalPosition: { x: number; y: number }
}

export interface SeedResult {
  world: World
  groups: SeedGroup[]
}

export function createSeedWorld(rng: () => number = Math.random): SeedResult {
  const groupCount = 3 + Math.floor(rng() * 2) // 3 or 4

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
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS
    const slotOriginX = 1 + col * SLOT_SIZE
    const slotOriginY = 1 + row * SLOT_SIZE
    const center = Math.floor(SLOT_SIZE / 2) // = 2
    const containerX = slotOriginX + center
    const containerY = slotOriginY + center

    const wallDir = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]
    const wallPos = step(containerX, containerY, wallDir)
    cells[wallPos.y][wallPos.x] = { type: 'wall' }
    cells[containerY][containerX] = { type: 'floor', requirement: 'box' }

    const interiorSize = INTERIOR_SIZES[Math.floor(rng() * INTERIOR_SIZES.length)]
    const interiorId = `goal${i}Inside`
    const containerId = `goal${i}`
    const boxId = `box${i}`

    boards[interiorId] = { id: interiorId, size: interiorSize, cells: makeFloorCells(interiorSize) }
    pieces[containerId] = { id: containerId, kind: 'container', boardRef: interiorId }
    pieces[boxId] = { id: boxId, kind: 'normal' }
    locations[containerId] = { board: 'root', x: containerX, y: containerY }

    const { cell: eatenCell } = getEntryCell(boards[interiorId], opposite(wallDir), HALF)
    if (eatenCell === null) {
      // Provably unreachable: HALF always maps to an in-bounds
      // center-of-edge cell for any board size >= 1 (verified for size 3
      // in sub-project 4's Tasks 4-5, and by the same reasoning for size 5
      // here — see the hand-check below). A loud failure here is a
      // construction-time bug, not a runtime condition to swallow.
      throw new Error(`createSeedWorld: getEntryCell unexpectedly returned null for interior size ${interiorSize}`)
    }
    locations[boxId] = { board: interiorId, x: eatenCell.x, y: eatenCell.y }

    groups.push({ containerId, boxId, interiorId, originalPosition: { x: containerX, y: containerY } })
  }

  boards.root = { id: 'root', size: ROOT_SIZE, cells }
  // Slot (0,0)'s container sits at (1+2, 1+2) = (3,3); the player goes at
  // (2,2) — 2 cells from every board edge (the safe minimum this project
  // learned the hard way) and off the diagonal from the container, so it
  // never coincides with that group's wall regardless of which of the 4
  // directions was randomly chosen for it.
  locations[PLAYER_ID] = { board: 'root', x: 2, y: 2 }

  return { world: { boards, pieces, locations }, groups }
}
```

Hand-verified before writing this code (same practice as sub-project 4's own spec):
- **All 4 slot positions stay clear of the outer border regardless of grid position.** Slot origins are `(1,1)`, `(6,1)`, `(1,6)`, `(6,6)`; every slot's center container is therefore at least 3 cells from the border on every axis.
- **A center-of-slot container's wall never leaves its own slot** (see "Why a fixed slot grid" above for the exact local-coordinate argument).
- **`getEntryCell` at size 5 behaves the same way as the already-verified size-3 case.** For `HALF = 1/2` and `unit = 1/5`: `fractionDivMod` gives `offset = 2`, `remainder = 1/10` (nonzero) — e.g. for `dir = 'right'`, `cell = { x: 0, y: offset } = (0, 2)`; for `'left'`, `(4, 2)`; for `'up'`, `(2, 4)`; for `'down'`, `(2, 0)`. All four are in-bounds, non-degenerate center-of-edge cells. This reasoning is retained as *context* for why the code is expected to work, not as a substitute for the null-check above or for deterministic tests covering both sizes (see Testing strategy) — trust the engine's actual behavior, not a description of it.
- **Player placement does not collide with group 0's geometry.** Container at `(3,3)`, its four possible wall cells at `(2,3)`, `(4,3)`, `(3,2)`, `(3,4)`, player at `(2,2)` — none coincide. Groups 1–3 are strictly farther from the player. The implementation plan must turn this into an executable test across *all* groups and the player (see below), not rely on this hand-argument alone.
- **The old `box2`-style plain filler piece is gone.** With 3–4 independent, genuinely load-bearing goal groups, a decorative extra piece is no longer needed for push-chain variety.

**On "independent" groups:** this word is used narrowly here to mean *independent at seed construction* — each group has its own container, interior board, box, and requirement cell, and the seed contains no overlapping geometry or shared board ownership. It is not a claim that groups remain behaviorally independent after arbitrary reverse-walk moves (e.g. a long push chain could in principle span from one slot into another if their pieces end up aligned) — nothing in this design depends on that stronger claim, and it is not tested or asserted.

## `generateLevel.ts` — event provenance (the one change outside `seed.ts`/`generateBatch.ts`)

Add to the existing `GenerationEvent` interface:

```ts
export interface GenerationEvent {
  kind: GenerationEventKind
  direction: Direction
  affectedPieceIds: string[]
}
```

Add a helper and use it where an event is accepted (no new imports needed — this uses only `World`, already imported):

```ts
function affectedPieceIds(before: World, after: World): string[] {
  const ids: string[] = []
  for (const pieceId of Object.keys(before.locations)) {
    const a = before.locations[pieceId]
    const b = after.locations[pieceId]
    if (a.board !== b.board || a.x !== b.x || a.y !== b.y) ids.push(pieceId)
  }
  return ids
}
```

In the main loop, where the current code does `world = accepted.world; seen.add(...); events.push({ kind: accepted.kind, direction })`, change the last line to:

```ts
    const affected = affectedPieceIds(world, accepted.world)
    world = accepted.world
    seen.add(canonicalKey(world))
    events.push({ kind: accepted.kind, direction, affectedPieceIds: affected })
```

Nothing else in this file changes: the function's signature, its `null`-on-incomplete-walk return, and its cycle-avoidance logic via `canonicalKey` are exactly as sub-project 4 shipped them. No new imports are needed (see "What's actually reachable today" above for why this doesn't need a `playerBoard` field or a `PLAYER_ID` import).

**Why this doesn't need `generateLevel` to know about "groups" at all:** `affectedPieceIds` is a raw, group-agnostic fact about what moved. `computeTouchedGroups` (below) is what maps that onto the seed's specific group identities — that mapping lives in `pruneUntouchedGoals.ts`, which already imports from `seed.ts`, rather than making `generateLevel.ts` depend on `seed.ts`'s `SeedGroup` type. This keeps `generateLevel.ts` reusable independent of any particular seed shape, matching its existing design.

## `pruneUntouchedGoals.ts` — provenance-driven removal

```ts
import { World, cloneWorld, PLAYER_ID } from '../../src/game/engine/types'
import { SeedGroup } from './seed'
import { GenerationEvent } from './generateLevel'

export function computeTouchedGroups(events: GenerationEvent[], groups: SeedGroup[]): Set<string> {
  const touchedPieceIds = new Set<string>()
  for (const event of events) {
    for (const id of event.affectedPieceIds) touchedPieceIds.add(id)
  }

  const touched = new Set<string>()
  for (const group of groups) {
    if (touchedPieceIds.has(group.containerId) || touchedPieceIds.has(group.boxId)) {
      touched.add(group.containerId)
    }
  }
  return touched
}

function removeGroup(world: World, group: SeedGroup): World {
  const next = cloneWorld(world)

  for (const [pieceId, loc] of Object.entries(next.locations)) {
    if (loc.board !== group.interiorId) continue
    if (pieceId === PLAYER_ID) {
      // Provably unreachable today: the player's board never leaves
      // 'root' for the whole reverse walk (see "Why position-based
      // pruning is replaced" above — none of the three reverse functions
      // can put the player on an interior board starting from a
      // root-seeded walk), so this branch should never execute in
      // practice. Kept as a loud failure rather than removed, so that if
      // a future change to inverseMoves.ts/generateLevel.ts ever breaks
      // that invariant, it surfaces immediately instead of silently
      // corrupting the World.
      throw new Error(
        `pruneUntouchedGoals: refusing to remove group ${group.containerId} — ` +
          'the player is inside its interior. This indicates computeTouchedGroups ' +
          'failed to mark this group as touched.',
      )
    }
    delete next.pieces[pieceId]
    delete next.locations[pieceId]
  }
  delete next.boards[group.interiorId]

  const containerLoc = next.locations[group.containerId]
  const board = next.boards[containerLoc.board]
  board.cells[containerLoc.y][containerLoc.x] = { type: board.cells[containerLoc.y][containerLoc.x].type }
  delete next.pieces[group.containerId]
  delete next.locations[group.containerId]

  return next
}

// A group not present in `touchedGroups` was never used by the reverse
// walk by any of the three mechanics (see computeTouchedGroups) — its own
// win-condition cell is still satisfied and it would only ship as
// decoration. Every remaining (touched) group's requirement is, by
// construction, currently unsatisfied, so checkWin() on the result is
// false unless every group got pruned — which is exactly the
// already-handled "level came out pre-solved" case generateBatch.ts
// already discards. No changes needed to checkWin, solve,
// countCrossingMoves, or scoreDifficulty — all four already operate on
// "whatever World they're handed."
export function pruneUntouchedGoals(world: World, groups: SeedGroup[], touchedGroups: ReadonlySet<string>): World {
  let next = world
  for (const group of groups) {
    if (touchedGroups.has(group.containerId)) continue
    next = removeGroup(next, group)
  }
  return next
}
```

## `generateBatch.ts` — wiring

```ts
import { createSeedWorld } from './seed'
import { computeTouchedGroups, pruneUntouchedGoals } from './pruneUntouchedGoals'
// ...(other imports unchanged)

// inside generateLevelBatch's loop, replacing the old seed/generate block:
    const { world: seed, groups } = createSeedWorld(rng)
    const steps = 3 + Math.floor(rng() * 20)
    const generated = generateLevel(seed, steps, rng)
    if (!generated) {
      stats.discardedGenerationFailed++
      continue
    }

    const touchedGroups = computeTouchedGroups(generated.events, groups)
    const world = pruneUntouchedGoals(generated.world, groups, touchedGroups)

    if (checkWin(world)) {
      stats.discardedAlreadySolved++
      continue
    }
    // ...(everything from here on is unchanged — canonicalKey dedup,
    // solve(), countCrossingMoves(), scoreDifficulty(), tier bucketing —
    // all of it already operates on `world` generically)
```

No other line in `generateLevelBatch` changes. `main()` is untouched.

## Expected effects on generation quality (measure, do not assume)

Per review, the first draft's "6–8" crossing-event ceiling claim was a theoretical `2 × groupCount` calculation, not something established by the actual seed/walk mechanics — there is no guarantee the reverse walk touches every group, that touching a group produces exactly 2 crossings, or that the solver's *optimal* path uses everything the walk touched. This spec makes no numeric promise. What the implementation plan must do instead, before treating this as done:

- Run a direct diagnostic sample (same style as sub-project 4's Task 11 diagnostic sweep) calling `createSeedWorld` → `generateLevel` → `computeTouchedGroups` → `pruneUntouchedGoals` → `solve` → `countCrossingMoves` → `scoreDifficulty` across a large number of `rng` draws, and report the **distribution**, not a single number, of: successful-generation rate, touched-group count, optimal move count, crossing-move count, difficulty score, and resulting tier.
- Judge success by whether the distribution shows *materially more* variety than sub-project 4's original 2-group seed (which produced exactly 2 distinct accepted levels, both trivial, before its own fixes — see that sub-project's ledger) — not by whether any specific target number (like "6-8" or "hard reachable") is hit.
- If `hard` becomes reachable as a byproduct, that's a welcome side effect to report, not a requirement this sub-project is judged against.

## Testing strategy

- **`seed.test.ts`** (rewritten): using deterministic `rng` sequences (not relying on random draws to happen to cover cases) covering both `groupCount` values (3 and 4) and all 4 wall directions × both interior sizes: `checkWin(createSeedWorld(rng).world)` is `true`; `parseLevel(serializeLevel(world))` doesn't throw; `groups.length` matches the produced `groupCount`; every group's container sits at `originalPosition` on `root` with a `requirement: 'box'` cell there; every group's box sits inside its own `interiorId` at the cell `getEntryCell` computes for the direction opposite its wall; **a single test collects every wall cell, container cell, and the player cell across a full seed and asserts all coordinates (scoped per-board) are mutually distinct** — this replaces hand-argument with an executable, general check rather than reasoning about group 0 alone.
- **`generateLevel.test.ts`** (one call-site fix plus new coverage): `createSeedWorld()` calls in this file change to `createSeedWorld().world` (this file doesn't need `groups`). New test: a hand-built `inversePush` step's event has `affectedPieceIds` containing both the player and a pushed piece, proving the diff correctly reports multi-piece movement, not just the player.
- **`pruneUntouchedGoals.test.ts`** (new): `computeTouchedGroups` marks a group touched when a hand-built event list's `affectedPieceIds` includes that group's `containerId`; marks it touched when `affectedPieceIds` includes only its `boxId` (the currently-redundant-in-practice but still-checked path — see "Why position-based pruning is replaced" above); a group absent from every event's `affectedPieceIds` is correctly left untouched and removed by `pruneUntouchedGoals`; a group that was moved and then, across later events, ended up back at its original position is still reported as touched (the "moved then returned" case this design is actually for — construct an event list where a group's `containerId` appears in one early event's `affectedPieceIds` and confirm `computeTouchedGroups` still includes it, independent of where the final `World` places that container); removing an untouched group deletes its container, its interior board, and everything located on that interior board, and clears the `requirement` from its cell; pruning a world where every group is untouched removes all of them and the result still passes `parseLevel`; **calling `pruneUntouchedGoals` with a `touchedGroups` set that (incorrectly, for the test) omits a group whose interior currently contains a non-container piece keyed as `PLAYER_ID` throws the documented error** — this exercises the defensive check directly via a hand-built world, since it cannot arise from a real `generateLevel` walk (see above), proving the safety net itself works without depending on it ever firing in production; a mixed case (2 of 3 groups touched) leaves exactly the touched groups' pieces/boards/requirement cells intact and removes exactly the untouched one's, checked structurally (piece/board/cell presence), not only via `parseLevel` passing.
- **`generateBatch.test.ts`** (updated call sites only): the four existing tests (`complete`/quota reporting, unsolved+parseable levels, no duplicate canonical states, stats accounting) hold unchanged in kind against the new pipeline.
- **Mandatory diagnostic pass before shipping generated output** (not a committed automated test — matches sub-project 4's own Task 11 precedent): the distribution sampling described in "Expected effects," run and read by whoever implements this before generating and committing the real `src/levels/builtin/generated/*.json` batch.

## Migration note

Files rewritten: `tools/generator/seed.ts` (signature change: `createSeedWorld` now takes an optional `rng` parameter and returns `SeedResult` instead of a bare `World`), `tools/generator/seed.test.ts`. Files modified (not rewritten): `tools/generator/generateLevel.ts` (only the `GenerationEvent` interface and the event-construction line inside the existing loop — signature, null-return behavior, and cycle avoidance untouched), `tools/generator/generateLevel.test.ts` (only its `createSeedWorld()` call sites, changed to `createSeedWorld().world`), `tools/generator/generateBatch.ts` (only its seed-creation and post-`generateLevel` lines, per the wiring section above). New file: `tools/generator/pruneUntouchedGoals.ts` and its test. `inverseMoves.ts`, `solver.ts`, `canonical.ts`, `difficultyScorer.ts`, and every file under `src/` are untouched by this sub-project.

The previously-committed `src/levels/builtin/generated/*.json` will be replaced wholesale the next time `npm run generate:levels` runs (per the existing overwrite policy) — this is expected, not a regression.
