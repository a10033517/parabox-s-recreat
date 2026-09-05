# Parabox Level Generator — Full Design & Approach A (Mechanic-Necessity Fix)

**Status:** Draft for review (sub-project 4c)
**Supersedes (partially):** `2026-09-05-parabox-generator-multigoal-design.md` (sub-project 4b) — that spec's seed/pruning design is described here as it exists today, with Approach A's changes layered on top. 4b's spec is not deleted; this document is the current source of truth for the generator going forward.

## 1. Purpose

This document does two things, per explicit request:

1. Describes the **entire level-generator pipeline** as it exists today (post sub-project 4b), file by file, so this spec is self-contained and doesn't require reading three prior specs to understand the system.
2. Specifies **Approach A**, the fix for finding (1) from 4b's final review: generated levels' optimal solutions almost never use the container enter/eat mechanic, because a goal's win-condition can be satisfied by the container itself sitting on its own cell — no interior box ever needs to be touched.

Finding (2) from 4b's review (player-start-position skew capping how many goal groups get touched, suspected to also suppress the 'hard' tier) is **out of scope** for this document. It's a separate, independently-fixable seed-geometry question. It's noted in §6 as a deferred follow-up, not folded into Approach A.

## 2. The generator pipeline, end to end

The generator is a offline Node/TypeScript tool (`tools/generator/*.ts`, run via `generateBatch.ts`'s `main()`) that produces playable, pre-solved-nothing levels by running the game's own move rules **backwards** from a hand-built seed, then filtering the result down to only what's actually necessary for a solve. It does not construct levels forward by placing pieces where a human designer thinks a puzzle should go — it starts from a "solved" arrangement and un-solves it by a random walk of inverse moves, verifying every step against the real forward engine.

Pipeline stages, in the order `generateBatch.ts` calls them:

1. **Seed** (`seed.ts`) — build a `World` that is already in a win state: several independent "goal groups," each a container with a box already eaten inside it.
2. **Reverse walk** (`generateLevel.ts`) — apply a random sequence of inverse moves (`inverseMoves.ts`) to that seed, producing a scrambled, unsolved `World`.
3. **Prune** (`pruneUntouchedGoals.ts`) — delete any goal group the reverse walk never touched, so the shipped level doesn't contain decorative, never-interacted-with containers.
4. **Validate & score** (`generateBatch.ts` + `solver.ts` + `difficultyScorer.ts`) — reject unsolved-already levels, reject duplicates, forward-solve via BFS (`solver.ts`), score the solution's difficulty, bucket into a tier, and only keep it if that tier still needs levels.
5. **Serialize** (`levelSchema.ts`, unchanged/out of scope) — write the accepted levels as JSON into `src/levels/builtin/generated/`.

### 2.1 Engine primitives this all rests on (unchanged, out of scope)

- `World = { boards, pieces, locations }` — a flat multi-board world. `Board { id, size, cells }`. `Piece { id, kind: 'player' | 'normal' | 'container', boardRef? }`. `Location { board, x, y }`.
- `Cell { type: 'floor' | 'wall', requirement?: 'player' | 'box' }` (`src/game/engine/types.ts`). A cell's `requirement` is what makes it a goal cell.
- `checkWin(world)` (`src/game/engine/rules.ts:154-169`) iterates **every board's every cell**, and for each cell carrying a `requirement`, finds whatever piece currently occupies that cell (via `occupantAt`) and checks it: `requirement === 'player'` fails unless the occupant is the player; `requirement === 'box'` fails **only if** the occupant is a player — meaning any non-player occupant (a plain box, *or a container*) satisfies a `'box'` requirement cell. Any unoccupied requirement cell fails the whole check. This scan is global and doesn't care which board a requirement cell lives on — a requirement cell on an interior board works exactly the same as one on `root`. This last point is what makes Approach A possible without touching this function at all.
- `getEntryCell(board, dir, relativeCoord)` (`rules.ts:30-`) — given a board, a direction, and a `Fraction` position along that edge, returns the cell on that edge (or `null` if the direction/offset doesn't map to an in-bounds cell). Used both to place a box at a container's "entry point" during seeding and to check what's being eaten/exited during inverse moves. `HALF = makeFraction(1,2)` is always used by the generator, meaning "the center of whichever edge is opposite the wall" — this always resolves to an in-bounds cell for any board size ≥ 1 (verified in sub-project 4).
- `applyMove(world, dir)` — the **forward** move engine (push/enter/eat resolution). This is the single source of truth the generator's inverse moves are checked against.
- `canonicalKey(world)` (`canonical.ts`) — a deterministic JSON serialization (keys sorted recursively) used as a hash for cycle detection (in the reverse walk) and visited-state dedup (in the forward BFS solver).

### 2.2 `seed.ts` — `createSeedWorld` (multi-goal seed, from 4b)

Builds a 12×12 walled `root` board laid out as a 2×2 grid of 5×5 "slots" (`GRID_COLS=2`, `SLOT_SIZE=5`, `ROOT_SIZE = 2 + GRID_COLS*SLOT_SIZE = 12`). Picks `groupCount = 3 + floor(rng()*2)` (3 or 4) and, for each group `i`:

- Computes the slot's center cell on `root` as the container's position.
- Picks a random wall direction (`up`/`down`/`left`/`right`) and places a `wall` cell immediately adjacent to the container in that direction — this is what will later force `inverseEat`/`inverseEnter` to fire instead of a plain push (push into a wall is blocked).
- Marks the container's root cell as a goal cell.
- Creates an interior board of a random size from `INTERIOR_SIZES = [3, 5]`, referenced by the container piece (`boardRef`).
- Places a box inside that interior, at the cell `getEntryCell(interior, opposite(wallDir), HALF)` returns — i.e., the cell the box would land on if extracted via `inverseEat` from the wall side.
- Records a `SeedGroup` describing this group's piece IDs and original state, used later by pruning.

The player is always placed at fixed `root` position `(2, 2)`.

**Approach A changes exactly one thing here: which cell carries the goal requirement.** See §4.1.

### 2.3 `generateLevel.ts` — the reverse walk

Takes a seed `World`, a target step count, and an `rng`. Repeatedly:

- Picks a random direction.
- Tries the three inverse-move functions (`inversePush`, `inverseEnter`, `inverseEat`, from `inverseMoves.ts`) in random order for that direction.
- Accepts the first one that returns a non-null result **and** whose resulting `canonicalKey` hasn't been seen yet this walk (cycle avoidance).
- Records a `GenerationEvent { kind, direction }` for each accepted step.
- Gives up (returns `null`, causing `generateBatch.ts` to discard the attempt) if it can't reach the target step count within `steps * 20` attempts.

4b added an `affectedPieceIds: string[]` field to `GenerationEvent`, computed by diffing every piece's location before/after each accepted event, so that pruning could determine which goal groups were "touched" by the walk without trusting final positions alone (see §2.4). **Approach A removes this field** — see §4.3.

### 2.4 `inverseMoves.ts` — the three inverse-move functions (unchanged, out of scope)

Each function takes `(world, direction)` and returns either a new `World` (the valid predecessor state) or `null` (this move can't have produced the current state). All three end by calling `verifyPredecessor`, which re-applies the **forward** engine (`applyMove`) to the candidate and checks the result's `canonicalKey` matches the original `world` — i.e., every inverse move is only ever accepted if the real forward rules agree it undoes to exactly this state. This is the "forward engine is the source of truth" principle from sub-project 4, and it still governs all move generation.

- **`inversePush(world, dir)`** — undoes a plain push: moves the player one step backward (opposite `dir`) and shifts a contiguous chain of pushed pieces back one step each, provided the player's "behind" cell and (if a chain exists) the cell past the chain are open floor with no occupant. Never crosses board boundaries — everything stays on `loc.board`.
- **`inverseEnter(world, dir)`** — undoes a player walking into a container from outside. Requires `findContainerFor(world, loc.board)` to return a container whose `boardRef` is the player's *current* board (i.e., the player must currently be standing inside some container's interior) and requires the player's position to be exactly the entry cell for `dir`. If satisfied, moves the player back outside the container, to the cell immediately behind the container on its parent board.
  - **Confirmed unreachable from a root-seeded walk** (established empirically in 4b via a throwaway diagnostic script sampling 1000+ real walks, thousands of accepted events, `enter: 0` every time): the player starts on `root`, which is owned by no container, and none of the three inverse functions ever *place* the player onto a non-root board — `inverseEnter`'s own effect only ever moves the player *off* an interior board. So its precondition (`player is currently on some container's interior`) can never become true starting from this seed. This fact is unchanged by Approach A (Approach A doesn't touch player placement or `inverseEnter` at all) and remains the justification for why `computeTouchedGroups`/pruning never needs to reason about "enter" events specially.
- **`inverseEat(world, dir)`** — undoes a container eating a box that was pushed into it. Requires the player, then a container, then (implicitly, via the wall check) a wall, in a straight line in direction `dir` (`player -> container -> wall`), and requires a piece currently occupying the container's interior "entry cell" (opposite `dir`) to extract. If satisfied: moves the player back one step, moves the container to where the player was standing (the container's pre-eat position), and moves the extracted piece to where the container was standing (its pre-eat, pre-container position, on the player's board — i.e., pulls it out to `root`).
  - This is the **only** mechanic that ever crosses a board boundary during the reverse walk (a piece moves from an interior board to `root`). It is therefore the only way a goal group can ever look "used" by the walk under any tracking scheme, position-based or provenance-based.
  - **New fact established in this sub-project, critical to Approach A**: once a box has been extracted from its interior via `inverseEat`, it can **never return** to any interior board via any of the three inverse functions. `inverseEat` only *extracts* (its own precondition requires a piece already occupying the interior's entry cell — once that cell is empty, this exact container can't fire `inverseEat` again), and neither `inversePush` nor `inverseEnter` ever *inserts* a piece onto an interior board from `root`. So "is the box still sitting at its original interior position" is a **one-way-door** check: true until the first (and only ever) extraction, false forever after. This is what makes a simple position check for the box (as opposed to the container) safe, unlike the container-position check 4b's spec correctly ruled out (see §4.2 for why the container case is different).

### 2.5 `pruneUntouchedGoals.ts` — deleting unused goal groups (from 4b)

After the reverse walk, some goal groups may never have been interacted with at all (no `inverseEat`/`inversePush` ever touched that group's pieces). Shipping those as decorative, un-openable containers would be a worse level, not a harder one. 4b's design: `computeTouchedGroups(events, groups)` unions every event's `affectedPieceIds` into a `Set<string>`, then marks a group touched if either its `containerId` or `boxId` appears in that set. `pruneUntouchedGoals(world, groups, touchedGroups)` then deletes (`removeGroup`) every group not in that set: removes the interior board and everything on it, the box piece, the container piece, and clears the container's root cell back to a plain (non-goal) floor/wall cell.

`removeGroup` has an unconditional defensive `throw` if it would ever try to delete a piece keyed as the player — this was 4b's response to an external review that (correctly, in general) flagged that a *naive position-based* touched-check could misjudge a group and delete the player along with it. Empirically this throw is provably unreachable today (per §2.4's `inverseEnter` finding — the player is never on an interior board at all), but it's kept as free, load-bearing insurance against a future change to `inverseMoves.ts` silently breaking that invariant.

**Approach A simplifies this file significantly** — see §4.2.

### 2.6 `generateBatch.ts` — orchestration, validation, scoring

`generateLevelBatch(targetPerTier, rng, maxAttempts)` loops (up to `maxAttempts`, currently `1000`) until it has `targetPerTier` levels in each of `easy`/`medium`/`hard`. Each iteration:

1. `createSeedWorld(rng)` → seed + groups.
2. `generateLevel(seed, steps, rng)` with `steps = 3 + floor(rng()*20)`; discard (`discardedGenerationFailed`) if it returns `null`.
3. Prune untouched groups (today: `computeTouchedGroups` + `pruneUntouchedGoals`; under Approach A: a single 2-arg `pruneUntouchedGoals` call — §4.4).
4. `checkWin(world)` — discard (`discardedAlreadySolved`) if the pruned world is already in a win state. This is an explicit, direct check of the generator's own contract ("produce an unsolved, playable level"), not merely inferred from `solve()` returning non-empty.
5. `canonicalKey(world)` dedup against `seenLevels` — discard (`discardedDuplicate`) if seen before.
6. `solve(world, 150)` (`solver.ts`) — discard (`discardedUnsolvable`) if no solution found within depth 150.
7. `countCrossingMoves(world, solution)` (`solver.ts`) + `scoreDifficulty(...)` (`difficultyScorer.ts`) → `difficultyTier(score)`. Discard (`discardedTierFull`) if that tier's quota is already met; otherwise accept, record, and serialize.

`main()` wipes and regenerates `src/levels/builtin/generated/` from a full batch run (`targetPerTier = 5`), reports counts/discard stats, and exits non-zero if any tier's quota wasn't met within `maxAttempts` (this is treated as an accepted, logged limitation of the seed's geometry — not silently swallowed).

`MAX_ATTEMPTS = 1000` is a previously-tuned knob (raised from 500 in sub-project 4's Task 5 tuning) balancing 'hard'-tier rarity against Node heap exhaustion risk from unbounded solver-frontier growth on larger seeds; not touched by this sub-project.

### 2.7 `solver.ts` — forward BFS solve + crossing-move counting (unchanged, out of scope)

`solve(initialWorld, maxDepth=200)` is a straightforward breadth-first search over `applyMove` results, using `canonicalKey` for a visited-set, returning the shortest solution (as a `Direction[]`) or `null` if none is found within `maxDepth` plies. Because it's BFS, it always finds a *shortest* solution — which matters for Approach A's soundness argument (§4.5): if a shorter push-only solve exists, BFS will find that instead of a longer eat-requiring one, so removing the "free" win condition is necessary, not just cosmetic.

`countCrossingMoves(world, moves)` replays `moves` via `applyMove` and, for each move, checks whether *any* piece's `location.board` differs before/after that move; if so, it counts as one "crossing" (counts events, not per-piece movement).

### 2.8 `difficultyScorer.ts` — scoring (unchanged, out of scope)

`scoreDifficulty(moveCount, crossingMoveCount) = moveCount + crossingMoveCount * 5` (`BOARD_CROSSING_WEIGHT = 5`). `difficultyTier`: `score < 10` → `easy`; `score < 25` → `medium`; else `hard`.

### 2.9 `canonical.ts` — canonical hashing (unchanged, out of scope)

`canonicalKey(world)` recursively sorts every object's keys (arrays map element-wise) before `JSON.stringify`-ing, so two `World` values that are structurally identical but were built with keys in a different insertion order still hash equal. Used for both cycle detection in the reverse walk and visited-state dedup in `solve`.

## 3. The problem: why the container mechanic is currently decorative

4b's final whole-branch review measured the actual shipped behavior and found it regressed against the very problem 4b was chartered to fix: **0 of 10** shipped levels have any board-crossing move in their optimal (BFS-shortest) solution, versus 3 of 10 before 4b; max observed difficulty score dropped from 17 to 15. A diagnostic sample of 399 scored levels found only 3 (0.75%) had any crossing move at all.

**Root cause** (confirmed by re-reading `checkWin` and `seed.ts` fresh in this session, §2 above): the goal requirement lives on the **container's root cell** (`seed.ts:65`, `cells[containerY][containerX] = { type: 'floor', requirement: 'box' }`). `checkWin`'s `'box'` branch accepts *any non-player occupant*, and the container itself is a non-player occupant of its own cell for as long as it hasn't been pushed away. So "leave the container exactly where the seed put it" is **always** a sufficient win condition for that group, completely independent of whether its interior box was ever touched. Since BFS finds the *shortest* solve, and "don't touch this container at all" is trivially available (0 extra moves) whenever the reverse walk didn't happen to push that particular container off its cell, the eat/enter mechanic is essentially never load-bearing — no matter how many goal groups exist, how large their interiors are, or how well pruning removes truly-untouched groups. Pruning by "was this group touched by any reverse-walk event" and "is this group actually necessary to win" are two different questions, and 4b's design only answered the first one.

The user's own framing of the fix (verbatim, translated): *the generator already only keeps boxes that were actually used — so if a container is going to survive pruning at all, it should necessarily require the enter/eat mechanic to be used.* This is exactly Approach A: tie "kept" to "mechanically necessary" by construction, not just to "was touched by some walk event."

## 4. Approach A: move the win condition into the interior

**Core change:** a goal group's `'box'` requirement cell is no longer the container's cell on `root`. It's the **box's own cell inside the container's interior**. Winning a group now means "get a non-player piece to be sitting where the box started, inside that interior" — and per §2.4's one-way-door fact, the only way to disturb that cell's occupancy is `inverseEat`'s forward-direction counterpart (a real `eat` move during play), which is exactly the mechanic this was supposed to require. The container's root-cell position becomes purely mechanical (it still needs to sit in front of its wall so `eat`/`enter` resolution can trigger during actual play) — never itself win-relevant.

This requires no changes to `checkWin` or any other engine file: `checkWin` already scans *every* board's every cell for requirements, generically, regardless of which board they're on (§2.1). Moving the `requirement` tag to a different cell is entirely a `seed.ts`-level change.

### 4.1 `seed.ts` changes

- The container's root cell (`cells[containerY][containerX]`) is created **without** a requirement: `{ type: 'floor' }`.
- The interior board's cell at the box's placement position (the `getEntryCell` result) gets the requirement instead. This requires restructuring the loop slightly so the interior `Board` object is a named local the code can mutate before it's stored into `boards[interiorId]`.
- `SeedGroup` gains a new field, `boxOriginalPosition: { x: number; y: number }` — the box's position *inside its own interior board*, i.e. what pruning will now check (see §4.2). The existing `originalPosition` field (the container's root position) is kept as-is; it's no longer used by pruning under Approach A, but nothing else in the file needs to change about it, and removing it isn't necessary for this fix (YAGNI: leaving a currently-unused-by-pruning-but-still-descriptive field costs nothing and there's no other consumer to break).

Full rewritten file:

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

// A group's identity as constructed by the seed. `boxId` is needed (not
// just `containerId`) because the win condition (and pruning, under
// Approach A) is keyed off the box's position, not the container's.
// `interiorId` is needed so removeGroup knows which board (and everything
// located on it) to delete when a group turns out to be untouched.
// `boxOriginalPosition` is the box's position on its own interior board —
// this is the group's win condition AND the one-way-door pruning check
// (see pruneUntouchedGoals.ts). `originalPosition` (the container's root
// position) is retained for descriptive completeness but is no longer
// consulted by pruning.
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
    // No requirement on the container's own root cell under Approach A —
    // the container merely occupying its cell must never be sufficient to
    // win. The win condition lives inside the interior instead.
    cells[containerY][containerX] = { type: 'floor' }

    const interiorSize = INTERIOR_SIZES[Math.floor(rng() * INTERIOR_SIZES.length)]
    const interiorId = `goal${i}Inside`
    const containerId = `goal${i}`
    const boxId = `box${i}`

    const interior = { id: interiorId, size: interiorSize, cells: makeFloorCells(interiorSize) }

    const { cell: eatenCell } = getEntryCell(interior, opposite(wallDir), HALF)
    if (eatenCell === null) {
      // Provably unreachable: HALF always maps to an in-bounds
      // center-of-edge cell for any board size >= 1. A loud failure here
      // is a construction-time bug, not a runtime condition to swallow.
      throw new Error(`createSeedWorld: getEntryCell unexpectedly returned null for interior size ${interiorSize}`)
    }
    // The win condition for this group: a non-player piece must occupy
    // this cell. Only the pre-placed box starts here, and (per
    // inverseMoves.ts's one-way-door property) once it leaves via eat, no
    // reverse-move function can ever put anything back here — so this
    // requirement can only be satisfied during real play by pushing the
    // box back in via a forward eat move.
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
  // Slot (0,0)'s container sits at (1+2, 1+2) = (3,3); the player goes at
  // (2,2) — 2 cells from every board edge and off the diagonal from the
  // container, so it never coincides with that group's wall regardless
  // of which of the 4 directions was randomly chosen for it.
  locations[PLAYER_ID] = { board: 'root', x: 2, y: 2 }

  return { world: { boards, pieces, locations }, groups }
}
```

**Note on the seed being pre-solved:** placing the box directly on its own requirement cell means the seed `World` starts in a win state for every group (each interior's `checkWin` scan finds the box occupying the requirement cell it was placed on). This is intentional and matches 4b's seed too (the container sat on its own requirement cell there as well) — the reverse walk is exactly what's responsible for scrambling this into an unsolved state, and `generateBatch.ts`'s explicit `checkWin(world)` discard-check after generation+pruning (§2.6, step 4) is the safety net if a particular walk+prune combination somehow leaves a group's box undisturbed *and* every other group pruned away, since in that case the whole world would still register as won and get discarded rather than shipped.

### 4.2 `pruneUntouchedGoals.ts` changes

Because the box's interior position is now a genuine one-way-door state (§2.4), whether a group was "touched" can be determined by a **direct position check** — no event-provenance tracking needed. A group is untouched if and only if its box is still sitting exactly where the seed placed it, on its own interior board.

This is safe in a way the *container's* root position never was (why 4b rejected a position check there): `inverseEnter` can move the player without moving the container at all, so a container could sit at its original root position while the group was genuinely "in play" (player currently inside it) — checking container position could misjudge and prune a live group. The box has no equivalent ambiguity: nothing except a real forward `eat` (undone as `inverseEat` in reverse) ever moves it at all, in either direction, so "unmoved" and "untouched" are the same fact for the box.

`computeTouchedGroups` and the `GenerationEvent`-derived provenance tracking are no longer needed and are removed. `removeGroup` keeps its defensive player-deletion throw (same reasoning as before — still currently unreachable, still free insurance against a future `inverseMoves.ts` change), but drops the "clear the container's root cell back to a plain cell" line, since under Approach A the root cell never carries a requirement to begin with (nothing to clear).

Full rewritten file:

```ts
import { World, cloneWorld, PLAYER_ID } from '../../src/game/engine/types'
import { SeedGroup } from './seed'

// A group is untouched iff its box still sits exactly where the seed
// placed it, on its own interior board. This is a one-way-door check
// (see inverseMoves.ts's inverseEat docs / this spec's section 2.4):
// nothing but a real eat/inverse-eat move ever changes the box's board or
// position, and once it leaves its interior, no reverse-move function can
// ever put it back. So "unmoved" and "untouched" are the same fact here —
// unlike the container's root position, which inverseEnter can leave
// unchanged even while the group is genuinely in play.
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
      // Provably unreachable today: the player's board never leaves
      // 'root' for the whole reverse walk (none of the three reverse
      // functions can put the player on an interior board starting from
      // a root-seeded walk), so this branch should never execute in
      // practice. Kept as a loud failure rather than removed, so that if
      // a future change to inverseMoves.ts/generateLevel.ts ever breaks
      // that invariant, it surfaces immediately instead of silently
      // corrupting the World.
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

Note the loop condition inverts (`if (!isGroupUntouched...) continue` — keep touched groups, remove untouched ones), matching the old code's `if (touchedGroups.has(...)) continue` (keep touched, remove untouched) — same behavior, restated in terms of the new direct check instead of a precomputed set membership test.

### 4.3 `generateLevel.ts` changes

`affectedPieceIds` is no longer consumed by anything (pruning now checks final box position directly), so both the field on `GenerationEvent` and the helper function that computed it are removed — reverting this file to its pre-4b-provenance-tracking shape.

Full rewritten file:

```ts
import { Direction, World, cloneWorld } from '../../src/game/engine/types'
import { inverseEat, inverseEnter, inversePush } from './inverseMoves'
import { canonicalKey } from './canonical'

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

function shuffled<T>(items: T[], rng: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function generateLevel(seed: World, steps: number, rng: () => number): GenerationResult | null {
  let world = cloneWorld(seed)
  const events: GenerationEvent[] = []
  const seen = new Set<string>([canonicalKey(world)])
  let attempts = 0
  const maxAttempts = Math.max(steps, 1) * 20

  while (events.length < steps && attempts < maxAttempts) {
    attempts++
    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length) % DIRECTIONS.length]

    let accepted: { kind: GenerationEventKind; world: World } | null = null
    for (const pattern of shuffled(PATTERNS, rng)) {
      const next = pattern.fn(world, direction)
      if (!next) continue
      const key = canonicalKey(next)
      if (seen.has(key)) continue
      accepted = { kind: pattern.kind, world: next }
      break
    }
    if (!accepted) continue

    world = accepted.world
    seen.add(canonicalKey(world))
    events.push({ kind: accepted.kind, direction })
  }

  if (events.length < steps) return null
  return { world, events }
}
```

### 4.4 `generateBatch.ts` changes

Only the pruning call site and its import change — two lines:

```diff
-import { computeTouchedGroups, pruneUntouchedGoals } from './pruneUntouchedGoals'
+import { pruneUntouchedGoals } from './pruneUntouchedGoals'
```

```diff
-    const touchedGroups = computeTouchedGroups(generated.events, groups)
-    const world = pruneUntouchedGoals(generated.world, groups, touchedGroups)
+    const world = pruneUntouchedGoals(generated.world, groups)
```

Nothing else in this file changes — `checkWin`, dedup, `solve`, `countCrossingMoves`, `scoreDifficulty`, `difficultyTier`, and all bucketing/reporting logic are untouched and continue to work exactly as described in §2.6, operating on whatever `World` `pruneUntouchedGoals` now returns.

### 4.5 Why this is sound (soundness argument)

1. **No engine change needed.** `checkWin` already treats every board's requirement cells uniformly (§2.1, confirmed by fresh re-read of `rules.ts:154-169`). Moving *where* a requirement lives doesn't require touching how it's evaluated.
2. **Every surviving group now structurally requires `eat`.** After pruning, only groups whose box has moved from its seed position survive (§4.2). The box can only have moved via a real `eat` move (forward) having occurred during the walk's un-scrambling, i.e., the level's win path must include at least one crossing move for that group's box to be back in place — the group's own goal cell is the box's interior cell, so satisfying it requires exactly the interaction the whole feature is about.
3. **BFS shortest-path concern (the reason Approach C was rejected) doesn't apply here.** Approach C (bias generation toward `eat` without changing what wins) was rejected specifically because BFS could still find a shorter push-only solve that bypasses a generated `eat` event, since the win condition didn't require it. Under Approach A, there is no shorter solve that leaves a surviving group's box out of place, because leaving it out of place means that group's win condition is unmet, by construction — `checkWin` would still report `false`. There is no "trivial" win available for a surviving group anymore.
4. **`inverseEnter`'s irrelevance is unaffected.** Approach A doesn't change the player's start position, `inverseEnter`'s precondition, or anything about the player's board over the course of a walk — the §2.4 finding that `inverseEnter` can never fire from a root-seeded walk is not touched by this change, and is not required for Approach A's soundness (the argument above only relies on `inverseEat` being the box's sole mover in either direction, which was independently confirmed by re-reading `inverseMoves.ts` in this session — no other function reads or writes `containerId`'s or `boxId`'s locations at all).
5. **`removeGroup`'s defensive throw remains valid and still free.** It still guards against deleting the player, and nothing about Approach A makes that scenario more reachable — if anything, it becomes *less* relevant, since pruning is no longer driven by event provenance at all, only by final box position.

## 5. Test impact (for the implementation plan to expand on)

Not exhaustive here (the implementation plan will draw exact test cases from this), but the shape of what changes:

- `seed.test.ts`: needs a new assertion that the container's root cell has **no** requirement, and that the box's cell inside its interior **does** have `requirement: 'box'`; the existing no-overlap/geometry tests (interior sizes 3 and 5, wall placement, `getEntryCell` arithmetic) are unaffected by which cell carries the requirement and should be otherwise unchanged. `SeedGroup`'s new `boxOriginalPosition` field should be asserted to match the box's actual placed location.
- `pruneUntouchedGoals.test.ts`: the `computeTouchedGroups`-specific tests (including 4b's regression test for "an `inverseEnter` event with no piece movement must still mark its group as touched") are removed, since there's no more event-provenance concept to test. New tests: a group whose box never moved is pruned; a group whose box has moved (simulate via a `World` with the box relocated) is kept; the player-deletion defensive throw still fires under a constructed pathological input (same as 4b's test for this, just no longer routed through a touched-set).
- `generateLevel.test.ts`: any assertions on `event.affectedPieceIds` are removed (mirrors 4b's own migration-note pattern of one call-site fix, in reverse).
- `generateBatch.test.ts`: update the one call site if it directly asserts on `pruneUntouchedGoals`'s arity/behavior; otherwise unaffected since `generateLevelBatch`'s public contract (inputs/outputs) doesn't change.
- **New empirical diagnostic pass required before regenerating `src/levels/builtin/generated/*.json`** (same pattern as sub-project 4's Task 11 and 4b's Task 5): sample a batch run and directly measure crossing-move counts across shipped levels, to confirm the fix actually produces levels with `countCrossingMoves > 0` in their optimal solve, not just that it's designed to in theory. This spec predicts a large improvement over 4b's measured 0/10 and 0.75%, but that must be measured, not assumed, exactly as 4b's own spec insisted for its own predictions.

## 6. Explicitly out of scope

- **Finding (2) — player-start-position skew.** 4b's reviewer measured per-group touch frequency heavily skewed toward the player's starting slot (goal0=659 touches vs goal3=7, out of a 1417-walk sample), capping observed `touchedGroupCount` at 2 and suspected as a contributor to 'hard'-tier rarity. The reviewer's suggested fix (move the player's start toward the board's center) was explicitly labeled unverified — an untested hypothesis, not a validated design. This is a separate seed-geometry question from Approach A's win-condition-placement fix, and folding it in here would conflate two independently-testable changes. If the user wants this addressed, it should be its own follow-up brainstorm/spec, informed by fresh diagnostics run *after* Approach A ships (since Approach A changes what counts as a "successful," level-worthy walk, which could itself shift the touch-frequency distribution in ways worth re-measuring before designing a fix).
- **`MAX_ATTEMPTS` / solver performance tuning.** 4b's final review flagged `solver.ts`'s unbounded full-`World`-clone BFS frontiers as an Important-but-not-blocking finding, exacerbated by (not caused by) the larger 12×12/multi-group seed. Untouched by this design; `solver.ts` isn't modified.
- **Any change to `inverseMoves.ts`, `checkWin`, or other engine files.** Confirmed unnecessary by the analysis in §4.5.

## 7. Files touched summary

| File | Change |
|---|---|
| `tools/generator/seed.ts` | Requirement moves from container's root cell to box's interior cell; `SeedGroup` gains `boxOriginalPosition` |
| `tools/generator/pruneUntouchedGoals.ts` | `computeTouchedGroups` removed; new `isGroupUntouched` direct position check; `pruneUntouchedGoals` becomes 2-arg |
| `tools/generator/generateLevel.ts` | `affectedPieceIds` field/helper removed from `GenerationEvent` |
| `tools/generator/generateBatch.ts` | Pruning call site updated to 2-arg `pruneUntouchedGoals(world, groups)`; import updated |
| `tools/generator/seed.test.ts` | Requirement-placement assertions updated; `boxOriginalPosition` assertion added |
| `tools/generator/pruneUntouchedGoals.test.ts` | Provenance-based tests replaced with position-based tests |
| `tools/generator/generateLevel.test.ts` | `affectedPieceIds` assertions removed |
| `tools/generator/generateBatch.test.ts` | Updated only if it references removed API surface |
| `src/levels/builtin/generated/*.json` | Regenerated after implementation + diagnostic pass |

Unchanged: `tools/generator/inverseMoves.ts`, `tools/generator/solver.ts`, `tools/generator/difficultyScorer.ts`, `tools/generator/canonical.ts`, `src/game/engine/*` (all of it), `src/game/engine/levelSchema.ts`.
