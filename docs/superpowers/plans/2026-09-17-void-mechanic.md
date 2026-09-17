# Void Mechanic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "a piece that resolves to infinite recursion is deleted from the world" with a runtime Void: the piece is relocated into a shared, engine-synthesized board and marked `locked` (pushable as a whole, never enterable or mergeable again), and the now-permanently-unreachable loss mechanic (`checkLose`/`isLost`/lose-notice UI/`removePiece`) is retired in the same round.

**Architecture:** One new engine primitive (`sendToVoid`, replacing `removePiece`) plus a two-sided lock guard in `resolveBlocked`, both in `src/game/engine/`. A reserved board id check in the level parser. Deletion of the now-dead loss mechanic across the engine, `GameState`, and `GameScreen`. A rendering addition (a stroked ring for locked pieces) in `CanvasRenderer`.

**Tech Stack:** TypeScript, Vitest, React (GameScreen), Canvas 2D rendering.

**Spec:** `docs/superpowers/specs/2026-09-17-void-mechanic-design.md` — this plan argues from that spec; executors should read both, but every value/snippet needed to execute a task is reproduced in that task below.

## Global Constraints

- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true` in `tsconfig.json` — deleting `removePiece`/`checkLose`/`isLost` means every import/reference to them must also be deleted in the same commit that removes the definition, or the build fails.
- **The locked-interaction guard in `resolveBlocked` must check BOTH `pieceId` (the mover) and `occupantId` (the occupant) for `locked`.** The design's first draft only checked the occupant; a spec review caught that this lets a locked *moving* piece still fall through to enter/eat when its own push fails. Task 2 implements the two-sided form — do not regress to the one-sided form.
- `sendToVoid` must be atomic on failure: an unknown `pieceId`, an already-locked piece, or a full Void must all return `null` with the original `World` object completely untouched (no partial mutation observable through the input reference).
- The Void board (`id: 'void'`, `VOID_BOARD_ID`) is synthesized at runtime only. It must never be reachable through `parseLevel` on authored JSON (Task 3 enforces this) and never needs a change to `serializeLevel` (no code path in this repo serializes a live, mid-game `World`).
- Canvas context mocks in test files only define what earlier tests needed. Any test that exercises a locked piece's render path needs `ctx.strokeRect`, `ctx.save`, `ctx.restore`, `ctx.strokeStyle`, and `ctx.lineWidth` on the mock, or it will throw `ctx.save is not a function` (or similar) — this affects both `CanvasRenderer.test.ts`'s `mockContext()` (Task 6) and `GameScreen.test.tsx`'s `beforeEach` mock (Task 5, only if that task's new test actually renders a locked piece — see Task 5's notes).
- No task in this plan adds an automated regression proving the shipped `06-self-loop.json` through `09-cycle-branch.json` demo levels still WIN via their known solution move sequences (only that they still *parse* — that coverage already exists in `src/levels/index.test.ts` and is untouched by this plan). This is a real spec acceptance criterion ("Existing 06–09 demo levels still win exactly as before"). The final whole-branch review must explicitly verify it — e.g. a throwaway script per level, `parseLevel` + the level's known win sequence through `applyMove` + `checkWin`, run against the finished branch — not just infer it from Task 2's synthetic unit-level fixtures passing.

---

### Task 1: `types.ts` — Void board, `Piece.locked`, `sendToVoid` (replaces `removePiece`)

**Files:**
- Modify: `src/game/engine/types.ts`
- Modify: `src/game/engine/types.test.ts`

**Interfaces:**
- Produces: `export const VOID_BOARD_ID: BoardId = 'void'`; `export function sendToVoid(world: World, pieceId: PieceId): World | null`; `Piece.locked?: boolean` (new optional field on the existing `Piece` interface).
- Consumes: nothing new — this is the foundation task other tasks build on.
- `removePiece` is deleted by the end of this task. Task 2 (`rules.ts`) depends on `sendToVoid`/`VOID_BOARD_ID` existing; Task 3 (`levelSchema.ts`) depends on `VOID_BOARD_ID`; Task 6 (`CanvasRenderer.ts`) depends on `Piece.locked`.

- [ ] **Step 1: Write the failing tests for `sendToVoid`**

In `src/game/engine/types.test.ts`, change the import line to add `sendToVoid` and `VOID_BOARD_ID` (keep `removePiece` in the import for now — it's still deleted later in this same task, not yet):

```ts
import { inBounds, opposite, step, occupantAt, findContainerFor, moveTo, removePiece, sendToVoid, VOID_BOARD_ID, PLAYER_ID, World } from './types'
```

Add this new `describe` block anywhere after the existing `describe('moveTo', ...)` block (e.g. directly above the existing `describe('removePiece', ...)` block, which this task deletes in Step 5):

```ts
describe('sendToVoid', () => {
  it('synthesizes the Void board on first use: 5x5, walls on the perimeter, floor inside', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    const next = sendToVoid(world, 'box1')
    expect(next).not.toBeNull()
    const voidBoard = next!.boards[VOID_BOARD_ID]
    expect(voidBoard.id).toBe(VOID_BOARD_ID)
    expect(voidBoard.size).toBe(5)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const isPerimeter = x === 0 || y === 0 || x === 4 || y === 4
        expect(voidBoard.cells[y][x].type).toBe(isPerimeter ? 'wall' : 'floor')
      }
    }
  })

  it('places the first piece sent to the Void at the center cell and marks it locked', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    const next = sendToVoid(world, 'box1')
    expect(next?.locations.box1).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 })
    expect(next?.pieces.box1).toEqual({ id: 'box1', kind: 'normal', locked: true })
  })

  it('reuses the existing Void board and places a second piece at the next free cell, without disturbing the first', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2)],
      [
        { id: 'box1', kind: 'normal' },
        { id: 'box2', kind: 'normal' },
      ],
      {
        box1: { board: 'root', x: 0, y: 0 },
        box2: { board: 'root', x: 1, y: 0 },
      },
    )
    const afterFirst = sendToVoid(world, 'box1')!
    const afterSecond = sendToVoid(afterFirst, 'box2')!
    expect(afterSecond.locations.box1).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 }) // unchanged
    expect(afterSecond.locations.box2).toEqual({ board: VOID_BOARD_ID, x: 1, y: 1 }) // next in VOID_CELL_ORDER
    expect(afterSecond.pieces.box2).toEqual({ id: 'box2', kind: 'normal', locked: true })
    expect(afterSecond.boards[VOID_BOARD_ID]).toEqual(afterFirst.boards[VOID_BOARD_ID]) // same board, not recreated
  })

  it('rejects an unknown pieceId with null, mutating nothing', () => {
    const world: World = makeWorld([makeFloorBoard('root', 2)], [], {})
    expect(sendToVoid(world, 'nope')).toBeNull()
  })

  it('rejects an already-locked piece with null and does not move it', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), { id: VOID_BOARD_ID, size: 5, cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'floor' as const }))) }],
      [{ id: 'box1', kind: 'normal', locked: true }],
      { box1: { board: VOID_BOARD_ID, x: 2, y: 2 } },
    )
    expect(sendToVoid(world, 'box1')).toBeNull()
    expect(world.locations.box1).toEqual({ board: VOID_BOARD_ID, x: 2, y: 2 }) // unchanged
  })

  it('returns null and leaves the original world untouched when all 9 interior cells are already occupied', () => {
    const voidCells: { x: number; y: number }[] = [
      { x: 2, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
    ]
    const voidBoard = {
      id: VOID_BOARD_ID,
      size: 5,
      cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'floor' as const }))),
    }
    const fillerPieces = voidCells.map((_, i) => ({ id: `filler${i}`, kind: 'normal' as const, locked: true }))
    const fillerLocations = Object.fromEntries(
      voidCells.map(({ x, y }, i) => [`filler${i}`, { board: VOID_BOARD_ID, x, y }]),
    )
    const world: World = makeWorld(
      [makeFloorBoard('root', 2), voidBoard],
      [{ id: 'box1', kind: 'normal' }, ...fillerPieces],
      { box1: { board: 'root', x: 0, y: 0 }, ...fillerLocations },
    )
    const result = sendToVoid(world, 'box1')
    expect(result).toBeNull()
    expect(world.locations.box1).toEqual({ board: 'root', x: 0, y: 0 }) // untouched
    expect(world.pieces.box1).toEqual({ id: 'box1', kind: 'normal' }) // not marked locked
  })
})
```

- [ ] **Step 2: Run and confirm the new tests fail**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: FAIL — `sendToVoid` and `VOID_BOARD_ID` don't exist yet (import error / `is not a function`).

- [ ] **Step 3: Implement `VOID_BOARD_ID`, `makeVoidBoard`, `Piece.locked`, `sendToVoid`**

In `src/game/engine/types.ts`, add `locked?: boolean` to the `Piece` interface (currently lines 21-25):

```ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId // present only when kind === 'container'
  locked?: boolean    // runtime-only; true only after sendToVoid — see below
}
```

Replace `removePiece` (currently the last thing in the file, lines 89-95) with:

```ts
export const VOID_BOARD_ID: BoardId = 'void'

