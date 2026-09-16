# Parabox Self-Loop Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the single self-referencing "loop" container box to the engine and editor: a container whose interior is the very board it's standing on, with a genuine infinite-regress trap when it's pushed flush against a board edge, and a loss state when the player falls into one.

**Architecture:** `computeTarget` (`rules.ts`) gains a `visited: Set<BoardId>` threaded through its recursive board-exit climb and an explicit `MoveTarget` tagged-union return type (`{kind:'location',...} | {kind:'infinite'} | null`), so it can classify "this exit provably can never resolve" without needing to know what that means. `tryMovePiece` is the only caller, and decides the current rule: an `infinite` classification removes the moving piece from the world via a new `removePiece` helper in `types.ts`. Everything downstream (`resolveBlocked`, `applyMove`, `GameState`) needs zero changes to compose this correctly — a "vanished" result is just an ordinary `World` missing one piece, which the existing push/move machinery already treats as a valid outcome. `checkLose` (new, symmetric to `checkWin`) reads "does the player have a location?" off that same `World`. `levelSchema.ts` is relaxed narrowly (self-referencing containers don't count toward board ownership) so this shape validates. `worldEdit.ts` gets a matching `placeSelfLoopBox` and a fix to `deletePieceRecursively` so deleting a self-loop piece never destroys the board it's also standing on. `EditorScreen.tsx` gets one new tool.

**Tech Stack:** TypeScript (strict), Vitest, React 18 + @testing-library/react (for the two UI tasks).

**Spec:** `docs/superpowers/specs/2026-09-17-parabox-self-loop-box-design.md`

## Global Constraints

- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true` in `tsconfig.json` — every import and parameter must be used, or `npx tsc --noEmit` fails on any file this plan touches.
- The root board's id is always the literal string `'root'`. `PLAYER_ID` (`'player'`) is the one reserved, fixed piece id.
- Engine tests (`src/game/engine/*.test.ts`) build worlds with `makeFloorBoard`, `makeWorld`, `setWall`, `setRequirement` from `src/game/engine/testFixtures.ts` — use these, don't hand-roll board/world object literals.
- A self-referencing container piece is defined precisely as: `locations[piece.id].board === piece.boardRef`. This exact predicate is duplicated in three places on purpose (`levelSchema.ts`'s ownership count, `worldEdit.ts`'s `deletePieceRecursively`, and implicitly by `computeTarget`'s cycle check) — each is a small, independently-testable check in a different file with a different job; do not try to unify them into one shared helper.
- Existing files this plan does NOT touch: `src/game/render/CanvasRenderer.ts`, `src/App.tsx`, `tools/generator/*`, `src/game/engine/fraction.ts`.
- Out of scope entirely (do not build toward it, per the spec): an authored "infinity destination" marker on a container (sub-project 7), and general multi-board cycles beyond the one regression test proving they're still rejected.

---

### Task 1: `types.ts` — `removePiece` helper

**Files:**
- Modify: `src/game/engine/types.ts`
- Modify: `src/game/engine/types.test.ts`

**Interfaces:**
- Produces (used by Task 2): `removePiece(world: World, pieceId: PieceId): World` — clones the world, deletes both the `pieces[pieceId]` and `locations[pieceId]` entries, returns the clone. The original `world` is left untouched (same immutability convention as `moveTo`, right above it).

- [ ] **Step 1: Write the failing test**

Add to `src/game/engine/types.test.ts`. First, add `removePiece` to the existing import line:

```ts
import { inBounds, opposite, step, occupantAt, findContainerFor, moveTo, removePiece, PLAYER_ID, World } from './types'
```

Then append at the end of the file:

```ts
describe('removePiece', () => {
  it('deletes the piece and its location, leaving other pieces and the original world untouched', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 3)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'box1', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        box1: { board: 'root', x: 1, y: 0 },
      },
    )
    const next = removePiece(world, PLAYER_ID)
    expect(next.pieces[PLAYER_ID]).toBeUndefined()
    expect(next.locations[PLAYER_ID]).toBeUndefined()
    expect(next.pieces.box1).toEqual({ id: 'box1', kind: 'normal' })
    expect(next.locations.box1).toEqual({ board: 'root', x: 1, y: 0 })
    expect(world.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 0 })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: FAIL — `removePiece` is not exported from `./types`.

- [ ] **Step 3: Implement `removePiece`**

Append to `src/game/engine/types.ts`, directly after the existing `moveTo` function:

```ts
export function removePiece(world: World, pieceId: PieceId): World {
  const next = cloneWorld(world)
  delete next.pieces[pieceId]
  delete next.locations[pieceId]
  return next
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/game/engine/types.ts src/game/engine/types.test.ts
git commit -m "feat(engine): add removePiece helper"
```

---

### Task 2: `rules.ts` — cycle detection, `MoveTarget`, `removePiece` wiring, `checkLose`

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `removePiece` (Task 1, `./types`).
- Produces: `export type MoveTarget = { kind: 'location'; location: Location; relativeCoord: Fraction } | { kind: 'infinite' } | null`; `computeTarget(...): MoveTarget` (same name, new return type, one new optional 5th parameter); `checkLose(world: World): boolean`. `tryMovePiece`'s own signature (`World | null`) is unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/game/engine/rules.test.ts`, first update imports:

```ts
import { computeTarget, getEntryCell, applyMove, tryEnter, tryMovePiece, resolveBlocked, checkWin, checkLose } from './rules'
import { HALF, makeFraction, ZERO, ONE } from './fraction'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from './testFixtures'
import { PLAYER_ID, removePiece } from './types'
```

Then **update the four existing `computeTarget` tests** whose expectations are a bare `{ location, relativeCoord }` object — `computeTarget` now returns a tagged union, so each needs `kind: 'location'` added. Replace this block (the `describe('computeTarget', ...)` block, all four `it`s that currently return a non-null result — the fifth, "fails to exit a board nothing else contains," already expects `toBeNull()` and needs no change):

```ts
describe('computeTarget', () => {
  it('returns the adjacent cell unchanged when it stays within the board', () => {
    const world = makeWorld([makeFloorBoard('root', 3)], [], {})
    const result = computeTarget(world, { board: 'root', x: 1, y: 1 }, 'right', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 2, y: 1 }, relativeCoord: HALF })
  })

  it('exits into the parent board through the container piece that owns this board', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('boardA', 3)],
      [{ id: 'boxA', kind: 'container', boardRef: 'boardA' }],
      { boxA: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'boardA', x: 1, y: 0 }, 'up', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 1, y: 0 }, relativeCoord: HALF })
  })

  it('produces a non-center fraction when exiting from an off-center column', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('boardA', 3)],
      [{ id: 'boxA', kind: 'container', boardRef: 'boardA' }],
      { boxA: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'boardA', x: 0, y: 0 }, 'up', HALF)
    expect(result).toEqual({
      kind: 'location',
      location: { board: 'root', x: 1, y: 0 },
      relativeCoord: makeFraction(1, 6),
    })
  })

  it('fails to exit a board nothing else contains (e.g. the root board)', () => {
    const world = makeWorld([makeFloorBoard('root', 3)], [], {})
    const result = computeTarget(world, { board: 'root', x: 0, y: 1 }, 'left', HALF)
    expect(result).toBeNull()
  })

  it('crosses two board boundaries in a single call, chaining through two containers', () => {
    const root = makeFloorBoard('root', 3)
    const boardB = makeFloorBoard('boardB', 3)
    const boardC = makeFloorBoard('boardC', 3)
    const world = makeWorld(
      [root, boardB, boardC],
      [
        { id: 'boxB', kind: 'container', boardRef: 'boardB' },
        { id: 'boxC', kind: 'container', boardRef: 'boardC' },
      ],
      {
        boxB: { board: 'root', x: 1, y: 1 },
        boxC: { board: 'boardB', x: 0, y: 1 },
      },
    )
    const result = computeTarget(world, { board: 'boardC', x: 0, y: 1 }, 'left', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 0, y: 1 }, relativeCoord: HALF })
  })

  it('classifies as infinite when the recursive exit repeats the same out-of-bounds board', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root' }],
      { loopBox: { board: 'root', x: 0, y: 1 } }, // flush against the left edge
    )
    const result = computeTarget(world, { board: 'root', x: 0, y: 0 }, 'left', HALF)
    expect(result).toEqual({ kind: 'infinite' })
  })

  it('resolves as a normal wrap when the recursive owner position lands in bounds', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root' }],
      { loopBox: { board: 'root', x: 0, y: 1 } }, // flush left, but not flush top/bottom
    )
    const result = computeTarget(world, { board: 'root', x: 0, y: 0 }, 'up', HALF)
    expect(result).toEqual({
      kind: 'location',
      location: { board: 'root', x: 0, y: 0 },
      relativeCoord: makeFraction(1, 6),
    })
  })
})
```

Next, **update the stale comment** on the `tryEnter` direct-guard test (its assertions are unchanged, only the comment needs fixing — it currently claims a self-referencing board would hang `computeTarget` forever, which this task makes untrue). Replace the comment block above `it('tryEnter refuses to enter a container already marked as being entered, without recursing', ...)`:

```ts
  it('tryEnter refuses to enter a container already marked as being entered, without recursing', () => {
    // This is a direct unit test of the beingEntered guard's own
    // short-circuit line, not a black-box test through applyMove — nothing
    // that calls tryEnter naturally re-enters the same container within one
    // move today, so there's no organic way to reach this line through
    // applyMove alone. Call tryEnter directly with a beingEntered set that
    // already contains the target container's id, and assert the guard's
    // own `if (beingEntered.has(intoId)) return null` line fires
    // immediately — no push, no board traversal.
    //
    // This guard is unrelated to computeTarget's own cycle detection (its
    // `visited` set, added for self-referencing "loop" boxes — see the
    // computeTarget tests above): that detects a board-EXIT climb repeating
    // a board it already left, not a re-entry. A self-referencing
    // container's own board-exit climb is now handled correctly (it
    // resolves to `{ kind: 'infinite' }` rather than hanging), so the
    // original reason this test avoided that construction no longer
    // applies — but calling the guard directly is still the more precise
    // test of this specific line, so the approach is unchanged.
```

(Leave the rest of that test's body exactly as it is — only the comment changes.)

Finally, **append** these new tests to the end of the file:

```ts
describe('tryMovePiece / applyMove — infinite regress', () => {
  it('removes the player directly when its own move resolves to infinite', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        loopBox: { board: 'root', x: 0, y: 0 }, // flush corner
      },
    )
    const next = applyMove(world, 'left')
    expect(next).not.toBeNull()
    expect(next?.locations[PLAYER_ID]).toBeUndefined()
    expect(next?.pieces[PLAYER_ID]).toBeUndefined()
  })

  it('walking through a self-loop box via a non-flush edge wraps to a different cell of the same board, without crashing', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        loopBox: { board: 'root', x: 1, y: 1 }, // center — not flush against any edge
      },
    )
    const next = applyMove(world, 'up')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
    expect(next?.locations.loopBox).toEqual({ board: 'root', x: 1, y: 1 })
  })

  it('removes a self-loop box pushed flush against the board it owns, letting the pusher complete its move', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 1, y: 1 },
        loopBox: { board: 'root', x: 2, y: 1 }, // already flush against the right edge
      },
    )
    const next = applyMove(world, 'right')
    expect(next).not.toBeNull()
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 2, y: 1 })
    expect(next?.locations.loopBox).toBeUndefined()
    expect(next?.pieces.loopBox).toBeUndefined()
  })

  it('resolveBlocked removes the player when pushing it resolves to infinite, treating it the same as any other piece', () => {
    // Constructing an organic applyMove scenario where the player ends up as
    // a *pushed* occupant (rather than the move's own top-level mover) needs
    // a multi-board container-entry setup elaborate enough to obscure the
    // actual thing being tested. Call resolveBlocked directly instead, with
    // the player as the occupant being pushed into a self-loop trap.
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: 'pusher', kind: 'normal' },
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        pusher: { board: 'root', x: 1, y: 0 },
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, // flush against the left edge
        loopBox: { board: 'root', x: 0, y: 1 },     // also flush left — same climb, same result
      },
    )
    const target = computeTarget(world, world.locations.pusher, 'left', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup: pusher must have a valid target')
    const result = resolveBlocked(world, 'pusher', PLAYER_ID, target, 'left', new Map(), new Set())
    expect(result?.locations.pusher).toEqual({ board: 'root', x: 0, y: 0 })
    expect(result?.locations[PLAYER_ID]).toBeUndefined()
    expect(result?.pieces[PLAYER_ID]).toBeUndefined()
    expect(result?.locations.loopBox).toEqual({ board: 'root', x: 0, y: 1 })
  })
})

describe('checkLose', () => {
  it('is true only when the player has no location', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    expect(checkLose(world)).toBe(false)
    const next = removePiece(world, PLAYER_ID)
    expect(checkLose(next)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL — `resolveBlocked` isn't exported for direct import yet in this test file's context (it already is exported from `rules.ts`, so this specific import should actually resolve; the real failures are: `checkLose` doesn't exist yet, `MoveTarget`'s `kind` field doesn't exist so the four updated assertions and the two new computeTarget tests fail their `toEqual` comparisons, and the infinite-regress `describe` block's assertions fail since nothing is ever removed today).

- [ ] **Step 3: Implement the changes in `rules.ts`**

First, update the imports at the top of the file:

```ts
import { Fraction, addInt, divideByInt, multiplyByInt, isZero, fractionDivMod, makeFraction, HALF } from './fraction'
import {
  World, Location, Direction, Board, BoardId, Piece, PieceId,
  inBounds, step, findContainerFor, occupantAt, moveTo, removePiece, opposite, PLAYER_ID,
} from './types'
```

Replace the existing `computeTarget` function with:

```ts
export type MoveTarget =
  | { kind: 'location'; location: Location; relativeCoord: Fraction }
  | { kind: 'infinite' }
  | null // blocked: no owner to climb through (e.g. the true root boundary)

export function computeTarget(
  world: World,
  loc: Location,
  dir: Direction,
  relativeCoord: Fraction,
  visited: Set<BoardId> = new Set(),
): MoveTarget {
  const board = world.boards[loc.board]
  const { x, y } = step(loc.x, loc.y, dir)

  // inBounds MUST be checked before visited — a legitimate "wrap" (the
  // recursive owner position happens to be in bounds) is not a cycle, even
  // if loc.board has been visited before in this climb. Checking visited
  // first would misclassify every ordinary self-loop wrap as infinite.
  if (inBounds(board, x, y)) {
    return { kind: 'location', location: { board: loc.board, x, y }, relativeCoord }
  }

  if (visited.has(loc.board)) return { kind: 'infinite' }
  visited.add(loc.board)

  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null

  const offset = dir === 'up' || dir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)

  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, dir, newRelativeCoord, visited)
}
```

Replace the existing `tryMovePiece` function's body (the signature is unchanged) with:

```ts
export function tryMovePiece(
  world: World,
  pieceId: PieceId,
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const already = inMotion.get(pieceId)
  if (already !== undefined) {
    return already === dir ? world : null
  }

  const loc = world.locations[pieceId]
  const target = computeTarget(world, loc, dir, HALF)
  if (target === null) return null
  // The transition can never resolve to a real location — the piece
  // attempting it is removed instead. If pieceId is PLAYER_ID, this is how
  // a loss actually happens (checkLose reads the resulting world). If it's
  // any other piece, resolveBlocked's existing "pushed succeeded" path
  // (moveTo(pushed, pieceId, target.location)) already treats a non-null
  // return as a completed push, so the pusher still ends up at its own
  // target cell while the pushed piece simply vanishes — no change needed
  // there.
  if (target.kind === 'infinite') return removePiece(world, pieceId)

  const targetBoard = world.boards[target.location.board]
  if (targetBoard.cells[target.location.y][target.location.x].type === 'wall') return null

  const occupant = occupantAt(world, target.location)
  if (!occupant) return moveTo(world, pieceId, target.location)

  return resolveBlocked(world, pieceId, occupant, target, dir, inMotion, beingEntered)
}
```

Finally, append `checkLose` at the end of the file, after `checkWin`:

```ts
export function checkLose(world: World): boolean {
  return world.locations[PLAYER_ID] === undefined
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS — all tests green, including the updated and new ones.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json` — pay attention to any other file that imports `computeTarget` and destructures/type-annotates its return value directly (none currently do outside `rules.ts` and this test file, but confirm).

```bash
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): detect self-loop infinite regress, remove the piece that hits it"
```

---

### Task 3: `levelSchema.ts` — exclude self-references from board ownership

**Files:**
- Modify: `src/game/engine/levelSchema.ts`
- Modify: `src/game/engine/levelSchema.test.ts`

**Interfaces:**
- No new exports. `parseLevel`'s signature and behavior for every existing valid/invalid shape are unchanged; only self-referencing containers newly validate differently.

- [ ] **Step 1: Write the failing tests**

In `src/game/engine/levelSchema.test.ts`, **replace** the existing test `'rejects a container whose interior is the board it is itself located on (self-referential cycle)'` (it currently expects `.toThrow(/reachable/i)` — under this task's change, this exact shape is still rejected, but for a different reason: the board now has zero owners, same as root, caught by the ownership check before reachability is even walked) with:

```ts
  it('rejects a self-referencing container on a non-root board with no external owner', () => {
    // cx self-references board x (its own interior is the very board it
    // sits on), and nothing else references x at all — self-references are
    // excluded from the owner tally (see levelSchema.ts), so x has zero
    // owners, same as root. Two boards with zero owners is exactly as
    // invalid as it always was; only the specific error changed (caught by
    // the "exactly one owner-less board" ownership check now, before
    // reachability is even walked).
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
    expect(() => parseLevel(data)).toThrow(/owner/i)
  })

  it('accepts a self-referencing container on the root board', () => {
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
    const data = serializeLevel(world)
    expect(parseLevel(data)).toEqual(world)
  })

  it('accepts a self-referencing container on a non-root board that also has a real external owner', () => {
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
    expect(parseLevel(data)).toEqual(world)
  })
```

The existing test `'rejects a mutual two-board containment cycle'`, directly below, needs **no change** — it already covers this task's required "an unrelated general cycle is still rejected" regression, and its behavior is unaffected by this task (neither piece in that fixture is self-referencing).

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: FAIL — the renamed test still throws `/reachable/i` today (not yet `/owner/i`), and the two new "accepts" tests currently throw (self-loop on root currently breaks the single-root invariant; self-loop with an external owner currently trips "more than one owner").

- [ ] **Step 3: Implement the change**

In `src/game/engine/levelSchema.ts`, replace the existing ownership-count loop:

```ts
  const ownerCount: Record<string, number> = Object.fromEntries(
    Object.keys(boards).map((boardId) => [boardId, 0]),
  )
  for (const piece of Object.values(pieces)) {
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
      ownerCount[piece.boardRef] = (ownerCount[piece.boardRef] ?? 0) + 1
    }
  }
```

with:

```ts
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
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/game/engine/levelSchema.ts src/game/engine/levelSchema.test.ts
git commit -m "feat(engine): allow a self-referencing container to own its own board"
```

---

### Task 4: `worldEdit.ts` — safe deletion + `placeSelfLoopBox`

**Files:**
- Modify: `src/editor/worldEdit.ts`
- Modify: `src/editor/worldEdit.test.ts`

**Interfaces:**
- Consumes: nothing new (uses the same imports already in the file).
- Produces (used by Task 5): `placeSelfLoopBox(world: World, boardId: BoardId, x: number, y: number, ids: EditorIds): { world: World; ids: EditorIds } | null` — same shape as `placeNormalBox`/`placeContainerBox`, but only `ids.nextBoxId` ever advances (no board is allocated), and `boardRef` is set to `boardId` itself.
- `deletePieceRecursively`'s exported signature is unchanged; its behavior for a self-referencing piece changes (single-piece deletion only).

- [ ] **Step 1: Write the failing tests**

Append to `src/editor/worldEdit.test.ts`:

```ts
test('placeSelfLoopBox places a piece whose interior is the board it is placed on, allocating no new board', () => {
  const world = createEmptyWorld(6)
  const result = placeSelfLoopBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 })!
  expect(result.world.pieces['box-0']).toEqual({ id: 'box-0', kind: 'container', boardRef: 'root' })
  expect(result.world.locations['box-0']).toEqual({ board: 'root', x: 1, y: 1 })
  expect(result.ids).toEqual({ nextBoxId: 1, nextBoardId: 0 })
  expect(Object.keys(result.world.boards)).toEqual(['root'])
})

test('placeSelfLoopBox works on the root board', () => {
  const world = createEmptyWorld(6)
  const result = placeSelfLoopBox(world, 'root', 0, 0, { nextBoxId: 0, nextBoardId: 0 })
  expect(result).not.toBeNull()
})

test('placeSelfLoopBox is blocked when the target cell holds the player', () => {
  const world = createEmptyWorld(6)
  const result = placeSelfLoopBox(world, 'root', 5, 5, { nextBoxId: 0, nextBoardId: 0 })
  expect(result).toBeNull()
})

test('deletePieceRecursively deleting a self-referencing piece leaves its board and everything else on it intact', () => {
  const world = createEmptyWorld(6) // player defaults to (5, 5)
  const withBox = placeNormalBox(world, 'root', 2, 2, { nextBoxId: 0, nextBoardId: 0 })!
  const withLoop = placeSelfLoopBox(withBox.world, 'root', 1, 1, withBox.ids)!

  const next = deletePieceRecursively(withLoop.world, 'box-1') // box-1 is the self-loop piece

  expect(next.pieces['box-1']).toBeUndefined()
  expect(next.locations['box-1']).toBeUndefined()
  expect(next.pieces['box-0']).toEqual({ id: 'box-0', kind: 'normal' }) // ordinary box survives
  expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 5, y: 5 }) // player survives
  expect(next.boards.root).toBeDefined() // the board itself survives
})

test("deletePieceRecursively deleting a board's external owner still cascades through a self-referencing piece inside it", () => {
  const world = createEmptyWorld(6)
  const outer = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  const withLoop = placeSelfLoopBox(outer.world, 'board-0', 0, 0, outer.ids)! // self-loop inside board-0

  const next = deletePieceRecursively(withLoop.world, 'box-0') // box-0 is the external owner of board-0

  expect(next.pieces['box-0']).toBeUndefined()
  expect(next.pieces['box-1']).toBeUndefined() // the self-loop piece inside is swept up too
  expect(next.boards['board-0']).toBeUndefined()
})
```

Update the top import to add `placeSelfLoopBox` (keep every other existing named import in that list exactly as it is — `canPlacePieceAt`, `createEmptyBoard`, etc. — this only adds one new name):

```ts
import {
  canPlacePieceAt,
  createEmptyBoard,
  createEmptyWorld,
  deletePieceRecursively,
  movePlayer,
  placeContainerBox,
  placeNormalBox,
  placeSelfLoopBox,
  setCellType,
  setRequirement,
} from './worldEdit'
```

`PLAYER_ID` is already imported from `'../game/engine/types'` at the top of this file — no change needed there.

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/editor/worldEdit.test.ts`
Expected: FAIL — `placeSelfLoopBox` doesn't exist yet, and the two `deletePieceRecursively` self-reference tests fail against the current cascade-everything behavior.

- [ ] **Step 3: Implement the changes**

In `src/editor/worldEdit.ts`, replace the existing `deletePieceRecursively` function:

```ts
export function deletePieceRecursively(world: World, pieceId: PieceId): World {
  const next = cloneWorld(world)
  const stack: PieceId[] = [pieceId]
  while (stack.length > 0) {
    const id = stack.pop() as PieceId
    const piece = next.pieces[id]
    if (!piece) continue
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
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

Add `placeSelfLoopBox` after the existing `placeContainerBox` function:

```ts
export function placeSelfLoopBox(
  world: World,
  boardId: BoardId,
  x: number,
  y: number,
  ids: EditorIds,
): { world: World; ids: EditorIds } | null {
  const id = `box-${ids.nextBoxId}`
  const placed = placePiece(world, boardId, x, y, { id, kind: 'container', boardRef: boardId })
  if (!placed) return null
  return { world: placed, ids: { ...ids, nextBoxId: ids.nextBoxId + 1 } }
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/editor/worldEdit.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/editor/worldEdit.ts src/editor/worldEdit.test.ts
git commit -m "feat(editor): add placeSelfLoopBox, protect self-loop deletion from cascading"
```

---

### Task 5: `EditorScreen.tsx` — 自包箱 tool

**Files:**
- Modify: `src/editor/EditorScreen.tsx`
- Modify: `src/editor/EditorScreen.test.tsx`

**Interfaces:**
- Consumes: `placeSelfLoopBox` (Task 4, `./worldEdit`).
- No new exports; `EditorScreen`'s public signature is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/editor/EditorScreen.test.tsx`:

```ts
test('the self-loop-box tool places a container whose interior is its own board, even on root', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('自包箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('box-at-0-0')).toHaveTextContent('container')
  // No new board is allocated — the piece's interior is 'root' itself.
  expect(screen.getByTestId('board-ids')).toHaveTextContent('root')
  expect(screen.getByTestId('board-ids')).not.toHaveTextContent('board-0')
})
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: FAIL — there is no `自包箱` label yet.

- [ ] **Step 3: Implement the changes**

In `src/editor/EditorScreen.tsx`, update the `worldEdit` import to add `placeSelfLoopBox`:

```ts
import {
  EditorIds,
  canPlacePieceAt,
  createEmptyWorld,
  movePlayer,
  placeContainerBox,
  placeNormalBox,
  placeSelfLoopBox,
  setCellType,
  setRequirement,
} from './worldEdit'
```

Update the `Tool` type and `TOOLS` array:

```ts
type Tool = 'wall' | 'empty' | 'normal-box' | 'container-box' | 'self-loop-box' | 'player' | 'goal-box' | 'goal-player'

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'empty', label: '空地' },
  { tool: 'wall', label: '墙' },
  { tool: 'normal-box', label: '普通箱' },
  { tool: 'container-box', label: '容器箱' },
  { tool: 'self-loop-box', label: '自包箱' },
  { tool: 'goal-box', label: '目标(箱)' },
  { tool: 'goal-player', label: '目标(玩家)' },
  { tool: 'player', label: '玩家起点' },
]
```

In `placeAt`, add a new branch for `self-loop-box`, right before the existing `// normal-box / container-box` comment block (same structure as that block — no-op on an existing container, blocked-placement check before touching `idsRef`, id captured outside the updater):

```ts
    if (tool === 'self-loop-box') {
      const existingId = occupantAt(world, { board: activeBoardId, x, y })
      if (existingId && world.pieces[existingId].kind === 'container') return
      if (!canPlacePieceAt(world, activeBoardId, x, y)) return
      const oldIds = idsRef.current
      setWorld((w) => {
        const result = placeSelfLoopBox(w, activeBoardId, x, y, oldIds)
        if (!result) return w
        idsRef.current = result.ids
        return result.world
      })
      return
    }
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: PASS — all tests, including the new one.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/editor/EditorScreen.tsx src/editor/EditorScreen.test.tsx
git commit -m "feat(editor): add the self-loop-box tool"
```

---

### Task 6: `GameState.ts` — `isLost`

**Files:**
- Modify: `src/game/engine/GameState.ts`
- Modify: `src/game/engine/GameState.test.ts`

**Interfaces:**
- Consumes: `checkLose` (Task 2, `./rules`).
- Produces (used by Task 7): `get isLost(): boolean` on `GameState`.

- [ ] **Step 1: Write the failing test**

Append to `src/game/engine/GameState.test.ts`, inside the existing `describe('GameState', ...)` block:

```ts
  it('reports isLost after a move resolves into infinite regress, and undo recovers it', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        loopBox: { board: 'root', x: 0, y: 0 },
      },
    )
    const state = new GameState(world)
    expect(state.isLost).toBe(false)
    const ok = state.move('left')
    expect(ok).toBe(true) // the move succeeds — it just produces a world with no player
    expect(state.isLost).toBe(true)
    expect(state.undo()).toBe(true)
    expect(state.isLost).toBe(false)
    expect(state.current.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 1 })
  })
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: FAIL — `state.isLost` doesn't exist yet.

- [ ] **Step 3: Implement the change**

In `src/game/engine/GameState.ts`, update the import and add the getter:

```ts
import { World, Direction } from './types'
import { applyMove, checkLose, checkWin } from './rules'

export class GameState {
  private history: World[]

  constructor(initial: World) {
    this.history = [initial]
  }

  get current(): World {
    return this.history[this.history.length - 1]
  }

  get isWon(): boolean {
    return checkWin(this.current)
  }

  get isLost(): boolean {
    return checkLose(this.current)
  }

  get moveCount(): number {
    return this.history.length - 1
  }

  move(dir: Direction): boolean {
    const next = applyMove(this.current, dir)
    if (next === null) return false
    this.history.push(next)
    return true
  }

  undo(): boolean {
    if (this.history.length <= 1) return false
    this.history.pop()
    return true
  }
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/game/engine/GameState.ts src/game/engine/GameState.test.ts
git commit -m "feat(engine): add GameState.isLost"
```

---

### Task 7: `GameScreen.tsx` — lost notice

**Files:**
- Modify: `src/game/GameScreen.tsx`
- Modify: `src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: `state.isLost` (Task 6).
- No new exports; `GameScreen`'s public signature is unchanged.

- [ ] **Step 1: Write the failing test**

In `src/game/GameScreen.test.tsx`, update the import line to add `within`:

```ts
import { render, screen, within } from '@testing-library/react'
```

Append this test at the end of the file:

```ts
test('a move that removes the player shows a lost notice, and its button recovers via undo', async () => {
  const root = makeFloorBoard('root', 2)
  const world = makeWorld(
    [root],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'loopBox', kind: 'container', boardRef: 'root' },
    ],
    {
      [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
      loopBox: { board: 'root', x: 0, y: 0 },
    },
  )
  render(<GameScreen initialWorld={world} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('左'))
  const notice = screen.getByTestId('lose-notice')
  expect(within(notice).getByText('玩家迷失在无限递归中')).toBeInTheDocument()

  await user.click(within(notice).getByText('复位上一步'))
  expect(screen.queryByTestId('lose-notice')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: FAIL — there's no `lose-notice` element yet, and (without Step 3's fix) `state.current.locations[PLAYER_ID].board` would throw once the player is removed, since `GameScreen` currently reads the current board directly off the player's location every render.

- [ ] **Step 3: Implement the changes**

Replace the full contents of `src/game/GameScreen.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { GameState } from './engine/GameState'
import { Direction, PLAYER_ID, World } from './engine/types'
import { renderBoard } from './render/CanvasRenderer'
import { DPad } from '../ui/DPad'
import { SwipeLayer } from '../ui/SwipeLayer'

const CELL_SIZE = 32

export function GameScreen({
  initialWorld,
  onExit,
  onWin,
}: {
  initialWorld: World
  onExit: () => void
  onWin: () => void
}) {
  const stateRef = useRef<GameState>()
  if (!stateRef.current) stateRef.current = new GameState(initialWorld)
  const state = stateRef.current

  const [, setTick] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wonRef = useRef(false)
  // A lost move removes the player from `locations` entirely (see
  // rules.ts's checkLose), so there is no longer a board to read the
  // player's position from. Remember the last board the player actually
  // stood on so rendering can keep showing it (now without the player
  // drawn on it) instead of crashing on a missing location.
  const lastBoardIdRef = useRef(initialWorld.locations[PLAYER_ID].board)

  const handleMove = (direction: Direction) => {
    if (state.move(direction)) setTick((t) => t + 1)
  }

  const handleUndo = () => {
    if (state.undo()) {
      wonRef.current = false
      setTick((t) => t + 1)
    }
  }

  const playerLocation = state.current.locations[PLAYER_ID]
  if (playerLocation) lastBoardIdRef.current = playerLocation.board
  const currentBoardId = lastBoardIdRef.current
  const currentBoard = state.current.boards[currentBoardId]

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderBoard(ctx, currentBoard, state.current, CELL_SIZE)
  }, [state.current, currentBoard])

  useEffect(() => {
    if (state.isWon && !wonRef.current) {
      wonRef.current = true
      onWin()
    }
  }, [state.current, onWin])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      const direction = map[e.key]
      if (direction) handleMove(direction)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="game-screen">
      <div className="hud">
        <span>步数: {state.moveCount}</span>
        <button onClick={handleUndo}>复位上一步</button>
        <button onClick={onExit}>离开</button>
      </div>
      {state.isLost && (
        <div className="lose-notice" data-testid="lose-notice">
          <p>玩家迷失在无限递归中</p>
          <button onClick={handleUndo}>复位上一步</button>
        </div>
      )}
      <SwipeLayer onMove={handleMove}>
        <canvas ref={canvasRef} width={CELL_SIZE * currentBoard.size} height={CELL_SIZE * currentBoard.size} />
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: PASS — all tests, including the new one. (The HUD's own "复位上一步" button and the notice's button now share the same visible text — the test scopes its second click to `within(notice)` specifically to avoid ambiguity; the other existing tests only ever click the HUD button by text when no notice is present, so they're unaffected.)

- [ ] **Step 5: Full suite, typecheck, and commit**

Run: `npx vitest run` — expect the entire project's test suite green.
Run: `npx tsc --noEmit -p tsconfig.json` — expect zero errors project-wide.

```bash
git add src/game/GameScreen.tsx src/game/GameScreen.test.tsx
git commit -m "feat(game): show a lost notice when a move removes the player"
```
