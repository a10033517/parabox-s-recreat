# Parabox General Containment Cycles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the self-loop box (sub-project 6) into support for any containment cycle that includes the level's own starting board — fixing a real found bug (a self-loop box sharing a board with a separate external owner is permanently inert) and enabling multi-node cycles (e.g. two containers that mutually contain each other, closing back through the start).

**Architecture:** `levelSchema.ts` stops treating "root" as a structural property (the board with zero owners) and starts treating it as nothing more than wherever the player's location says play begins. Ownership counting no longer excludes self-references — a board with two owners (self-referencing or not) is rejected by the existing over-owned check, which is what makes `08-nested-loop.json`'s old shape invalid now, with no bespoke code needed for that specific case. Reachability's BFS is seeded from whichever board has zero owners if exactly one does (unchanged tree case), or from the player's actual board if none does (new cycle case) — the walk itself doesn't change at all. `types.ts`'s `findContainerFor` reverts to its original simple form, since a two-owner board can no longer exist in a parsed `World`. `worldEdit.ts`'s cascade-deletion guards widen to also protect the player's actual starting board (never the literal string `'root'`) from being deleted via a piece that merely closes a cycle back to it. `computeTarget`/`tryMovePiece`/`checkLose` need zero changes — already verified against the real engine with a hand-built two-node cycle.

**Tech Stack:** TypeScript (strict), Vitest, React 18 + @testing-library/react (for the editor task).

**Spec:** `docs/superpowers/specs/2026-09-18-parabox-general-cycles-design.md`

## Global Constraints

- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true` in `tsconfig.json`.
- Engine tests build worlds with `makeFloorBoard`/`makeWorld`/`setWall`/`setRequirement`
  from `src/game/engine/testFixtures.ts` where that fits; `worldEdit.test.ts` follows its
  own existing convention of building worlds via `createEmptyWorld`/`createEmptyBoard`
  (from `worldEdit.ts` itself) plus, where no existing helper produces the needed shape
  (a cross-referencing cycle), a directly-typed `World` object literal.
- **Never key gameplay- or level-validation logic off the literal string `'root'`** —
  `levelSchema.ts` and `CanvasRenderer.ts` must stay purely structural (ownership
  counts, `boardRef` graph walks, player-location-based reachability seeding).
  **Correction (ruled during Task 3's implementation, superseding this section's
  original text):** `worldEdit.ts`'s cascade-protection guard is the one exception —
  it correctly hard-codes the literal string `'root'`, not the player's current
  location. `worldEdit.ts` operates on live-editing state, where "wherever the player
  currently is" is not a stable proxy for "the level's foundational board" (the player
  is routinely and legitimately positioned inside ordinary nested containers during
  normal editing); using the player-location approach there broke 4 pre-existing tests.
  Hard-coding `'root'` is safe specifically in `worldEdit.ts` — and in
  `EditorScreen.tsx`'s self-loop-box root-restriction — because both are editor-only
  code, `createEmptyWorld` always names the foundational board `'root'`, and there is
  no "load an existing level back into the editor" feature, so a differently-named
  starting board is not a reachable scenario through either file's own entry points.
  See `.superpowers/sdd/2026-09-18-parabox-general-cycles/progress.md`'s Task 3 section
  for the full ruling and rationale.
- Do not assume global color uniqueness in `CanvasRenderer.ts` tests beyond the specific
  fixtures each test constructs (the palette is a visual aid, not a uniqueness
  guarantee — see the spec).
- Existing files this plan does NOT touch: `rules.ts`, `rules.test.ts`, `GameState.ts`,
  `GameScreen.tsx`, `App.tsx`, `tools/generator/*`.

---

### Task 1: `levelSchema.ts` — root as starting board, not structural property

**Files:**
- Modify: `src/game/engine/levelSchema.ts`
- Modify: `src/game/engine/levelSchema.test.ts`

**Interfaces:**
- No new exports. `parseLevel`'s signature is unchanged. Its *behavior* changes for
  exactly the shapes described below — every other currently-valid/invalid level is
  unaffected (traced by hand against every existing test in this file; see Step 1).

- [ ] **Step 1: Update the existing tests whose expected outcome changes**

In `src/game/engine/levelSchema.test.ts`, replace the test
`'rejects a self-referencing container on a non-root board with no external owner'`
(self-references now count normally, so board `x` is no longer an orphan — it's simply
never reached from `root`, which is still the sole orphan; the rejection now comes from
reachability, not ownership):

```ts
  it('rejects a self-referencing container on a non-root board with no external owner', () => {
    // cx self-references board x (its own interior is the very board it
    // sits on). Self-references now count as ordinary owners (see
    // levelSchema.ts), so x has exactly one owner (itself) — it's root that
    // stays the sole orphan board. But nothing on root (or anywhere reached
    // from root) ever references x, so x is simply never reached by the
    // walk from root: still invalid, just caught by reachability instead of
    // by the ownership count.
    const root = makeFloorBoard('root', 2)
    const x = makeFloorBoard('x', 2)
    const world = makeWorld(
      [root, x],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'cx', kind: 'container', boardRef: 'x' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        cx: { board: 'x', x: 0, y: 0 }, // cx sits inside its own interior
      },
    )
    const data = serializeLevel(world)
    expect(() => parseLevel(data)).toThrow(/reachable/i)
  })
```

Replace the test `'accepts a self-referencing container on a non-root board that also
has a real external owner'` (this shape is now always invalid — board `y` has two
owners, `d` and `loopBox`, once self-references stop being excluded from the count):

```ts
  it('rejects a self-referencing container that shares a board with a separate external owner', () => {
    // Once self-references count normally, board y has TWO owners here — d
    // (external, on root) and loopBox (self-referencing y itself) — which
    // is exactly as invalid as any other over-owned board. This is the
    // shape that made the shipped self-loop box permanently inert whenever
    // it coexisted with a real external owner: see the spec's Background.
    const root = makeFloorBoard('root', 2)
    const y = makeFloorBoard('y', 2)
    const world = makeWorld(
      [root, y],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'd', kind: 'container', boardRef: 'y' }, // external owner, sits on root
        { id: 'loopBox', kind: 'container', boardRef: 'y' }, // self-reference, sits on y itself
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        d: { board: 'root', x: 1, y: 0 },
        loopBox: { board: 'y', x: 0, y: 0 },
      },
    )
    const data = serializeLevel(world)
    expect(() => parseLevel(data)).toThrow(/owner/i)
  })
```

- [ ] **Step 2: Add the new tests**

Append to the same `describe('parseLevel board-ownership validation', ...)` block, after
the (unchanged) `'rejects a mutual two-board containment cycle'` test:

```ts
  it('accepts a two-node cycle that closes back through the starting board', () => {
    // redPiece owns redInterior; yellowPiece (inside redInterior) owns
    // root, closing the loop. Neither board has zero owners, so this is
    // the "cycle" branch: reachability is seeded from the player's board
    // (root) instead of an orphan.
    const root = makeFloorBoard('root', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [root, redInterior],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        redPiece: { board: 'root', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )
    const data = serializeLevel(world)
    expect(parseLevel(data)).toEqual(world)
  })

  it('rejects two boards that both have no owner', () => {
    const root = makeFloorBoard('root', 2)
    const orphan = makeFloorBoard('orphan', 1)
    const world = makeWorld(
      [root, orphan],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    const data = serializeLevel(world)
    expect(() => parseLevel(data)).toThrow(/no owner/i)
  })

  it('rejects a cycle world whose player has no location, before reachability ever runs', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        loopBox: { board: 'root', x: 1, y: 0 },
      },
    )
    const data = serializeLevel(world) as { locations: Record<string, unknown> }
    delete data.locations[PLAYER_ID]
    expect(() => parseLevel(data)).toThrow(/starting board/i)
  })

  it('rejects a cycle world whose player location points at a nonexistent board', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        loopBox: { board: 'root', x: 1, y: 0 },
      },
    )
    const data = serializeLevel(world) as { locations: Record<string, { board: string }> }
    data.locations[PLAYER_ID].board = 'nonexistent'
    expect(() => parseLevel(data)).toThrow(/starting board/i)
  })
```

The existing `'rejects two containers referencing the same board'`,
`'rejects a non-root board referenced by zero containers'`, `'accepts a
self-referencing container on the root board'`, and `'rejects a mutual two-board
containment cycle'` tests all need **no changes** — traced by hand against the new
algorithm below and confirmed each still produces the same accept/reject outcome for
the same reason category (only the exact wording of the "too many orphans" error
changes, and it still matches `/owner/i`).

- [ ] **Step 3: Run the test file and confirm it fails**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: FAIL — the two replaced tests fail against today's code (self-loop-on-non-root
still throws `/owner/i` not `/reachable/i`; the external-owner-sharing shape still
parses successfully instead of throwing), and the four new tests fail (today's code
always requires exactly one orphan, rejecting the cycle-acceptance test; the "no
starting board" tests don't produce a `/starting board/i` message today).

- [ ] **Step 4: Implement the change**

In `src/game/engine/levelSchema.ts`, replace this whole block:

```ts
  // Board ownership: every board must be referenced by exactly one
  // container, except a single root board referenced by none.
  const ownerCount: Record<string, number> = Object.fromEntries(
    Object.keys(boards).map((boardId) => [boardId, 0]),
  )
  for (const piece of Object.values(pieces)) {
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
      // A container located on the very board it owns (a self-loop box) is
      // not a real external owner — it provides no path INTO this board
      // from anywhere else, so it must not count toward "this board has an
      // owner." Without this exclusion, a self-loop on the root board would
      // make ownerCount[root] === 1 and break the "exactly one owner-less
      // board is the root" invariant checked just below.
      const isSelfReferencing = locations[piece.id]?.board === piece.boardRef
      if (!isSelfReferencing) {
        ownerCount[piece.boardRef] = (ownerCount[piece.boardRef] ?? 0) + 1
      }
    }
  }
  const orphanBoards = Object.entries(ownerCount).filter(([, count]) => count === 0)
  if (orphanBoards.length !== 1) {
    throw new Error(
      `Level must have exactly one board with no owner (the root); found ${orphanBoards.length}`,
    )
  }
  const rootBoardId = orphanBoards[0][0]
  const overOwnedBoards = Object.entries(ownerCount).filter(([, count]) => count > 1)
  if (overOwnedBoards.length > 0) {
    const [boardId] = overOwnedBoards[0]
    throw new Error(`Board "${boardId}" has more than one owner (container referencing it)`)
  }
```

with:

```ts
  // Board ownership: every board must be referenced by at most one
  // container, and at most one board may have zero owners. Root isn't
  // structurally special — it's whichever board has no owner (a normal
  // tree), or, when every board has exactly one owner (a cycle exists),
  // whichever board the player starts on (see startBoardId below).
  const ownerCount: Record<string, number> = Object.fromEntries(
    Object.keys(boards).map((boardId) => [boardId, 0]),
  )
  for (const piece of Object.values(pieces)) {
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
      ownerCount[piece.boardRef] = (ownerCount[piece.boardRef] ?? 0) + 1
    }
  }
  const orphanBoards = Object.entries(ownerCount).filter(([, count]) => count === 0)
  if (orphanBoards.length > 1) {
    throw new Error(
      `Level must have at most one board with no owner; found ${orphanBoards.length}`,
    )
  }
  const overOwnedBoards = Object.entries(ownerCount).filter(([, count]) => count > 1)
  if (overOwnedBoards.length > 0) {
    const [boardId] = overOwnedBoards[0]
    throw new Error(`Board "${boardId}" has more than one owner (container referencing it)`)
  }

  let startBoardId: string
  if (orphanBoards.length === 1) {
    startBoardId = orphanBoards[0][0]
  } else {
    // orphanBoards.length === 0: the level is one connected cycle (or a
    // cycle with tree branches). There is no ownerless board to anchor on,
    // so the player's own starting board is the only board that can serve
    // as the reachability seed. Validate it explicitly here, before using
    // it — don't let the later per-piece location checks be the only thing
    // standing between an invalid player location and a confusing
    // reachability error.
    const playerLocation = locations[PLAYER_ID]
    if (playerLocation === undefined) {
      throw new Error(
        'Cannot determine a starting board for reachability: no board is ownerless, and the player has no location',
      )
    }
    if (boards[playerLocation.board] === undefined) {
      throw new Error(
        `Cannot determine a starting board for reachability: the player's board "${playerLocation.board}" does not exist`,
      )
    }
    startBoardId = playerLocation.board
  }
```

Then replace:

```ts
  // Reachability: every board must be reachable from the root board by
  // following container pieces down into their interiors, starting from
  // whatever board each container is physically located on. The ownership
  // counts checked above (every non-root board has exactly one owner) are
  // necessary but not sufficient — a cycle (A's interior is B, and a piece
  // inside B has interior A) satisfies those counts while never actually
  // connecting back to the true root, and would otherwise hang applyMove's
  // board-exit recursion forever instead of ever resolving to null.
  const reached = new Set<string>([rootBoardId])
  const queue: string[] = [rootBoardId]
```

with:

```ts
  // Reachability: every board must be reachable from startBoardId by
  // following container pieces down into their interiors, starting from
  // whatever board each container is physically located on. The ownership
  // counts checked above (at most one owner per board, at most one board
  // with zero) are necessary but not sufficient — a cycle disconnected
  // from startBoardId, or a tree mixed with an unconnected cycle
  // elsewhere, can satisfy those local counts while never actually
  // connecting back to where play starts. This same walk also correctly
  // traverses INTO a cycle that includes startBoardId itself: each step
  // just follows one more owned board, and a ring closes back onto a board
  // already in `reached`, which the `!reached.has(...)` guard below
  // already treats as a no-op rather than an infinite loop.
  const reached = new Set<string>([startBoardId])
  const queue: string[] = [startBoardId]
```

The rest of the reachability loop (the `while (queue.length > 0) { ... }` body itself,
and the final `unreachable` check) needs **no changes** — it never referenced
`rootBoardId` by name anywhere except the two lines just replaced. Update only the final
error message's wording, from `` `Board(s) not reachable from the root board: ...` `` to
`` `Board(s) not reachable from the starting board: ...` `` (still matches `/reachable/i`
in the unchanged `'rejects a mutual two-board containment cycle'` test).

- [ ] **Step 5: Run the test file and confirm it passes**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: PASS — all tests, including the two replaced and four new ones.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/game/engine/levelSchema.ts src/game/engine/levelSchema.test.ts
git commit -m "feat(engine): validate containment cycles through the starting board"
```

---

### Task 2: `types.ts` — revert `findContainerFor`

**Files:**
- Modify: `src/game/engine/types.ts`
- Modify: `src/game/engine/types.test.ts`

**Interfaces:**
- `findContainerFor`'s exported signature is unchanged. Its behavior changes only for a
  two-owner board — a shape Task 1 makes impossible for `parseLevel` to ever produce, so
  no currently-valid caller is affected.

- [ ] **Step 1: Update the test file**

In `src/game/engine/types.test.ts`, replace the whole `describe('findContainerFor', ...)`
block (currently three `it`s: "finds the container piece...", "prefers the external
owner...", "falls back to the self-referencing owner...") with:

```ts
describe('findContainerFor', () => {
  it('finds the container piece whose boardRef matches, or undefined', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('inside', 2)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'box', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        box: { board: 'root', x: 1, y: 1 },
      },
    )
    expect(findContainerFor(world, 'inside')).toBe('box')
    expect(findContainerFor(world, 'root')).toBeUndefined()
  })

  it('finds a self-referencing container as its own board\'s owner', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root' }],
      { loopBox: { board: 'root', x: 0, y: 0 } },
    )
    expect(findContainerFor(world, 'root')).toBe('loopBox')
  })
})
```

(The removed "prefers the external owner..." test specifically covered the two-owner
tie-break this task is reverting — that scenario can no longer occur in any world
`parseLevel` would ever produce, per Task 1's new over-owned rejection, which is why
this function no longer needs to handle it.)

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: FAIL — nothing about `findContainerFor` itself is broken yet (today's code
still passes the *old* three-test version), but you've just replaced that with the new
two-test version, so run it once to confirm the file is syntactically valid and both
remaining tests currently pass (they should — this step is really "confirm the test
file edit didn't break anything," since the *implementation* change comes next and
these two assertions hold under both the old and new `findContainerFor`).

- [ ] **Step 3: Implement the change**

In `src/game/engine/types.ts`, replace:

```ts
// When a board is owned by both a self-referencing container (standing on
// the very board it owns) and a separate external container elsewhere, the
// external owner is the semantically meaningful one for climbing out of the
// board — the self-referencing piece's "ownership" is really just the
// self-loop trap, not a real parent to exit into. Prefer the external owner
// deterministically (not by object-key iteration order, which is not a
// semantic property of the level), falling back to the self-referencing
// piece only when it's the sole candidate — this preserves the root
// self-loop trap and every single-owner case unchanged.
export function findContainerFor(world: World, boardId: BoardId): PieceId | undefined {
  let selfRef: PieceId | undefined
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container' || piece.boardRef !== boardId) continue
    if (world.locations[piece.id]?.board === boardId) {
      selfRef ??= piece.id
    } else {
      return piece.id
    }
  }
  return selfRef
}
```

with:

```ts
export function findContainerFor(world: World, boardId: BoardId): PieceId | undefined {
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind === 'container' && piece.boardRef === boardId) return piece.id
  }
  return undefined
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/game/engine/types.ts src/game/engine/types.test.ts
git commit -m "refactor(engine): revert findContainerFor now that over-owned boards are always rejected"
```

---

### Task 3: `worldEdit.ts` — generalize cascade protection to the player's actual board

**Files:**
- Modify: `src/editor/worldEdit.ts`
- Modify: `src/editor/worldEdit.test.ts`

**Interfaces:**
- `deletePieceRecursively` and `canPlacePieceAt`'s exported signatures are unchanged.
  Their behavior changes only for a piece whose `boardRef` equals the player's actual
  starting board but which is *not* itself self-referencing (a cycle-closing piece) —
  previously that case wasn't specially protected at all (it doesn't arise in a
  tree-only or single-self-loop world, both of which is all Sub-project 6 ever produced
  or accepted).

- [ ] **Step 1: Write the failing tests**

Append to `src/editor/worldEdit.test.ts`. First, add `World` to the existing types
import (keep `PLAYER_ID`, which is already imported):

```ts
import { PLAYER_ID, World } from '../game/engine/types'
```

Then append:

```ts
test('deleting a piece that closes a cycle back to the starting board does not cascade-delete that board', () => {
  const world: World = {
    boards: {
      root: createEmptyBoard('root', 2),
      redInterior: createEmptyBoard('redInterior', 1),
    },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      redPiece: { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
      yellowPiece: { id: 'yellowPiece', kind: 'container', boardRef: 'root' },
    },
    locations: {
      [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
      redPiece: { board: 'root', x: 1, y: 0 },
      yellowPiece: { board: 'redInterior', x: 0, y: 0 },
    },
  }
  const next = deletePieceRecursively(world, 'yellowPiece')
  expect(next.pieces.yellowPiece).toBeUndefined()
  expect(next.boards.root).toBeDefined()
  expect(next.pieces[PLAYER_ID]).toBeDefined()
  expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 0 })
})

test('the cascade-protection guard uses the player\'s actual starting board, not the literal string "root"', () => {
  const world: World = {
    boards: {
      start: createEmptyBoard('start', 2), // deliberately NOT named 'root'
      blueInterior: createEmptyBoard('blueInterior', 1),
    },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      bluePiece: { id: 'bluePiece', kind: 'container', boardRef: 'blueInterior' },
      greenPiece: { id: 'greenPiece', kind: 'container', boardRef: 'start' },
    },
    locations: {
      [PLAYER_ID]: { board: 'start', x: 0, y: 0 },
      bluePiece: { board: 'start', x: 1, y: 0 },
      greenPiece: { board: 'blueInterior', x: 0, y: 0 },
    },
  }
  const next = deletePieceRecursively(world, 'greenPiece')
  expect(next.boards.start).toBeDefined()
  expect(next.pieces[PLAYER_ID]).toBeDefined()
})

test('canPlacePieceAt allows overwriting a piece that closes a cycle back to the starting board', () => {
  const world: World = {
    boards: {
      root: createEmptyBoard('root', 2),
      redInterior: createEmptyBoard('redInterior', 1),
    },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      redPiece: { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
      yellowPiece: { id: 'yellowPiece', kind: 'container', boardRef: 'root' },
    },
    locations: {
      [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
      redPiece: { board: 'root', x: 1, y: 0 },
      yellowPiece: { board: 'redInterior', x: 0, y: 0 },
    },
  }
  expect(canPlacePieceAt(world, 'redInterior', 0, 0)).toBe(true) // yellowPiece's own cell
})
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/editor/worldEdit.test.ts`
Expected: FAIL — today's code cascades into deleting `root`/`start` (and everything on
it, including the player) when `yellowPiece`/`greenPiece` is deleted, since neither is
self-referencing under the current, narrower guard; `canPlacePieceAt` returns `false`
for `yellowPiece`'s cell today, since `subtreeContainsPlayer` walks into `root` (via
`yellowPiece`'s `boardRef`) and finds the player there.

- [ ] **Step 3: Implement the change**

In `src/editor/worldEdit.ts`, replace `subtreeContainsPlayer`:

```ts
function subtreeContainsPlayer(world: World, pieceId: PieceId): boolean {
  const stack: PieceId[] = [pieceId]
  const seen = new Set<PieceId>()
  while (stack.length > 0) {
    const id = stack.pop() as PieceId
    if (seen.has(id)) continue
    seen.add(id)
    if (id === PLAYER_ID) return true
    const piece = world.pieces[id]
    // A self-referencing (self-loop) container's own board is not solely
    // "owned" by it — deleting it never touches that board (see
    // deletePieceRecursively's matching guard), so descending into it here
    // would be a stale false positive: it could find the player standing on
    // that same board even though deleting this piece can't remove the
    // player at all.
    const isSelfReferencing = world.locations[id]?.board === piece?.boardRef
    if (piece?.kind === 'container' && piece.boardRef !== undefined && !isSelfReferencing) {
      for (const [otherId, loc] of Object.entries(world.locations)) {
        if (loc.board === piece.boardRef && !seen.has(otherId)) stack.push(otherId)
      }
    }
  }
  return false
}
```

with:

```ts
function subtreeContainsPlayer(world: World, pieceId: PieceId): boolean {
  const startBoardId = world.locations[PLAYER_ID]?.board
  const stack: PieceId[] = [pieceId]
  const seen = new Set<PieceId>()
  while (stack.length > 0) {
    const id = stack.pop() as PieceId
    if (seen.has(id)) continue
    seen.add(id)
    if (id === PLAYER_ID) return true
    const piece = world.pieces[id]
    // Deleting this piece never touches the board it "owns" when either (a)
    // it's self-referencing (standing on the very board it owns — the
    // classic self-loop), or (b) that board is the level's actual starting
    // board, closed back to by a longer cycle (see deletePieceRecursively's
    // matching guard — this must read the player's real location, never
    // the literal string 'root', or a level whose starting board has a
    // different id would silently lose this protection). Descending into
    // either case here would be a stale false positive: it could find the
    // player standing on that same board even though deleting this piece
    // can't remove the player at all.
    const skipsCascade =
      world.locations[id]?.board === piece?.boardRef ||
      (piece?.boardRef !== undefined && piece.boardRef === startBoardId)
    if (piece?.kind === 'container' && piece.boardRef !== undefined && !skipsCascade) {
      for (const [otherId, loc] of Object.entries(world.locations)) {
        if (loc.board === piece.boardRef && !seen.has(otherId)) stack.push(otherId)
      }
    }
  }
  return false
}
```

Replace `deletePieceRecursively`:

```ts
export function deletePieceRecursively(world: World, pieceId: PieceId): World {
  const next = cloneWorld(world)
  const stack: PieceId[] = [pieceId]
  while (stack.length > 0) {
    const id = stack.pop() as PieceId
    const piece = next.pieces[id]
    if (!piece) continue
    // A self-referencing (self-loop) container's own board is not solely
    // "owned" by it — that board is the very one it's standing on, which
    // may still be legitimately owned by a separate external container (or,
    // on root, own itself). Deleting a self-loop piece must only delete
    // that one piece, never cascade into the board it also sits inside.
    const isSelfReferencing = next.locations[id]?.board === piece.boardRef
    if (piece.kind === 'container' && piece.boardRef !== undefined && !isSelfReferencing) {
      const boardId = piece.boardRef
      for (const [otherId, loc] of Object.entries(next.locations)) {
        if (loc.board === boardId) stack.push(otherId)
      }
      delete next.boards[boardId]
    }
    delete next.pieces[id]
    delete next.locations[id]
  }
  return next
}
```

with:

```ts
export function deletePieceRecursively(world: World, pieceId: PieceId): World {
  const next = cloneWorld(world)
  const startBoardId = next.locations[PLAYER_ID]?.board
  const stack: PieceId[] = [pieceId]
  while (stack.length > 0) {
    const id = stack.pop() as PieceId
    const piece = next.pieces[id]
    if (!piece) continue
    // A self-referencing (self-loop) container's own board is not solely
    // "owned" by it, and neither is the level's actual starting board when
    // a longer cycle closes back onto it through a non-self-referencing
    // piece — that board is the very foundation the level is built on, and
    // may still be legitimately owned by a separate external container (or
    // own itself). Deleting either kind of piece must only delete that one
    // piece, never cascade into the board it points at. This reads the
    // player's real location (never the literal string 'root') so a level
    // whose starting board has a different id stays protected too.
    const skipsCascade =
      next.locations[id]?.board === piece.boardRef ||
      (piece.boardRef !== undefined && piece.boardRef === startBoardId)
    if (piece.kind === 'container' && piece.boardRef !== undefined && !skipsCascade) {
      const boardId = piece.boardRef
      for (const [otherId, loc] of Object.entries(next.locations)) {
        if (loc.board === boardId) stack.push(otherId)
      }
      delete next.boards[boardId]
    }
    delete next.pieces[id]
    delete next.locations[id]
  }
  return next
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/editor/worldEdit.test.ts`
Expected: PASS — all tests, including the three new ones.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/editor/worldEdit.ts src/editor/worldEdit.test.ts
git commit -m "fix(editor): protect the player's actual starting board from cascade deletion, not just self-loops"
```

---

### Task 4: `EditorScreen.tsx` — restrict the self-loop-box tool to root

**Files:**
- Modify: `src/editor/EditorScreen.tsx`
- Modify: `src/editor/EditorScreen.test.tsx`

**Interfaces:**
- No signature changes anywhere. `EditorScreen`'s public interface is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/editor/EditorScreen.test.tsx`:

```ts
test('the self-loop-box tool is a no-op when the active board is not root', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByText('外层 > box-0')).toBeInTheDocument() // confirm we navigated in

  await user.click(screen.getByLabelText('自包箱'))
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.queryByTestId('box-at-0-0')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: FAIL — today's `self-loop-box` branch has no root check, so it would place a
piece at `(0,0)` inside `box-0`'s interior.

- [ ] **Step 3: Implement the change**

In `src/editor/EditorScreen.tsx`, find the `self-loop-box` branch inside `placeAt`:

```tsx
    if (tool === 'self-loop-box') {
      const existingId = occupantAt(world, { board: activeBoardId, x, y })
```

Add one line immediately before it:

```tsx
    if (tool === 'self-loop-box') {
      if (activeBoardId !== 'root') return
      const existingId = occupantAt(world, { board: activeBoardId, x, y })
```

(Everything else in that branch is unchanged.)

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: PASS — all tests, including the existing self-loop-on-root test (which places
directly on root and is unaffected) and the new one.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/editor/EditorScreen.tsx src/editor/EditorScreen.test.tsx
git commit -m "feat(editor): restrict the self-loop-box tool to the root board"
```

---

### Task 5: `CanvasRenderer.ts` — per-cycle-member colors

**Files:**
- Modify: `src/game/render/CanvasRenderer.ts`
- Modify: `src/game/render/CanvasRenderer.test.ts`

**Interfaces:**
- `renderBoard`'s exported signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/game/render/CanvasRenderer.test.ts`, inside the `describe('renderBoard',
...)` block (the existing self-loop test stays exactly as-is — it still passes under
the new implementation, since a self-loop is a 1-node cycle):

```ts
  it('renders two members of a multi-node cycle in different colors from each other', () => {
    const root = makeFloorBoard('root', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [root, redInterior],
      [
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'root' },
      ],
      {
        redPiece: { board: 'root', x: 0, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )
    const ctx = mockContext()

    const rootStyles: string[] = []
    ctx.fillRect = () => { rootStyles.push(ctx.fillStyle as string) }
    renderBoard(ctx, root, world, 32)
    const redPieceColor = rootStyles[4] // 4 cell draws (2x2), then redPiece (the only piece on root)

    const insideStyles: string[] = []
    ctx.fillRect = () => { insideStyles.push(ctx.fillStyle as string) }
    renderBoard(ctx, redInterior, world, 32)
    const yellowPieceColor = insideStyles[1] // 1 cell draw (size 1), then yellowPiece

    expect(redPieceColor).not.toBe(yellowPieceColor)
    expect(redPieceColor).not.toBe('#38bdf8') // neither is the plain container color
    expect(yellowPieceColor).not.toBe('#38bdf8')
  })

  it('does not color an ordinary container that merely owns an unrelated board, even when a real cycle exists on the same board', () => {
    const root = makeFloorBoard('root', 3)
    const obstacleInside = makeFloorBoard('obstacleInside', 1)
    const world = makeWorld(
      [root, obstacleInside],
      [
        { id: 'loopBox', kind: 'container', boardRef: 'root' }, // genuine self-loop
        { id: 'obstacleContainer', kind: 'container', boardRef: 'obstacleInside' }, // ordinary, unrelated
      ],
      {
        loopBox: { board: 'root', x: 0, y: 0 },
        obstacleContainer: { board: 'root', x: 1, y: 0 },
      },
    )
    const ctx = mockContext()
    const styles: string[] = []
    ctx.fillRect = () => { styles.push(ctx.fillStyle as string) }
    renderBoard(ctx, root, world, 32)
    // 9 cell draws (3x3), then loopBox, then obstacleContainer
    expect(styles[10]).toBe('#38bdf8') // obstacleContainer: plain container color
    expect(styles[9]).not.toBe('#38bdf8') // loopBox: cycle color
  })
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: FAIL — today's `isSelfLoopBox` only recognizes the single-node case, so
`redPiece`/`yellowPiece` (neither of which is self-referencing) both render as plain
containers (same color, and equal to `'#38bdf8'`), failing the first new test.

- [ ] **Step 3: Implement the change**

In `src/game/render/CanvasRenderer.ts`, replace:

```ts
import { Board, PieceKind, World } from '../engine/types'

const FLOOR_COLOR = '#1e293b'
const WALL_COLOR = '#0f172a'
const REQUIREMENT_OVERLAY: Record<'box' | 'player', string> = {
  box: '#334155',
  player: '#4c1d95',
}
const PIECE_COLORS: Record<PieceKind, string> = {
  normal: '#f59e0b',
  container: '#38bdf8',
  player: '#f472b6',
}
// A self-loop box isn't a distinct PieceKind (it's an ordinary 'container'
// whose boardRef happens to equal the board it's standing on) — see
// worldEdit.ts's placeSelfLoopBox and rules.ts's cycle detection. It still
// needs a visibly different color from a normal container: it's a genuine
// trap (push it flush against an edge and anything exiting through that
// edge, including the player, falls into unresolvable infinite regress and
// is removed from the world), and rendering it identically to a harmless
// container would make that invisible until it kills you.
const SELF_LOOP_COLOR = '#a855f7'

function isSelfLoopBox(pieceId: string, world: World): boolean {
  const piece = world.pieces[pieceId]
  return (
    piece.kind === 'container' &&
    piece.boardRef !== undefined &&
    world.locations[pieceId]?.board === piece.boardRef
  )
}
```

with:

```ts
import { Board, BoardId, PieceId, PieceKind, World, findContainerFor } from '../engine/types'

const FLOOR_COLOR = '#1e293b'
const WALL_COLOR = '#0f172a'
const REQUIREMENT_OVERLAY: Record<'box' | 'player', string> = {
  box: '#334155',
  player: '#4c1d95',
}
const PIECE_COLORS: Record<PieceKind, string> = {
  normal: '#f59e0b',
  container: '#38bdf8',
  player: '#f472b6',
}
// A container that's part of a containment cycle (a self-loop, or a longer
// ring of several containers each owning the next) isn't a distinct
// PieceKind — see worldEdit.ts's placeSelfLoopBox and rules.ts's cycle
// detection. It still needs a visibly different color from an ordinary
// container: pushing it (or anything else) flush against the edge that
// closes the ring is a genuine trap (unresolvable infinite regress, the
// piece attempting it removed from the world), and rendering it identically
// to a harmless container would make that invisible until it kills you.
// This is a visual distinction AID, not a uniqueness guarantee: for a ring
// bigger than the palette, or on a hash collision, two members can share a
// color. Every level this codebase ships has at most two cycle members.
const CYCLE_PALETTE = ['#ef4444', '#eab308', '#a855f7', '#14b8a6', '#f97316']

function isCycleMember(pieceId: PieceId, world: World): boolean {
  const piece = world.pieces[pieceId]
  if (piece.kind !== 'container' || piece.boardRef === undefined) return false
  const start = piece.boardRef
  let current: BoardId = start
  const seen = new Set<BoardId>()
  while (!seen.has(current)) {
    seen.add(current)
    const owner = findContainerFor(world, current)
    if (owner === undefined) return false
    const ownerLoc = world.locations[owner]
    if (ownerLoc === undefined) return false
    current = ownerLoc.board
  }
  return current === start
}

function cycleColorFor(pieceId: PieceId): string {
  let hash = 0
  for (const ch of pieceId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return CYCLE_PALETTE[hash % CYCLE_PALETTE.length]
}
```

Then, in `renderBoard`, replace the piece-drawing loop's color selection:

```ts
    ctx.fillStyle = isSelfLoopBox(pieceId, world) ? SELF_LOOP_COLOR : PIECE_COLORS[piece.kind]
```

with:

```ts
    ctx.fillStyle = isCycleMember(pieceId, world) ? cycleColorFor(pieceId) : PIECE_COLORS[piece.kind]
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: PASS — all tests, including the pre-existing self-loop test (a 1-node ring
still gets a palette color, still different from `'#38bdf8'`) and the two new ones.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/game/render/CanvasRenderer.ts src/game/render/CanvasRenderer.test.ts
git commit -m "feat(game): color-code every cycle member, not just single-node self-loops"
```

---

### Task 6: Replace `08-nested-loop.json` with a verified two-node-cycle demo level

**Files:**
- Delete: `src/levels/builtin/08-nested-loop.json`
- Create: `src/levels/builtin/08-two-node-cycle.json`
- Modify: `src/levels/index.ts`
- Modify: `src/levels/index.test.ts`

**Interfaces:**
- No code interfaces — this is level content. Depends on Tasks 1-5 being in place (this
  shape is rejected by `parseLevel` until Task 1 lands).

- [ ] **Step 1: Write the failing test**

In `src/levels/index.test.ts`, the existing `'includes the expected level ids in order'`
test's array needs `'08-nested-loop'` replaced with `'08-two-node-cycle'`:

```ts
  it('includes the expected level ids in order', () => {
    expect(BUILTIN_LEVELS.map((l) => l.id)).toEqual([
      '01-first-push',
      '02-enter-container',
      '03-chain-push',
      '04-eat',
      '05-double-nested',
      '06-self-loop',
      '07-loop-eats-container',
      '08-two-node-cycle',
    ])
  })
```

(The `'has one entry per shipped level file...'` test's `toHaveLength(8)` and per-level
`checkWin`/`locations[PLAYER_ID]` assertions need no changes — still 8 levels.)

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/levels/index.test.ts`
Expected: FAIL — `08-nested-loop.json` still exists and is still imported/registered, so
the id list doesn't match yet, and even after removing the import (next step) the new
file doesn't exist yet, which would fail to build.

- [ ] **Step 3: Delete the old level, add the new one**

Delete `src/levels/builtin/08-nested-loop.json`.

Create `src/levels/builtin/08-two-node-cycle.json` — this is the exact shape verified
against the real engine in the spec's "Worked example" section (hand-constructed as a
`World` and played via `applyMove` directly, confirming the 3-move win sequence, before
`levelSchema.ts` could even accept it):

```json
{
  "boards": {
    "root": {
      "id": "root",
      "size": 4,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor", "requirement": "player" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    },
    "redInterior": {
      "id": "redInterior",
      "size": 4,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    }
  },
  "pieces": {
    "player": { "id": "player", "kind": "player" },
    "box1": { "id": "box1", "kind": "normal" },
    "redPiece": { "id": "redPiece", "kind": "container", "boardRef": "redInterior" },
    "yellowPiece": { "id": "yellowPiece", "kind": "container", "boardRef": "root" }
  },
  "locations": {
    "player": { "board": "root", "x": 0, "y": 0 },
    "box1": { "board": "root", "x": 1, "y": 0 },
    "redPiece": { "board": "root", "x": 3, "y": 1 },
    "yellowPiece": { "board": "redInterior", "x": 3, "y": 1 }
  }
}
```

In `src/levels/index.ts`, replace the level 08 import:

```ts
import level08 from './builtin/08-nested-loop.json?raw'
```

with:

```ts
import level08 from './builtin/08-two-node-cycle.json?raw'
```

and the level 08 entry in `BUILTIN_LEVELS`:

```ts
  { id: '08-nested-loop', name: '嵌套循环', world: parseLevel(JSON.parse(level08)) },
```

with:

```ts
  { id: '08-two-node-cycle', name: '双节点循环', world: parseLevel(JSON.parse(level08)) },
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/levels/index.test.ts`
Expected: PASS — including the pre-existing `'every generated level is solvable'` test
(unaffected — that's about `loadGeneratedLevels()`, a completely separate set of files)
and the id-order test with the new name.

As an extra sanity check beyond the test suite (this level's specific win path was only
ever verified with a hand-built `World`, not through `parseLevel` — confirm the two now
agree), write a short one-off script, run it, then delete it — do not commit it:

```ts
// scratch-verify-08.ts (temporary — delete after running)
import { readFileSync } from 'node:fs'
import { parseLevel } from './src/game/engine/levelSchema'
import { applyMove, checkWin } from './src/game/engine/rules'
import type { Direction } from './src/game/engine/types'

const world = parseLevel(JSON.parse(readFileSync('src/levels/builtin/08-two-node-cycle.json', 'utf-8')))
console.log('start win?', checkWin(world))
let w = world
for (const dir of ['right', 'right', 'right'] as Direction[]) {
  const next = applyMove(w, dir)
  if (next === null) throw new Error(`move ${dir} rejected`)
  w = next
}
console.log('final win?', checkWin(w))
if (!checkWin(w)) throw new Error('level does not win as expected')
console.log('OK')
```

Run with `npx tsx scratch-verify-08.ts`, confirm it prints `start win? false` and
`final win? true` and `OK`, then delete the script (`rm scratch-verify-08.ts`) — it
must not be committed.

- [ ] **Step 5: Full suite, typecheck, and commit**

Run: `npx vitest run` — expect the entire project's test suite green.
Run: `npx tsc --noEmit -p tsconfig.json` — expect zero errors project-wide.

```bash
git add src/levels/builtin/08-two-node-cycle.json src/levels/index.ts src/levels/index.test.ts
git rm src/levels/builtin/08-nested-loop.json
git commit -m "feat(levels): replace 08-nested-loop with a verified two-node cycle demo"
```