function makeVoidBoard(): Board {
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      type: (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 'wall' : 'floor') as CellType,
    })),
  )
  return { id: VOID_BOARD_ID, size, cells }
}

// Fixed search order for a free interior cell in the Void: center first (the
// natural first landing spot), then the remaining 8 interior cells in a fixed,
// deterministic order. Deterministic so tests can predict exactly where any
// given piece lands without needing to special-case "first vs. second piece."
const VOID_CELL_ORDER: Array<{ x: number; y: number }> = [
  { x: 2, y: 2 },
  { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
  { x: 1, y: 2 },                 { x: 3, y: 2 },
  { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
]

// A piece that resolves to infinite recursion is relocated into the shared Void
// board instead of being deleted from the world (see removePiece, now gone — this
// replaces its only caller). It's marked `locked`, which resolveBlocked reads to
// keep it pushable but never enterable/mergeable again. Rejects (returns null, no
// mutation) an unknown pieceId, an already-locked piece (a piece is only ever sent
// to the Void once), or a full Void — the caller always gets back either the
// original world untouched, or a new world with exactly one piece relocated and
// locked.
export function sendToVoid(world: World, pieceId: PieceId): World | null {
  const piece = world.pieces[pieceId]
  if (piece === undefined || piece.locked) return null

  const next = cloneWorld(world)
  if (next.boards[VOID_BOARD_ID] === undefined) {
    next.boards[VOID_BOARD_ID] = makeVoidBoard()
  }
  const cell = VOID_CELL_ORDER.find(
    ({ x, y }) => occupantAt(next, { board: VOID_BOARD_ID, x, y }) === undefined,
  )
  if (cell === undefined) return null

  next.locations[pieceId] = { board: VOID_BOARD_ID, x: cell.x, y: cell.y }
  next.pieces[pieceId] = { ...next.pieces[pieceId], locked: true }
  return next
}
```

- [ ] **Step 4: Run and confirm the new tests pass**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: PASS for every `sendToVoid` test. The `removePiece` describe block still passes too (unchanged, function still exists).

- [ ] **Step 5: Delete `removePiece` and its test**

In `src/game/engine/types.ts`: `removePiece` is already gone (replaced in Step 3).

In `src/game/engine/types.test.ts`:
- Remove `removePiece` from the import line (leave `sendToVoid, VOID_BOARD_ID` in place):
  ```ts
  import { inBounds, opposite, step, occupantAt, findContainerFor, moveTo, sendToVoid, VOID_BOARD_ID, PLAYER_ID, World } from './types'
  ```
- Delete the entire `describe('removePiece', ...)` block (the one whose single test is `'deletes the piece and its location, leaving other pieces and the original world untouched'`).

- [ ] **Step 6: Run the full file and confirm it's green**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: PASS, all tests (the `sendToVoid` describe block plus every other pre-existing describe block in the file, now minus `removePiece`'s).

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors (confirms nothing else in the codebase still imports `removePiece` — if this fails, STOP, do not fix it here; report it, since fixing another file is Task 2's job, not this task's).

- [ ] **Step 7: Commit**

```bash
git add src/game/engine/types.ts src/game/engine/types.test.ts
git commit -m "feat(engine): add the Void board and sendToVoid, replacing removePiece"
```

---

### Task 2: `rules.ts` — wire `sendToVoid` in, two-sided lock guard in `resolveBlocked`, delete `checkLose`

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `sendToVoid`, `VOID_BOARD_ID` from `types.ts` (Task 1). `removePiece` and `checkLose` are both gone/going after this task — `rules.ts` no longer imports `removePiece`, and no longer exports `checkLose`.
- Produces: nothing new exported — `tryMovePiece`'s `infinite` branch and `resolveBlocked`'s guard change behavior, and `checkLose` is removed from this module's exports. Task 4 (`GameState.ts`) depends on `checkLose` being gone from here (it currently imports it).

- [ ] **Step 1: Write the failing/updated tests**

In `src/game/engine/rules.test.ts`, update the import line (drop `checkLose` from the `./rules` import, drop `removePiece` from the `./types` import — both are about to stop existing):

```ts
import { computeTarget, getEntryCell, applyMove, tryEnter, tryMovePiece, resolveBlocked, checkWin } from './rules'
import { HALF, makeFraction, ZERO, ONE } from './fraction'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from './testFixtures'
import { PLAYER_ID } from './types'
```

**Rewrite** the test at line 526, `'removes the player directly when its own move resolves to infinite'`, to:

```ts
  it('sends the player directly to the Void when its own move resolves to infinite', () => {
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
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'void', x: 2, y: 2 })
    expect(next?.pieces[PLAYER_ID]).toEqual({ id: PLAYER_ID, kind: 'player', locked: true })
  })
