# Clone, Flip, Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three independent mechanics on top of the existing Void/infinite-exit
system: Clone (`cloneOf` — entering redirects to a main body's current location),
Flip (`fliph` — persistent horizontal mirror on entry and exit direction mapping),
and Transfer (`linkedTo` — two containers with matching interiors glued together at
one edge, bypassing the normal climb-to-owner resolution).

**Architecture:** All three add one optional field to `Piece` and one focused change
to `rules.ts`'s existing `tryEnter`/`computeTarget`. Each is independently testable
and, other than sharing those two functions' bodies, independent of the other two —
this plan sequences them (Clone → Flip → Transfer) so each task's diff to the shared
functions builds cleanly on the previous task's committed state instead of three
tasks racing to edit the same lines.

**Tech Stack:** TypeScript, Vitest.

**Spec:** Three specs, read all three before starting any task — they cross-reference
each other in a few places (Flip's `climbDir`, Transfer's link check, both patch the
same step of `computeTarget`; Clone's `boardRef` relaxation and Flip's `fliph` both
touch the same `Piece` interface and the same `levelSchema.ts` validation block):
- `docs/superpowers/specs/2026-09-18-clone-box-design.md`
- `docs/superpowers/specs/2026-09-18-flip-box-design.md`
- `docs/superpowers/specs/2026-09-18-container-link-design.md`

## Global Constraints

- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true` in `tsconfig.json`.
- Every new field (`cloneOf`, `fliph`, `linkedTo`) is optional on `Piece` and
  independent of the other two — a piece may carry any combination, or none.
- None of the three mechanics change `resolveBlocked`, `tryMovePiece`'s infinite
  branch, `resolveInfiniteExit`, or `ensureInfiniteDestination` — all three are scoped
  to `tryEnter` and/or `computeTarget` only, plus `levelSchema.ts` for Clone's
  `boardRef` relaxation.
- A piece entering a clone or crossing a link never adds to `visited` and never
  triggers the infinite-exit path — both are terminal resolutions, not recursive
  climbs. Confirm this explicitly in each task's tests rather than assuming it.
- Match each spec's own "Explicitly out of scope" section — do not build interactions
  between the three mechanics (e.g. a linked container's own `fliph`, a clone with a
  linked main body) beyond what each task's brief states outright. If a task's own
  work surfaces a real interaction that must be handled to keep the suite green, flag
  it — do not silently invent behavior for an unspecified case.

---

### Task 1: `types.ts` / `levelSchema.ts` — new `Piece` fields and the Clone `boardRef` relaxation

**Files:**
- Modify: `src/game/engine/types.ts`
- Modify: `src/game/engine/levelSchema.ts`
- Modify: `src/game/engine/levelSchema.test.ts`

**Interfaces:**
- Produces: `Piece.cloneOf?: PieceId`, `Piece.fliph?: boolean`, `Piece.linkedTo?: PieceId`.
  `parseLevel` no longer requires `boardRef` on a container piece that has `cloneOf`
  set.
- Consumes: nothing new — this is the foundation task the other three build on.

- [ ] **Step 1: Write the failing tests**

In `src/game/engine/levelSchema.test.ts`, add these to the existing
`describe('parseLevel structural validation', ...)` block:

```ts
  it('accepts a container piece with cloneOf and no boardRef', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, unknown> }
    data.pieces.box1 = { id: 'box1', kind: 'container', cloneOf: 'player' }
    expect(() => parseLevel(data)).not.toThrow()
  })

  it('still rejects a container piece with no boardRef when cloneOf is absent', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, { boardRef?: string }> }
    delete data.pieces.box1.boardRef
    expect(() => parseLevel(data)).toThrow(/boardRef/i)
  })
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: the first new test FAILS (current code still requires `boardRef` on every
container regardless of `cloneOf`); the second new test currently PASSES already
(it's a control case pinning down existing behavior — confirm it passes both before
and after Step 3, i.e. this one is not expected to ever go red).

- [ ] **Step 3: Implement**

In `src/game/engine/types.ts`, update the `Piece` interface:

```ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId    // present when kind === 'container' AND cloneOf is unset — see parseLevel
  infiniteFor?: PieceId // present only on an infinite destination
  cloneOf?: PieceId     // present only on a clone — names its main body
  fliph?: boolean       // persistent horizontal-flip property
  linkedTo?: PieceId    // present only on a container linked directly to another
}
```