```

**Rewrite** the test at line 563, `'removes a self-loop box pushed flush against the board it owns, letting the pusher complete its move'`, to:

```ts
  it('sends a self-loop box to the Void when pushed flush against the board it owns, letting the pusher complete its move', () => {
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
    expect(next?.locations.loopBox).toEqual({ board: 'void', x: 2, y: 2 })
    expect(next?.pieces.loopBox).toEqual({ id: 'loopBox', kind: 'container', boardRef: 'root', locked: true })
  })
```

**Rewrite** the test at line 583, `'resolveBlocked removes the player when pushing it resolves to infinite, treating it the same as any other piece'`, to:

```ts
  it('resolveBlocked sends the player to the Void when pushing it resolves to infinite, treating it the same as any other piece', () => {
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
    expect(result?.locations[PLAYER_ID]).toEqual({ board: 'void', x: 2, y: 2 })
    expect(result?.pieces[PLAYER_ID]).toEqual({ id: PLAYER_ID, kind: 'player', locked: true })
    expect(result?.locations.loopBox).toEqual({ board: 'root', x: 0, y: 1 })
  })
```

**Delete** the whole `describe('tryMovePiece — piece already removed from the world', ...)` block (lines 613-627) — it constructs a `World` via `removePiece(world, PLAYER_ID)`, which no longer exists, and that `World` shape (a player with no location at all) can no longer arise anywhere in this codebase once `removePiece` is gone.

**Delete** the whole `describe('checkLose', ...)` block (lines 658-669) — the function is gone.

**Add** new lock-interaction coverage. Append this new `describe` block after `describe('applyMove — entering a self-loop box directly', ...)`:

```ts
describe('resolveBlocked — locked pieces push only, never enter or eat, on either side', () => {
  it('an unlocked pusher can push a locked occupant when the destination beyond it is free', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld(
      [root],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'locked1', kind: 'normal', locked: true },
      ],
      {
        pusher: { board: 'root', x: 0, y: 0 },
        locked1: { board: 'root', x: 1, y: 0 },
      },
    )
    const target = computeTarget(world, world.locations.pusher, 'right', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup')
    const result = resolveBlocked(world, 'pusher', 'locked1', target, 'right', new Map(), new Set())
    expect(result?.locations.pusher).toEqual({ board: 'root', x: 1, y: 0 })
    expect(result?.locations.locked1).toEqual({ board: 'root', x: 2, y: 0 })
  })

  it('an unlocked pusher cannot enter or eat a locked occupant when the push fails', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 0) // directly behind locked1 — push fails
    const world = makeWorld(
      [root],
      [
        { id: 'pusher', kind: 'container', boardRef: 'root' }, // a container, so "eaten" would otherwise be viable
        { id: 'locked1', kind: 'normal', locked: true },
      ],
      {
        pusher: { board: 'root', x: 0, y: 0 },
        locked1: { board: 'root', x: 1, y: 0 },
      },
    )
    const target = computeTarget(world, world.locations.pusher, 'right', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup')
    const result = resolveBlocked(world, 'pusher', 'locked1', target, 'right', new Map(), new Set())
    expect(result).toBeNull()
  })

  it('a locked moving piece can push an unlocked occupant when the push succeeds', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld(
      [root],
      [
        { id: 'locked1', kind: 'normal', locked: true },
        { id: 'normalBox', kind: 'normal' },
      ],
      {
        locked1: { board: 'root', x: 0, y: 0 },
        normalBox: { board: 'root', x: 1, y: 0 },
      },
    )
    const target = computeTarget(world, world.locations.locked1, 'right', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup')
    const result = resolveBlocked(world, 'locked1', 'normalBox', target, 'right', new Map(), new Set())
    expect(result?.locations.locked1).toEqual({ board: 'root', x: 1, y: 0 })
    expect(result?.locations.normalBox).toEqual({ board: 'root', x: 2, y: 0 })
  })

  it('a locked moving piece cannot enter or eat an unlocked occupant when its push fails', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 0) // directly behind normalBox — push fails
    const world = makeWorld(
      [root],
      [
        { id: 'locked1', kind: 'normal', locked: true },
        { id: 'normalBox', kind: 'container', boardRef: 'root' }, // a container, so "entered" would otherwise be viable
      ],
      {
        locked1: { board: 'root', x: 0, y: 0 },
        normalBox: { board: 'root', x: 1, y: 0 },
      },
    )
    const target = computeTarget(world, world.locations.locked1, 'right', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup')
    const result = resolveBlocked(world, 'locked1', 'normalBox', target, 'right', new Map(), new Set())
    expect(result).toBeNull()
  })

  it('two locked pieces: a successful push chain is still allowed', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld(
      [root],
      [
        { id: 'locked1', kind: 'normal', locked: true },
        { id: 'locked2', kind: 'normal', locked: true },
      ],
      {
        locked1: { board: 'root', x: 0, y: 0 },
        locked2: { board: 'root', x: 1, y: 0 },
      },
    )
    const target = computeTarget(world, world.locations.locked1, 'right', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup')
    const result = resolveBlocked(world, 'locked1', 'locked2', target, 'right', new Map(), new Set())
    expect(result?.locations.locked1).toEqual({ board: 'root', x: 1, y: 0 })
    expect(result?.locations.locked2).toEqual({ board: 'root', x: 2, y: 0 })
  })

  it('two locked pieces: a failed push returns null, no enter/eat fallback on either side', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 0) // directly behind locked2 — push fails
    const world = makeWorld(
      [root],
      [
        { id: 'locked1', kind: 'container', boardRef: 'root', locked: true },
        { id: 'locked2', kind: 'container', boardRef: 'root', locked: true },
      ],
      {
        locked1: { board: 'root', x: 0, y: 0 },
        locked2: { board: 'root', x: 1, y: 0 },
      },
    )
    const target = computeTarget(world, world.locations.locked1, 'right', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup')
    const result = resolveBlocked(world, 'locked1', 'locked2', target, 'right', new Map(), new Set())
    expect(result).toBeNull()
  })

  it('control: two unlocked pieces at the same coordinates still resolve via ordinary enter/eat, proving the guard is keyed on locked, not on position', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 0) // directly behind the occupant — push fails, forcing entry
    const world = makeWorld(
      [root],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'container1', kind: 'container', boardRef: 'root' }, // self-loop, so entry lands back on 'root'
      ],
      {
        pusher: { board: 'root', x: 0, y: 0 },
        container1: { board: 'root', x: 1, y: 0 },
      },
    )
    const target = computeTarget(world, world.locations.pusher, 'right', HALF)
    if (target === null || target.kind !== 'location') throw new Error('test setup')
    const result = resolveBlocked(world, 'pusher', 'container1', target, 'right', new Map(), new Set())
    expect(result).not.toBeNull() // entry succeeded — not blocked the way a locked occupant would be
  })
})

describe('tryMovePiece — infinite resolution when the Void is full', () => {
  it('fails the whole move cleanly, leaving the pusher and the piece being pushed into infinite untouched', () => {
    const voidCells: { x: number; y: number }[] = [
      { x: 2, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
    ]
    const voidBoard = {
      id: 'void',
      size: 5,
      cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'floor' as const }))),
    }
    const fillerPieces = voidCells.map((_, i) => ({ id: `filler${i}`, kind: 'normal' as const, locked: true }))
    const fillerLocations = Object.fromEntries(
      voidCells.map(({ x, y }, i) => [`filler${i}`, { board: 'void', x, y }]),
    )
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root, voidBoard],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
        ...fillerPieces,
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        loopBox: { board: 'root', x: 0, y: 0 }, // flush corner — pushing left resolves to infinite
        ...fillerLocations,
      },
    )
    const next = applyMove(world, 'left')
    expect(next).toBeNull()
  })
})
```

- [ ] **Step 2: Run and confirm the new/changed tests fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL — the rewritten tests fail against the current `removePiece`-based behavior (e.g. `next?.locations[PLAYER_ID]` is `undefined`, not `{ board: 'void', ... }`), and the new lock-interaction tests fail because `resolveBlocked` doesn't check `locked` at all yet.

- [ ] **Step 3: Implement the `rules.ts` changes**

Update the import line (drop `removePiece`, add `sendToVoid`):

```ts
import {
  World, Location, Direction, Board, BoardId, Piece, PieceId,
  inBounds, step, findContainerFor, occupantAt, moveTo, sendToVoid, opposite, PLAYER_ID,
} from './types'
```

In `tryMovePiece`, replace the `removePiece` call and update its surrounding comment:

```ts
  const loc = world.locations[pieceId]
  if (loc === undefined) return null // the piece is no longer in the world
  const target = computeTarget(world, loc, dir, HALF)
  if (target === null) return null
  // The transition can never resolve to a real location — the piece attempting
  // it is relocated into the Void instead (see sendToVoid), locked so nothing
  // can enter or merge into it again. If pieceId is PLAYER_ID, the player simply
  // ends up standing in the Void — this is no longer a loss (there is no loss
  // state anymore; see checkLose's removal). If it's any other piece,
  // resolveBlocked's existing "pushed succeeded" path (moveTo(pushed, pieceId,
  // target.location)) already treats a non-null return as a completed push, so
  // the pusher still ends up at its own target cell while the pushed piece ends
  // up in the Void — no change needed there.
  if (target.kind === 'infinite') return sendToVoid(world, pieceId)