In `src/game/engine/levelSchema.ts`, find the per-piece validation loop (the block
starting `if (piece.kind === 'container') { if (piece.boardRef === undefined ...`)
and change it to:

```ts
    if (piece.kind === 'container') {
      if (piece.cloneOf === undefined && (piece.boardRef === undefined || boards[piece.boardRef] === undefined)) {
        throw new Error(`Container piece "${pieceId}" has a boardRef that does not exist`)
      }
    } else if (piece.boardRef !== undefined) {
      throw new Error(`Piece "${pieceId}" has kind "${piece.kind}" but also has a boardRef, which only container pieces may have`)
    }
```

(Only the `if (piece.kind === 'container')` branch's condition changes — the
`else if` branch and everything else in the loop is unchanged.)

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: PASS, every test in the file (including all pre-existing ones — this
change only adds an exception for `cloneOf`, nothing else about container validation
changes).

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors (the three new `Piece` fields are all optional, so nothing
that constructs a `Piece` literal elsewhere in the codebase needs updating).

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/types.ts src/game/engine/levelSchema.ts src/game/engine/levelSchema.test.ts
git commit -m "feat(engine): add cloneOf/fliph/linkedTo fields; clones don't need a boardRef"
```

---

### Task 2: `rules.ts` — Clone (`resolveCloneTeleport`)

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `Piece.cloneOf` (Task 1).
- Produces: `export function resolveCloneTeleport(world, pieceId, mainBodyId, dir, inMotion): World | null`.
  `tryEnter` now checks `into.cloneOf` before the existing `into.kind !== 'container'`
  check. Task 3 (Flip) modifies `tryEnter` again, after this task — its brief
  reproduces this task's exact resulting shape as its own starting point.

- [ ] **Step 1: Write the failing tests**

In `src/game/engine/rules.test.ts`, add this new `describe` block (anywhere after
the existing `describe('resolveBlocked — locked pieces...', ...)` block):

```ts
describe('resolveCloneTeleport — entering a clone redirects to its main body\'s current location', () => {
  it('teleports the entrant directly there when the main body\'s cell is free', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 4)],
      [{ id: 'A', kind: 'normal' }, { id: 'entrant', kind: 'normal' }],
      { A: { board: 'somewhereElse', x: 0, y: 0 }, entrant: { board: 'root', x: 2, y: 0 } },
    )
    // A is on a board this fixture never declares in `boards` — deliberately: its
    // own board never needs to be walked, only its Location is read.
    const result = resolveCloneTeleport(world, 'entrant', 'A', 'right', new Map())
    expect(result?.locations.entrant).toEqual({ board: 'somewhereElse', x: 0, y: 0 })
  })

  it('pushes the main body one step further in the entrant\'s direction when its own cell is occupied (the common case — reproduces the confirmed worked example)', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld(
      [root],
      [
        { id: 'A', kind: 'container', boardRef: 'root' }, // self-loop main body
        { id: 'B', kind: 'container', cloneOf: 'A', boardRef: 'root' },
        { id: 'entrant', kind: 'normal' },
      ],
      {
        A: { board: 'root', x: 0, y: 0 },
        B: { board: 'root', x: 3, y: 0 },
        entrant: { board: 'root', x: 2, y: 0 },
      },
    )
    const result = resolveCloneTeleport(world, 'entrant', 'A', 'right', new Map())!
    expect(result.locations.A).toEqual({ board: 'root', x: 1, y: 0 }) // pushed one step right
    expect(result.locations.entrant).toEqual({ board: 'root', x: 0, y: 0 }) // takes A's old cell
  })

  it('fails the whole move when the main body cannot be pushed further', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld(
      [root],
      [{ id: 'A', kind: 'normal' }, { id: 'entrant', kind: 'normal' }],
      { A: { board: 'root', x: 0, y: 0 }, entrant: { board: 'root', x: 2, y: 0 } }, // A flush against the left edge
    )
    const result = resolveCloneTeleport(world, 'entrant', 'A', 'left', new Map())
    expect(result).toBeNull()
    expect(world.locations.A).toEqual({ board: 'root', x: 0, y: 0 }) // untouched
    expect(world.locations.entrant).toEqual({ board: 'root', x: 2, y: 0 }) // untouched
  })

  it('fails cleanly (does not throw) when cloneOf names a piece with no location', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 2)],
      [{ id: 'entrant', kind: 'normal' }],
      { entrant: { board: 'root', x: 0, y: 0 } },
    )
    expect(resolveCloneTeleport(world, 'entrant', 'nonexistent', 'right', new Map())).toBeNull()
  })
})