```

In `resolveBlocked`, add the two-sided lock guard after the push attempt:

```ts
export function resolveBlocked(
  world: World,
  pieceId: PieceId,
  occupantId: PieceId,
  target: { location: Location; relativeCoord: Fraction },
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const nextInMotion = new Map(inMotion).set(pieceId, dir)

  // The normal push path is the only legal way a locked piece — on either side —
  // may participate in a blocked move.
  const pushed = tryMovePiece(world, occupantId, dir, nextInMotion, new Set())
  if (pushed) return moveTo(pushed, pieceId, target.location)

  // No push was possible. If either side of this interaction is locked, it may
  // never be entered, eaten, or itself enter/eat the other — skip straight to
  // failure instead of trying either tryEnter direction below.
  if (world.pieces[pieceId]?.locked || world.pieces[occupantId]?.locked) return null

  const entered = tryEnter(
    world, pieceId, occupantId, dir, target.relativeCoord,
    nextInMotion, beingEntered,
  )
  if (entered) return entered

  const eaten = tryEnter(
    world, occupantId, pieceId, opposite(dir), HALF,
    nextInMotion, new Set(),
  )
  if (eaten) return moveTo(eaten, pieceId, target.location)

  return null
}
```

**Delete** `checkLose` (currently the last function in the file):

```ts
export function checkLose(world: World): boolean {
  return world.locations[PLAYER_ID] === undefined
}
```

- [ ] **Step 4: Run and confirm all tests pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS, every test in the file.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors ONLY in files this task hasn't touched yet that still reference `checkLose` (`GameState.ts`) — that's expected and is Task 4's job. If there are errors anywhere else (anything not `GameState.ts`/`GameState.test.ts`), STOP and report NEEDS_CONTEXT rather than fixing an out-of-scope file.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): route infinite resolution through sendToVoid; lock guard on both sides of a blocked interaction; drop checkLose"
```

---

### Task 3: `levelSchema.ts` — reserve the `'void'` board id

**Files:**
- Modify: `src/game/engine/levelSchema.ts`
- Modify: `src/game/engine/levelSchema.test.ts`

**Interfaces:**
- Consumes: `VOID_BOARD_ID` from `types.ts` (Task 1).
- Produces: nothing new exported — `parseLevel` now throws for one more input shape.

- [ ] **Step 1: Write the failing test**

In `src/game/engine/levelSchema.test.ts`, add this test inside the existing `describe('parseLevel structural validation', ...)` block (anywhere among its other `it`s):

```ts
  it('rejects an authored board using the reserved void board id', () => {
    const data = serializeLevel(makeWorld(
      [makeFloorBoard('void', 2)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'void', x: 0, y: 0 } },
    ))
    expect(() => parseLevel(data)).toThrow(/reserved/i)
  })
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: FAIL — `parseLevel` currently accepts a board literally named `'void'` (it has no special meaning to the parser yet).

- [ ] **Step 3: Implement the reserved-id check**

In `src/game/engine/levelSchema.ts`, add `VOID_BOARD_ID` to the import from `./types`:

```ts
import { World, Board, Piece, Location, PLAYER_ID, VOID_BOARD_ID, inBounds } from './types'
```

Inside the existing per-board validation loop (the one that already checks `board.id !== boardId`), add the reserved-id check as the first thing inside the loop body:

```ts
  for (const [boardId, board] of Object.entries(boards)) {
    if (boardId === VOID_BOARD_ID) {
      throw new Error(`Board id "${VOID_BOARD_ID}" is reserved for the runtime Void and cannot be authored`)
    }
    if (board.id !== boardId) {
      throw new Error(`Board "${boardId}" has a mismatched id "${board.id}"`)
    }
    // ...rest of the loop body unchanged...
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: PASS, every test in the file (including all pre-existing ones — this check only rejects the one new reserved-id shape, nothing else changes).

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/levelSchema.ts src/game/engine/levelSchema.test.ts
git commit -m "feat(levels): reject an authored board using the reserved 'void' id"
```

---

### Task 4: `GameState.ts` — delete `isLost`, prove undo works across a Void-sending move

**Files:**
- Modify: `src/game/engine/GameState.ts`
- Modify: `src/game/engine/GameState.test.ts`

**Interfaces:**
- Consumes: nothing new — `checkLose` is already gone from `rules.ts` (Task 2), so this task just removes the now-broken import/getter.
- Produces: `GameState` no longer has an `isLost` getter. Task 5 (`GameScreen.tsx`) depends on this.

- [ ] **Step 1: Write the failing/updated tests**

In `src/game/engine/GameState.test.ts`, **delete** the test `'reports isLost after a move resolves into infinite regress, and undo recovers it'` (the last test in the file).

**Add** these two tests in its place:

```ts
  it('undoes a move that sends the player to the Void, restoring the exact pre-move state', () => {
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
    const ok = state.move('left')
    expect(ok).toBe(true)
    expect(state.current.locations[PLAYER_ID]).toEqual({ board: 'void', x: 2, y: 2 })
    expect(state.undo()).toBe(true)
    expect(state.current.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 1 })
    expect(state.current.boards.void).toBeUndefined() // the pre-move world never had a Void board
  })

  it('continues to accept moves and track history normally after the player is in the Void', () => {
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
    state.move('left') // player now in the Void
    expect(() => state.move('right')).not.toThrow()
    expect(state.moveCount).toBe(2)
  })
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: FAIL — compile error, since `isLost` still exists but the deleted test is gone (that's fine, it's a deletion) — the two NEW tests should currently PASS already (nothing about them depends on this task's implementation change, since `GameState`'s `move`/`undo`/`moveCount` already work generically). The actual expected failure at this point is that the file still imports/uses `checkLose` via `GameState.ts`, which no longer exists in `rules.ts` since Task 2 — so `GameState.ts` itself currently fails to typecheck/import. Confirm this specific failure: `npx tsc --noEmit -p tsconfig.json` should show an error in `GameState.ts` (`checkLose` not exported by `./rules`).