describe('tryEnter — a clone redirects before normal container entry', () => {
  it('an ordinary box (not the player) pushed into a clone triggers the same redirect', () => {
    // A sits well away from pusher's own row so the push-chain that follows (pusher
    // -> tries to enter B -> redirects to A -> pushes A) can't loop back onto pusher
    // itself — hand-traced against the exact resolveBlocked/resolveCloneTeleport
    // logic before writing this down: pusher ends up at A's OLD location (A's cell,
    // vacated), A ends up pushed one step further right.
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 1) // directly behind B — push fails, forcing tryEnter
    const world = makeWorld(
      [root],
      [
        { id: 'A', kind: 'container', boardRef: 'root' },
        { id: 'B', kind: 'container', cloneOf: 'A' }, // no boardRef needed (Task 1)
        { id: 'pusher', kind: 'normal' },
      ],
      {
        A: { board: 'root', x: 0, y: 3 },
        B: { board: 'root', x: 2, y: 1 },
        pusher: { board: 'root', x: 1, y: 1 },
      },
    )
    const direct = tryMovePiece(world, 'pusher', 'right', new Map(), new Set())!
    expect(direct.locations.pusher).toEqual({ board: 'root', x: 0, y: 3 }) // A's old cell
    expect(direct.locations.A).toEqual({ board: 'root', x: 1, y: 3 }) // pushed one step right
    expect(direct.locations.B).toEqual({ board: 'root', x: 2, y: 1 }) // B itself never moves
  })

  it('control: entering an ordinary (non-clone) container is unaffected', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 1)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'C', kind: 'container', boardRef: 'inside' },
      ],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, C: { board: 'root', x: 1, y: 1 } },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID].board).toBe('inside') // entered normally, unaffected by Clone
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: the `resolveCloneTeleport`/clone-`tryEnter` tests fail (`resolveCloneTeleport`
doesn't exist yet — a `TypeError` from `getEntryCell` reading `board.size` on
`undefined` is expected and fine here, since `B` has no `boardRef` and nothing yet
intercepts before that line is reached).

- [ ] **Step 3: Implement**

In `src/game/engine/rules.ts`, add (anywhere before `tryEnter`, e.g. right after
`resolveInfiniteExit`):

```ts
// A clone has no real interior in practice: entering it (from either tryEnter call
// site — the "entered" or "eaten" direction inside resolveBlocked, so this applies to
// any piece, not just the player) redirects to wherever mainBodyId is CURRENTLY
// standing, rather than descending into the clone's own boardRef. In practice that
// cell is occupied by the main body itself, so the common case is displacing it one
// step further in the same direction (an ordinary push, reusing tryMovePiece exactly
// like resolveInfiniteExit's Void-exit chain-push); if that push isn't possible, the
// whole move fails, same as any other blocked move.
export function resolveCloneTeleport(
  world: World,
  pieceId: PieceId,
  mainBodyId: PieceId,
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
): World | null {
  const targetLoc = world.locations[mainBodyId]
  if (targetLoc === undefined) return null

  const occupant = occupantAt(world, targetLoc)
  if (occupant === undefined) return moveTo(world, pieceId, targetLoc)
  if (occupant === pieceId) return null // degenerate: pieceId IS the main body

  const pushed = tryMovePiece(world, occupant, dir, new Map(inMotion).set(pieceId, dir), new Set())
  if (pushed === null) return null
  return moveTo(pushed, pieceId, targetLoc)
}
```

In `tryEnter`, add the clone check as the very first thing after the `beingEntered`
guard, before the existing `into.kind !== 'container'` check:

```ts
export function tryEnter(
  world: World,
  pieceId: PieceId,
  intoId: PieceId,
  dir: Direction,
  relativeCoord: Fraction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  if (beingEntered.has(intoId)) return null

  const into: Piece = world.pieces[intoId]
  if (into.cloneOf !== undefined) {
    return resolveCloneTeleport(world, pieceId, into.cloneOf, dir, inMotion)
  }
  if (into.kind !== 'container') return null

  const board = world.boards[into.boardRef as string]
  const { cell, newRelativeCoord } = getEntryCell(board, dir, relativeCoord)
  // ...rest of the function unchanged...
}
```

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS, every test in the file — including the corrected expected value from
Step 2's hand-trace for the "ordinary box pushed into a clone" test.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): entering a clone redirects to its main body's current location"
```

---

### Task 3: `rules.ts` — Flip (`fliph`, entry and exit)

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `Piece.fliph` (Task 1); Task 2's `tryEnter` shape (this task's `tryEnter`
  diff applies on top of Task 2's clone-check addition).
- Produces: `mirrorHorizontal(dir): Direction` (module-private, not exported — no
  other task needs to import it, both call sites are inside `rules.ts`).

- [ ] **Step 1: Write the failing tests**

In `src/game/engine/rules.test.ts`, add:

```ts
describe('fliph — entry direction is horizontally mirrored', () => {
  it('entering a fliph container pushing right computes the same cell as pushing left into an identical non-flipped container', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 1) // directly behind the container — push fails, forcing entry
    const insideFlipped = makeFloorBoard('insideFlipped', 4)
    const insidePlain = makeFloorBoard('insidePlain', 4)
    const world = makeWorld(
      [root, insideFlipped, insidePlain],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'flipped', kind: 'container', boardRef: 'insideFlipped', fliph: true },
      ],
      { pusher: { board: 'root', x: 1, y: 1 }, flipped: { board: 'root', x: 2, y: 1 } },
    )
    const next = tryMovePiece(world, 'pusher', 'right', new Map(), new Set())
    expect(next?.locations.pusher).toEqual({ board: 'insideFlipped', x: 3, y: 1 }) // mirrored entry cell — verified: getEntryCell(board,'left',HALF) = (3,1)
  })

  it('up/down entries are unaffected by fliph', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 1, 0) // directly behind the container in the push direction (pushing up)
    const insideFlipped = makeFloorBoard('insideFlipped', 4)
    const world = makeWorld(
      [root, insideFlipped],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'flipped', kind: 'container', boardRef: 'insideFlipped', fliph: true },
      ],
      { pusher: { board: 'root', x: 1, y: 2 }, flipped: { board: 'root', x: 1, y: 1 } },
    )
    const next = tryMovePiece(world, 'pusher', 'up', new Map(), new Set())
    expect(next?.locations.pusher).toEqual({ board: 'insideFlipped', x: 2, y: 3 }) // same as a non-flipped 'up' entry — verified: getEntryCell(board,'up',HALF) = (2,3)
  })

  it('control: entering a non-fliph container is unaffected', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 1)
    const inside = makeFloorBoard('inside', 4)
    const world = makeWorld(
      [root, inside],
      [
        { id: 'pusher', kind: 'normal' },
        { id: 'plain', kind: 'container', boardRef: 'inside' },
      ],
      { pusher: { board: 'root', x: 1, y: 1 }, plain: { board: 'root', x: 2, y: 1 } },
    )
    const next = tryMovePiece(world, 'pusher', 'right', new Map(), new Set())
    expect(next?.locations.pusher).toEqual({ board: 'inside', x: 0, y: 1 }) // the ORIGINAL (non-mirrored) entry cell
  })
})

describe('fliph — exit direction is horizontally mirrored', () => {
  it('exiting a fliph container continues the climb in the mirrored direction (reproduces the derived example from the spec)', () => {
    const root = makeFloorBoard('root', 4)
    const xInterior = makeFloorBoard('Xinterior', 2)
    const world = makeWorld(
      [root, xInterior],
      [{ id: 'X', kind: 'container', boardRef: 'Xinterior', fliph: true }],
      { X: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'Xinterior', x: 1, y: 0 }, 'right', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 0, y: 1 }, relativeCoord: expect.anything() })
  })

  it('control: exiting a non-fliph container is unaffected (same fixture, no fliph)', () => {
    const root = makeFloorBoard('root', 4)
    const xInterior = makeFloorBoard('Xinterior', 2)
    const world = makeWorld(
      [root, xInterior],
      [{ id: 'X', kind: 'container', boardRef: 'Xinterior' }],
      { X: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'Xinterior', x: 1, y: 0 }, 'right', HALF)
    expect(result).toEqual({ kind: 'location', location: { board: 'root', x: 2, y: 1 }, relativeCoord: expect.anything() })
  })
})
```

All expected coordinates in the tests above were verified directly against this
engine's real `getEntryCell`/`computeTarget` before this task was written: entry-side
mirror pair via `getEntryCell` (`right`→`(0,1)`, `left`→`(3,1)`), up/down-unaffected
pair via `getEntryCell` (`up`→`(2,3)`, `down`→`(2,0)`), exit-side pair via
`computeTarget` (`(0,1)` with `fliph`, `(2,1)` without).

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: the new `fliph` tests fail (the field is parsed/stored but nothing reads
it yet).

- [ ] **Step 3: Implement**

In `src/game/engine/rules.ts`, add near the top (module-private, not exported):

```ts
function mirrorHorizontal(dir: Direction): Direction {
  if (dir === 'left') return 'right'
  if (dir === 'right') return 'left'
  return dir
}
```

In `tryEnter`, change the `getEntryCell` call site (this is the ONLY line in
`tryEnter` that changes — everything else, including Task 2's clone check right
above it, is untouched):

```ts
  const board = world.boards[into.boardRef as string]
  const entryDir = into.fliph ? mirrorHorizontal(dir) : dir
  const { cell, newRelativeCoord } = getEntryCell(board, entryDir, relativeCoord)
  if (cell === null) return null
  if (board.cells[cell.y][cell.x].type === 'wall') return null

  const target: Location = { board: board.id, x: cell.x, y: cell.y }
  // ...rest of the function (resolveBlocked call etc.) uses the ORIGINAL `dir`,
  // unchanged...