- [ ] **Step 3: Implement the `GameState.ts` change**

Delete the `isLost` getter and the `checkLose` import:

```ts
import { World, Direction } from './types'
import { applyMove, checkWin } from './rules'

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

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: PASS, every test in the file.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors ONLY in `GameScreen.tsx`/`GameScreen.test.tsx` (still reference `state.isLost`) — expected, that's Task 5. Any error elsewhere: STOP, report NEEDS_CONTEXT.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/GameState.ts src/game/engine/GameState.test.ts
git commit -m "feat(engine): drop GameState.isLost now that checkLose is gone; prove undo across a Void-sending move"
```

---

### Task 5: `GameScreen.tsx` — drop the lose-notice UI and the no-location fallback

**Files:**
- Modify: `src/game/GameScreen.tsx`
- Modify: `src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: `GameState` without `isLost` (Task 4).
- Produces: nothing new exported — `GameScreen`'s rendered output changes (no lose-notice, ever).

- [ ] **Step 1: Write the failing/updated tests**

In `src/game/GameScreen.test.tsx`, the `beforeEach` canvas mock only defines `fillRect`. The new test below pushes the player into the Void, which means `renderBoard` will run its locked-piece ring-drawing branch (Task 6 adds this) — but Task 6 hasn't landed yet at this point in the plan. To keep this task's test green **before** Task 6 exists, extend the mock now so it tolerates a locked-piece render either way (harmless no-ops if Task 6's code isn't reachable yet, required once it is):

```ts
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})
```

**Delete** both `'a move that removes the player shows a lost notice, and its button recovers via undo'` and `'pressing a direction after losing does not crash, and the lost notice stays up'`.

**Add** this test in their place:

```ts
test('pushing the player into a self-loop sends them to the Void instead of showing a lost notice, and play continues', async () => {
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
  const onExit = vi.fn()
  render(<GameScreen initialWorld={world} onExit={onExit} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('左'))

  expect(screen.queryByTestId('lose-notice')).not.toBeInTheDocument()
  expect(screen.getByText('步数: 1')).toBeInTheDocument() // the move counted normally

  // still fully interactive: another move doesn't crash
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 2')).toBeInTheDocument()

  await user.click(screen.getByText('离开'))
  expect(onExit).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: FAIL — `GameScreen.tsx` still reads `state.isLost`, which no longer exists on `GameState` since Task 4 (compile error), so the whole file fails to run.

- [ ] **Step 3: Implement the `GameScreen.tsx` change**

Remove the `lastBoardIdRef` fallback and simplify `currentBoardId`. Remove the lose-notice JSX block. The full file becomes:

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

  const handleMove = (direction: Direction) => {
    if (state.move(direction)) setTick((t) => t + 1)
  }

  const handleUndo = () => {
    if (state.undo()) {
      wonRef.current = false
      setTick((t) => t + 1)
    }
  }

  const currentBoardId = state.current.locations[PLAYER_ID].board
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
      <SwipeLayer onMove={handleMove}>
        <canvas ref={canvasRef} width={CELL_SIZE * currentBoard.size} height={CELL_SIZE * currentBoard.size} />
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
```

(Only two things changed from the current file: `currentBoardId` reads `state.current.locations[PLAYER_ID].board` directly instead of going through `lastBoardIdRef`/the `playerLocation` fallback, and the `{state.isLost && (...)}` block is gone. Everything else — imports, `handleMove`, `handleUndo`, the win `useEffect`, the keyboard `useEffect`, the JSX shell — is unchanged.)

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: PASS, every test in the file.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors anywhere (this was the last file referencing `checkLose`/`isLost`/`removePiece`).

- [ ] **Step 5: Commit**

```bash
git add src/game/GameScreen.tsx src/game/GameScreen.test.tsx
git commit -m "feat(game): drop the lose-notice UI; the player is fully controllable after being sent to the Void"
```

---

### Task 6: `CanvasRenderer.ts` — a gold ring for locked pieces

**Files:**
- Modify: `src/game/render/CanvasRenderer.ts`
- Modify: `src/game/render/CanvasRenderer.test.ts`

**Interfaces:**
- Consumes: `Piece.locked` (Task 1). Independent of Tasks 2-5's engine/UI changes — this task can in principle run any time after Task 1, but is sequenced last since it's the lowest-risk, most self-contained task.
- Produces: nothing new exported — `renderBoard`'s drawing output changes for any piece with `locked: true`.

- [ ] **Step 1: Write the failing tests**

In `src/game/render/CanvasRenderer.test.ts`, extend `mockContext()` to include the stroke/save/restore surface the new code needs:

```ts
function mockContext() {
  return {
    fillRect: () => {},
    fillStyle: '',
    strokeRect: () => {},
    strokeStyle: '',
    lineWidth: 0,
    save: () => {},
    restore: () => {},
  } as unknown as CanvasRenderingContext2D
}
```

Add these tests inside the existing `describe('renderBoard', ...)` block:

```ts
  it('draws a gold ring around a locked piece', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [{ id: 'box1', kind: 'normal', locked: true }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let strokeCalls = 0
    let sawGoldStroke = false
    ctx.strokeRect = () => {
      strokeCalls++
      if (ctx.strokeStyle === '#facc15') sawGoldStroke = true
    }
    renderBoard(ctx, root, world, 32)
    expect(strokeCalls).toBe(1)
    expect(sawGoldStroke).toBe(true)
  })

  it('does not draw a ring around a non-locked piece of the same kind', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let strokeCalls = 0
    ctx.strokeRect = () => { strokeCalls++ }
    renderBoard(ctx, root, world, 32)
    expect(strokeCalls).toBe(0)
  })

  it('draws both the cycle fill color and the locked ring for a piece that is both', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root', locked: true }],
      { loopBox: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let fillStyleAtPieceDraw = ''
    let strokeCalls = 0
    ctx.fillRect = () => { fillStyleAtPieceDraw = ctx.fillStyle as string }
    ctx.strokeRect = () => { strokeCalls++ }
    renderBoard(ctx, root, world, 32)
    expect(fillStyleAtPieceDraw).not.toBe('#38bdf8') // still the cycle color, not the plain container color
    expect(strokeCalls).toBe(1) // still gets the ring
  })

  it('restores context state after drawing a locked ring, so a later piece is not affected', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root, makeFloorBoard('inside', 1)],
      [
        { id: 'locked1', kind: 'normal', locked: true },
        { id: 'normal1', kind: 'normal' },
      ],
      {
        locked1: { board: 'root', x: 0, y: 0 },
        normal1: { board: 'root', x: 1, y: 0 },
      },
    )
    const ctx = mockContext()
    let saveCalls = 0
    let restoreCalls = 0
    ctx.save = () => { saveCalls++ }
    ctx.restore = () => { restoreCalls++ }
    renderBoard(ctx, root, world, 32)
    expect(saveCalls).toBe(1)
    expect(restoreCalls).toBe(1) // one save/restore pair for the one locked piece, not leaked into normal1's draw
  })