```

In `computeTarget`, change the climb-out step:

```ts
  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null
  const container = world.pieces[containerId]

  const climbDir = container.fliph ? mirrorHorizontal(dir) : dir
  const offset = climbDir === 'up' || climbDir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)

  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, climbDir, newRelativeCoord, visited)
```

(Only `offset`'s condition and the recursive call's direction argument change from
`dir` to `climbDir`; `const container = world.pieces[containerId]` is a new line,
everything else in this block is unchanged.)

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS, every test in the file. If the up/down entry test's asserted value
needed correcting per Step 1's note, confirm the corrected value is what's actually
committed.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): fliph mirrors both entry and exit direction mapping"
```

---

### Task 4: `rules.ts` — Transfer (`linkedTo`)

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `Piece.linkedTo` (Task 1); Task 3's `computeTarget` shape (this task's
  diff applies on top of Task 3's `climbDir` addition — the link check runs BEFORE
  `climbDir` is computed, and returns a terminal result before `fliph` is ever
  considered for a linked container, per both specs' "explicitly out of scope" notes
  on the two mechanics not composing this round).

- [ ] **Step 1: Write the failing tests**

In `src/game/engine/rules.test.ts`, add:

```ts
describe('linkedTo — exiting a linked container lands at the mirrored-offset cell in the linked container\'s interior', () => {
  it('reproduces the confirmed example: exiting (3,1) of a 4x4 linked interior pushing right lands at (0,1) of the linked interior', () => {
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const c2Interior = makeFloorBoard('c2Interior', 4)
    const world = makeWorld(
      [c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 5, y: 0 } },
    )
    const result = computeTarget(world, { board: 'c1Interior', x: 3, y: 1 }, 'right', HALF)
    expect(result?.kind).toBe('location')
    expect(result && result.kind === 'location' ? result.location : null).toEqual({ board: 'c2Interior', x: 0, y: 1 })
  })

  it('all four directions map to the opposite edge at the matching offset', () => {
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const c2Interior = makeFloorBoard('c2Interior', 4)
    const world = makeWorld(
      [c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 5, y: 0 } },
    )
    const left = computeTarget(world, { board: 'c1Interior', x: 0, y: 2 }, 'left', HALF)
    const up = computeTarget(world, { board: 'c1Interior', x: 2, y: 0 }, 'up', HALF)
    const down = computeTarget(world, { board: 'c1Interior', x: 1, y: 3 }, 'down', HALF)
    expect(left?.kind === 'location' ? left.location : null).toEqual({ board: 'c2Interior', x: 3, y: 2 })
    expect(up?.kind === 'location' ? up.location : null).toEqual({ board: 'c2Interior', x: 2, y: 3 })
    expect(down?.kind === 'location' ? down.location : null).toEqual({ board: 'c2Interior', x: 1, y: 0 })
  })

  it('a one-directional link only affects exiting the linked side — C2 (unlinked) still climbs to its own owner normally', () => {
    const root = makeFloorBoard('root', 6)
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const c2Interior = makeFloorBoard('c2Interior', 4)
    const world = makeWorld(
      [root, c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior' }, // no linkedTo back
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 2, y: 2 } },
    )
    const result = computeTarget(world, { board: 'c2Interior', x: 3, y: 1 }, 'right', HALF)
    // Normal climb-to-owner: exits toward wherever C2 itself is (root), NOT toward C1.
    expect(result?.kind).toBe('location')
    expect(result && result.kind === 'location' ? result.location.board : null).toBe('root')
  })

  it('a malformed link (target has no boardRef) fails the move rather than falling back to normal climbing', () => {
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const world = makeWorld(
      [c1Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'ghost' },
        { id: 'ghost', kind: 'normal' }, // exists, but not a container — no boardRef
      ],
      { C1: { board: 'root', x: 0, y: 0 }, ghost: { board: 'root', x: 9, y: 9 } },
    )
    const result = computeTarget(world, { board: 'c1Interior', x: 3, y: 1 }, 'right', HALF)
    expect(result).toBeNull()
  })

  it('a size-mismatched link that maps out of bounds fails the move', () => {
    const c1Interior = makeFloorBoard('c1Interior', 4)
    const c2InteriorSmaller = makeFloorBoard('c2Interior', 2) // mismatched size
    const world = makeWorld(
      [c1Interior, c2InteriorSmaller],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 5, y: 0 } },
    )
    // Exiting at y=3 (valid in a size-4 board) maps to y=3 in the linked board too
    // (linkedEntryCell preserves the offset unchanged) — out of bounds for a size-2 board.
    const result = computeTarget(world, { board: 'c1Interior', x: 3, y: 3 }, 'right', HALF)
    expect(result).toBeNull()
  })

  it('a link never triggers infinite-exit detection, even for a shape that would otherwise be a textbook cycle', () => {
    // C1 and C2 linked to each other, closing what WOULD be an infinite regress if
    // resolved via the normal climb — but a link resolution is terminal and never
    // touches `visited`, so this must resolve as an ordinary location, not infinite.
    const c1Interior = makeFloorBoard('c1Interior', 2)
    const c2Interior = makeFloorBoard('c2Interior', 2)
    const world = makeWorld(
      [c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior', linkedTo: 'C1' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 5, y: 0 } },
    )
    const result = computeTarget(world, { board: 'c1Interior', x: 1, y: 0 }, 'right', HALF)
    expect(result?.kind).toBe('location')
  })

  it('control: a container with no linkedTo climbs to its own owner exactly as before', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [{ id: 'C', kind: 'container', boardRef: 'inside' }],
      { C: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'inside', x: 2, y: 1 }, 'right', HALF)
    expect(result?.kind === 'location' ? result.location : null).toEqual({ board: 'root', x: 2, y: 1 })
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: the new `linkedTo` tests fail (the field is parsed/stored but nothing reads
it yet); the control test already passes (pins down existing, unmodified behavior).

- [ ] **Step 3: Implement**

In `src/game/engine/rules.ts`, add near `mirrorHorizontal` (or anywhere above
`computeTarget`):

```ts
// The four directions' worth of "which cell of a same-size linked board does exiting
// this cell land on" — opposite edge, matching offset, exactly like exiting any board
// already lands you on the opposite edge of wherever the climb continues to; this is
// the same idea applied directly between two linked containers' interiors instead of
// via the normal owner-climb.
function linkedEntryCell(size: number, x: number, y: number, dir: Direction): { x: number; y: number } {
  switch (dir) {
    case 'right': return { x: 0, y }
    case 'left':  return { x: size - 1, y }
    case 'down':  return { x, y: 0 }
    case 'up':    return { x, y: size - 1 }
  }
}
```

In `computeTarget`, insert the link check between finding `containerId` and Task 3's
`climbDir` line:

```ts
  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null
  const container = world.pieces[containerId]

  if (container.linkedTo !== undefined) {
    const linked = world.pieces[container.linkedTo]
    const linkedBoard = linked?.boardRef !== undefined ? world.boards[linked.boardRef] : undefined
    if (linkedBoard === undefined) return null // malformed link — fail cleanly, don't fall through
    const cell = linkedEntryCell(board.size, loc.x, loc.y, dir)
    if (!inBounds(linkedBoard, cell.x, cell.y)) return null // e.g. a size mismatch the author didn't intend
    return { kind: 'location', location: { board: linked.boardRef as BoardId, x: cell.x, y: cell.y }, relativeCoord }
  }

  const climbDir = container.fliph ? mirrorHorizontal(dir) : dir
  const offset = climbDir === 'up' || climbDir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)

  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, climbDir, newRelativeCoord, visited)
```

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS, every test in the file.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

Run the FULL suite: `npx vitest run`
Expected: every test file passes — this is the last task, so a clean full run here
means the whole plan is done.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): linkedTo containers exit into each other's interior directly"
```