```

- [ ] **Step 2: Run and confirm the new tests fail**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: FAIL — no locked-piece ring is drawn yet, so `strokeCalls` stays `0` and `sawGoldStroke` stays `false` in the first test; the others fail similarly.

- [ ] **Step 3: Implement the ring**

In `src/game/render/CanvasRenderer.ts`, add the color constant near the other color constants at the top:

```ts
const LOCKED_RING_COLOR = '#facc15' // gold/yellow, distinct from any PIECE_COLORS or CYCLE_PALETTE entry
```

In `renderBoard`'s piece-drawing loop, add the ring after the existing `fillRect`:

```ts
  for (const [pieceId, location] of Object.entries(world.locations)) {
    if (location.board !== board.id) continue
    const piece = world.pieces[pieceId]
    ctx.fillStyle = isCycleMember(pieceId, world) ? cycleColorFor(pieceId) : PIECE_COLORS[piece.kind]
    ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
    if (piece.locked) {
      ctx.save()
      ctx.strokeStyle = LOCKED_RING_COLOR
      ctx.lineWidth = Math.max(2, cellSize / 8)
      const inset = ctx.lineWidth / 2
      ctx.strokeRect(
        location.x * cellSize + inset,
        location.y * cellSize + inset,
        cellSize - inset * 2,
        cellSize - inset * 2,
      )
      ctx.restore()
    }
  }
```

- [ ] **Step 4: Run and confirm all tests pass**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 5: Full project check**

Run: `npx vitest run`
Expected: every test file passes.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/game/render/CanvasRenderer.ts src/game/render/CanvasRenderer.test.ts
git commit -m "feat(render): draw a gold ring around locked pieces, independent of cycle coloring"
```
