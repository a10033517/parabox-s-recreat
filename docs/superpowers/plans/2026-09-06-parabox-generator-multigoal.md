# Parabox Generator Multi-Goal Seed & Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the level generator's single fixed goal pair with 3-4 independent, self-contained goal groups on a bigger board, and prune away any group the reverse walk never actually used, so shipped generated levels stop being near-identical variants with a decorative container mechanic.

**Architecture:** `seed.ts` seeds a variable number of independent goal groups (container + its own pre-placed box + its own win cell) on a fixed non-overlapping slot grid. `generateLevel.ts` gains one new field per event recording which pieces actually moved. A new `pruneUntouchedGoals.ts` uses that history (never the final `World` alone) to remove any group nothing ever touched, before the existing solve/score pipeline runs unmodified.

**Tech Stack:** TypeScript, Node (`tsx`), Vitest (`globals: true`).

**Spec:** `docs/superpowers/specs/2026-09-05-parabox-generator-multigoal-design.md` — read this alongside the plan. It documents two things worth knowing before touching any code: a real bug an external review caught in an earlier draft (pruning by final position could delete the player), and something that review missed which this plan's author verified empirically before writing any of this — `inverseEnter` cannot actually fire during a real `generateLevel` walk at all (confirmed by sampling 442 real walks: 0 `enter` events, player's board `root` at the end of every one), so the design does not carry a `playerBoard` field the review recommended.

## Global Constraints

- "Touched" status for pruning is determined **only** from `affectedPieceIds` recorded per event during the reverse walk — never inferred by comparing a group's final position to its seed-time position. A group counts as touched if its `containerId` or `boxId` ever appears in any event's `affectedPieceIds`.
- `removeGroup` (inside `pruneUntouchedGoals.ts`) must throw, never silently skip or proceed, if it would ever delete the piece keyed `PLAYER_ID` — this is a defensive check for an invariant that should be unreachable given the above, not a normal code path.
- `createSeedWorld`'s geometry relies on a fixed 2×2 grid of 5×5 slots with each group's container at its slot's exact center — this guarantees no cross-group overlap by construction. Do not add collision detection or retry loops; if a test finds an overlap, the fixed-grid math has a bug, not a missing runtime check.
- `generateLevel.ts`'s signature, its `null`-on-incomplete-walk behavior, and its cycle-avoidance logic are unchanged — only `GenerationEvent` gains one field (`affectedPieceIds: string[]`).
- `inverseMoves.ts`, `solver.ts`, `canonical.ts`, `difficultyScorer.ts`, and everything under `src/` are out of scope for this plan and must not be modified.
- `tsconfig.json` has `"noUnusedLocals": true` and `"noUnusedParameters": true` — every import must be used at the point it's introduced.
- Test framework: Vitest with `globals: true` (no need to import `test`/`expect`).

---

### Task 1: `seed.ts` — multi-goal seed

**Files:**
- Modify (full rewrite): `tools/generator/seed.ts`
- Modify (full rewrite): `tools/generator/seed.test.ts`

**Interfaces:**
- Produces: `SeedGroup { containerId: string, boxId: string, interiorId: string, originalPosition: { x: number, y: number } }`, `SeedResult { world: World, groups: SeedGroup[] }`, `createSeedWorld(rng?: () => number): SeedResult` — Task 2's test file, Task 3, and Task 4 all consume this.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tools/generator/seed.test.ts`:

```ts
import { Direction, opposite } from '../../src/game/engine/types'
import { getEntryCell, checkWin } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedWorld } from './seed'

function sequenceRng(values: number[]): () => number {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('sequenceRng exhausted')
    return values[i++]
  }
}

// This one sequence is reused across most tests below: it drives
// groupCount to 4, and picks a different wall direction and a different
// interior size for each of the 4 groups (up/3, down/5, left/3, right/5),
// so a single deterministic seed construction exercises every direction
// and both sizes at once.
const ALL_COMBOS_RNG = () => sequenceRng([0.6, 0.0, 0.0, 0.26, 0.6, 0.51, 0.0, 0.76, 0.6])

test('createSeedWorld produces 3 groups when the group-count draw is low', () => {
  const rng = sequenceRng([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
  const { groups } = createSeedWorld(rng)
  expect(groups.length).toBe(3)
})

test('createSeedWorld produces 4 groups covering all 4 wall directions and both interior sizes', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG())
  expect(groups.length).toBe(4)

  const root = world.boards.root
  const directionFromDelta: Record<string, Direction> = {
    '-1,0': 'left', '1,0': 'right', '0,-1': 'up', '0,1': 'down',
  }
  const seenDirections = new Set<Direction>()
  const seenSizes = new Set<number>()

  for (const group of groups) {
    const { x, y } = group.originalPosition
    const deltas: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    const wallDeltas = deltas.filter(([dx, dy]) => root.cells[y + dy][x + dx].type === 'wall')
    expect(wallDeltas.length).toBe(1)
    const [dx, dy] = wallDeltas[0]
    const wallDir = directionFromDelta[`${dx},${dy}`]
    seenDirections.add(wallDir)

    const interior = world.boards[group.interiorId]
    seenSizes.add(interior.size)
    const { cell: expectedEntry } = getEntryCell(interior, opposite(wallDir), HALF)
    expect(expectedEntry).not.toBeNull()
    expect(world.locations[group.boxId]).toEqual({
      board: group.interiorId,
      x: expectedEntry!.x,
      y: expectedEntry!.y,
    })
  }

  expect(seenDirections.size).toBe(4)
  expect(seenSizes).toEqual(new Set([3, 5]))
})

test('the seed world is already solved for every requirement cell', () => {
  const { world } = createSeedWorld(ALL_COMBOS_RNG())
  expect(checkWin(world)).toBe(true)
})

test('the seed world is internally consistent', () => {
  const { world } = createSeedWorld(ALL_COMBOS_RNG())
  expect(() => parseLevel(serializeLevel(world))).not.toThrow()
})

test('every group container sits at its originalPosition with a box requirement cell there', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG())
  for (const group of groups) {
    expect(world.locations[group.containerId]).toEqual({
      board: 'root',
      x: group.originalPosition.x,
      y: group.originalPosition.y,
    })
    const cell = world.boards.root.cells[group.originalPosition.y][group.originalPosition.x]
    expect(cell.requirement).toBe('box')
  }
})

test('no two groups (or the player) occupy overlapping coordinates on root', () => {
  const { world, groups } = createSeedWorld(ALL_COMBOS_RNG())
  const rootCoords: string[] = [`${world.locations.player.x},${world.locations.player.y}`]
  for (const group of groups) {
    rootCoords.push(`${group.originalPosition.x},${group.originalPosition.y}`)
  }
  expect(new Set(rootCoords).size).toBe(rootCoords.length)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/seed.test.ts`
Expected: FAIL — `createSeedWorld()` currently takes no arguments and returns a bare `World`, so calling it with an `rng` argument and destructuring `{ world, groups }` from the result will not compile/behave as expected (type error or `groups` being `undefined`).

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `tools/generator/seed.ts`:

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
// just `containerId`) so computeTouchedGroups can recognize the group as
// touched via either piece. `interiorId` is needed so removeGroup knows
// which board (and everything located on it) to delete when a group
// turns out to be untouched.
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
      // center-of-edge cell for any board size >= 1. A loud failure here
      // is a construction-time bug, not a runtime condition to swallow.
      throw new Error(`createSeedWorld: getEntryCell unexpectedly returned null for interior size ${interiorSize}`)
    }
    locations[boxId] = { board: interiorId, x: eatenCell.x, y: eatenCell.y }

    groups.push({ containerId, boxId, interiorId, originalPosition: { x: containerX, y: containerY } })
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/seed.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/generator/seed.ts tools/generator/seed.test.ts
git commit -m "feat(generator): seed 3-4 independent goal groups on a fixed slot grid"
```

---

### Task 2: `generateLevel.ts` — event provenance

**Files:**
- Modify: `tools/generator/generateLevel.ts` (add one field to `GenerationEvent`, add a helper, update the event-push line — everything else in the file is unchanged)
- Modify: `tools/generator/generateLevel.test.ts` (two call-site fixes for the new `createSeedWorld` signature, plus one new test)

**Interfaces:**
- Consumes: `createSeedWorld` (Task 1, for the test file only).
- Produces: `GenerationEvent { kind: GenerationEventKind, direction: Direction, affectedPieceIds: string[] }` (the `affectedPieceIds` field is new) — Task 3 consumes this.

- [ ] **Step 1: Write the failing test**

In `tools/generator/generateLevel.test.ts`, change the two lines that currently read `const seed = createSeedWorld()` to `const seed = createSeedWorld(seededRng(1)).world` (both occurrences — this file already defines the `seededRng` helper; reusing it with a fixed seed value keeps the whole test file deterministic now that `createSeedWorld` takes a random `rng`, rather than defaulting to `Math.random` and making the seed itself vary between runs). Then append this new test:

```ts
test('a push event records every piece that actually moved', () => {
  const world: World = {
    boards: {
      root: {
        id: 'root', size: 5,
        cells: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'floor' as const }))),
      },
    },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 2, y: 2 }, box1: { board: 'root', x: 2, y: 1 } },
  }
  const result = generateLevel(world, 1, () => 0)
  expect(result).not.toBeNull()
  expect(result!.events.length).toBe(1)
  const event = result!.events[0]
  expect(event.kind).toBe('push')
  expect(event.direction).toBe('up')
  expect(new Set(event.affectedPieceIds)).toEqual(new Set(['player', 'box1']))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/generateLevel.test.ts`
Expected: FAIL — `GenerationEvent` doesn't have `affectedPieceIds` yet, so `event.affectedPieceIds` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `tools/generator/generateLevel.ts`, change the `GenerationEvent` interface to:

```ts
export interface GenerationEvent {
  kind: GenerationEventKind
  direction: Direction
  affectedPieceIds: string[]
}
```

Add this helper below the `shuffled` function (no new imports needed — this uses only `World`, already imported):

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

In the main loop, change:

```ts
    world = accepted.world
    seen.add(canonicalKey(world))
    events.push({ kind: accepted.kind, direction })
```

to:

```ts
    const affected = affectedPieceIds(world, accepted.world)
    world = accepted.world
    seen.add(canonicalKey(world))
    events.push({ kind: accepted.kind, direction, affectedPieceIds: affected })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/generateLevel.test.ts`
Expected: PASS (4 tests). If the third test (the pre-existing `seededRng(42)` 5-step test) fails specifically because the result comes back `null`, try `seededRng(7)`, then `seededRng(99)`, then `seededRng(123)` for that test's *walk* rng only (leave the seed's own `seededRng(1)` as-is) — this is the same documented, expected nondeterminism this test already carried before this plan.

- [ ] **Step 5: Commit**

```bash
git add tools/generator/generateLevel.ts tools/generator/generateLevel.test.ts
git commit -m "feat(generator): record which pieces each generation event actually moved"
```

---

### Task 3: `pruneUntouchedGoals.ts` — provenance-driven removal

**Files:**
- Create: `tools/generator/pruneUntouchedGoals.ts`
- Create: `tools/generator/pruneUntouchedGoals.test.ts`

**Interfaces:**
- Consumes: `SeedGroup` (Task 1), `GenerationEvent` (Task 2).
- Produces: `computeTouchedGroups(events: GenerationEvent[], groups: SeedGroup[]): Set<string>`, `pruneUntouchedGoals(world: World, groups: SeedGroup[], touchedGroups: ReadonlySet<string>): World` — Task 4 imports both.

- [ ] **Step 1: Write the failing test**

```ts
import { World, PLAYER_ID } from '../../src/game/engine/types'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { SeedGroup } from './seed'
import { GenerationEvent } from './generateLevel'
import { computeTouchedGroups, pruneUntouchedGoals } from './pruneUntouchedGoals'

function makeGroup(i: number, x: number, y: number): SeedGroup {
  return {
    containerId: `goal${i}`,
    boxId: `box${i}`,
    interiorId: `goal${i}Inside`,
    originalPosition: { x, y },
  }
}

function makeSmallBoard(id: string, size: number) {
  return { id, size, cells: Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const }))) }
}

function makeTwoGroupWorld(): World {
  const size = 12
  const cells = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const })))
  cells[3][3] = { type: 'floor', requirement: 'box' }
  cells[8][8] = { type: 'floor', requirement: 'box' }
  return {
    boards: {
      root: { id: 'root', size, cells },
      goal0Inside: makeSmallBoard('goal0Inside', 3),
      goal1Inside: makeSmallBoard('goal1Inside', 3),
    },
    pieces: {
      player: { id: 'player', kind: 'player' },
      goal0: { id: 'goal0', kind: 'container', boardRef: 'goal0Inside' },
      box0: { id: 'box0', kind: 'normal' },
      goal1: { id: 'goal1', kind: 'container', boardRef: 'goal1Inside' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 1 },
      goal0: { board: 'root', x: 3, y: 3 },
      box0: { board: 'goal0Inside', x: 1, y: 1 },
      goal1: { board: 'root', x: 8, y: 8 },
      box1: { board: 'goal1Inside', x: 1, y: 1 },
    },
  }
}

test('computeTouchedGroups marks a group touched via its containerId', () => {
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const events: GenerationEvent[] = [
    { kind: 'push', direction: 'right', affectedPieceIds: ['player', 'goal1'] },
  ]
  const touched = computeTouchedGroups(events, groups)
  expect(touched.has('goal1')).toBe(true)
  expect(touched.has('goal0')).toBe(false)
})

test('computeTouchedGroups marks a group touched via its boxId alone', () => {
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const events: GenerationEvent[] = [
    { kind: 'eat', direction: 'right', affectedPieceIds: ['box1'] },
  ]
  const touched = computeTouchedGroups(events, groups)
  expect(touched.has('goal1')).toBe(true)
  expect(touched.has('goal0')).toBe(false)
})

test('computeTouchedGroups keeps a group touched even if it moved and later returned to its original position', () => {
  const groups = [makeGroup(0, 3, 3)]
  const events: GenerationEvent[] = [
    { kind: 'push', direction: 'right', affectedPieceIds: ['player', 'goal0'] },
    { kind: 'push', direction: 'left', affectedPieceIds: ['player', 'goal0'] },
  ]
  const touched = computeTouchedGroups(events, groups)
  expect(touched.has('goal0')).toBe(true)
})

test('pruneUntouchedGoals removes an untouched group and keeps a touched one', () => {
  const world = makeTwoGroupWorld()
  world.locations.goal1 = { board: 'root', x: 5, y: 3 } // moved away from (8,8)
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const touched = new Set(['goal1'])

  const result = pruneUntouchedGoals(world, groups, touched)

  expect(result.pieces.goal0).toBeUndefined()
  expect(result.locations.goal0).toBeUndefined()
  expect(result.pieces.box0).toBeUndefined()
  expect(result.locations.box0).toBeUndefined()
  expect(result.boards.goal0Inside).toBeUndefined()
  expect(result.boards.root.cells[3][3].requirement).toBeUndefined()

  expect(result.pieces.goal1).toBeDefined()
  expect(result.locations.goal1).toEqual({ board: 'root', x: 5, y: 3 })
  expect(result.boards.goal1Inside).toBeDefined()
  expect(result.pieces.box1).toBeDefined()
})

test('pruneUntouchedGoals leaves the player untouched', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const result = pruneUntouchedGoals(world, groups, new Set())
  expect(result.pieces[PLAYER_ID]).toBeDefined()
  expect(result.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
})

test('pruneUntouchedGoals removing every group still passes parseLevel', () => {
  const world = makeTwoGroupWorld()
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  const result = pruneUntouchedGoals(world, groups, new Set())
  expect(Object.keys(result.pieces)).toEqual([PLAYER_ID])
  expect(() => parseLevel(serializeLevel(result))).not.toThrow()
})

test('removeGroup refuses to delete the player and throws instead', () => {
  const world = makeTwoGroupWorld()
  // Force the player onto group0's interior -- impossible in a real
  // generateLevel walk (see the spec), hand-built here specifically to
  // exercise the defensive check.
  world.locations.player = { board: 'goal0Inside', x: 0, y: 0 }
  const groups = [makeGroup(0, 3, 3), makeGroup(1, 8, 8)]
  expect(() => pruneUntouchedGoals(world, groups, new Set())).toThrow(/refusing to remove group goal0/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/pruneUntouchedGoals.test.ts`
Expected: FAIL — `Cannot find module './pruneUntouchedGoals'` (the module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

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
      // 'root' for the whole reverse walk (none of the three reverse
      // functions can put the player on an interior board starting from
      // a root-seeded walk), so this branch should never execute in
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

export function pruneUntouchedGoals(world: World, groups: SeedGroup[], touchedGroups: ReadonlySet<string>): World {
  let next = world
  for (const group of groups) {
    if (touchedGroups.has(group.containerId)) continue
    next = removeGroup(next, group)
  }
  return next
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/pruneUntouchedGoals.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/generator/pruneUntouchedGoals.ts tools/generator/pruneUntouchedGoals.test.ts
git commit -m "feat(generator): prune goal groups the reverse walk never touched"
```

---

### Task 4: `generateBatch.ts` — wiring

**Files:**
- Modify: `tools/generator/generateBatch.ts` (only the seed-creation and post-`generateLevel` lines inside `generateLevelBatch` — everything else, including `main()`, is unchanged)
- Test: `tools/generator/generateBatch.test.ts` (no edits expected — run it to confirm it still passes against the new pipeline; only fix it if something genuinely breaks, and if so treat that as a signal to investigate before assuming the test itself is wrong)

**Interfaces:**
- Consumes: `createSeedWorld`/`SeedGroup`/`SeedResult` (Task 1), `computeTouchedGroups`/`pruneUntouchedGoals` (Task 3).

- [ ] **Step 1: Run the existing tests first to record the baseline**

Run: `npx vitest run tools/generator/generateBatch.test.ts`
Expected: PASS (4 tests) — confirms the pre-change baseline is green before you touch the file.

- [ ] **Step 2: Make the wiring change**

In `tools/generator/generateBatch.ts`, add an import:

```ts
import { computeTouchedGroups, pruneUntouchedGoals } from './pruneUntouchedGoals'
```

Inside `generateLevelBatch`'s `while` loop, change:

```ts
    const seed = createSeedWorld()
    const steps = 3 + Math.floor(rng() * 20)
    const generated = generateLevel(seed, steps, rng)
    if (!generated) {
      stats.discardedGenerationFailed++
      continue
    }
    const { world } = generated
```

to:

```ts
    const { world: seed, groups } = createSeedWorld(rng)
    const steps = 3 + Math.floor(rng() * 20)
    const generated = generateLevel(seed, steps, rng)
    if (!generated) {
      stats.discardedGenerationFailed++
      continue
    }

    const touchedGroups = computeTouchedGroups(generated.events, groups)
    const world = pruneUntouchedGoals(generated.world, groups, touchedGroups)
```

Every line after this (the `checkWin` discard check, duplicate detection, `solve`, `countCrossingMoves`, `scoreDifficulty`, tier bucketing) is unchanged — it already operates on the local `world` variable generically. `main()` is untouched.

- [ ] **Step 3: Run the tests again to confirm they still pass**

Run: `npx vitest run tools/generator/generateBatch.test.ts`
Expected: PASS (4 tests), unchanged in count from Step 1. If any test fails, read the failure carefully before editing the test — the four existing assertions (quota reporting, unsolved+parseable levels, no duplicate canonical states, stats accounting) are all still meaningful against the new pipeline and shouldn't need to change in kind; a failure here most likely means a real bug in Task 1-3's code or in the wiring above, not a stale test.

- [ ] **Step 4: Confirm no type errors**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no error references `generateBatch.ts`, `seed.ts`, `generateLevel.ts`, `pruneUntouchedGoals.ts`, or their test files. The only errors that should remain anywhere in the project are the known, out-of-scope ones in `src/editor/EditorScreen.tsx`/`.test.tsx` (a different, not-yet-started sub-project).

- [ ] **Step 5: Commit**

```bash
git add tools/generator/generateBatch.ts
git commit -m "feat(generator): wire the multi-goal seed and pruning into the batch pipeline"
```

---

### Task 5: empirical diagnostic pass, regenerate, and ship

**Files:**
- Create (committed output): `src/levels/builtin/generated/*.json` (replaces the sub-project 4 batch wholesale, per the existing overwrite policy)
- Modify: `src/levels/index.test.ts` (update the `loadGeneratedLevels` assertions to match the newly regenerated content, following the exact pattern sub-project 4's own equivalent task used)
- Possibly modify: `tools/generator/generateBatch.ts` (only the sanctioned tuning knobs — `steps` range, `MAX_ATTEMPTS` — if quota isn't met; see Step 3)

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [ ] **Step 1: Run a direct diagnostic sample**

Write a throwaway script (do not commit it) that samples the new pipeline directly, without going through `generateLevelBatch`'s tier-bucketing logic, so you get the raw distribution rather than a quota-filtered view:

```ts
// scratch-diagnostic.ts (delete after use)
import { createSeedWorld } from './tools/generator/seed'
import { generateLevel } from './tools/generator/generateLevel'
import { computeTouchedGroups, pruneUntouchedGoals } from './tools/generator/pruneUntouchedGoals'
import { solve, countCrossingMoves } from './tools/generator/solver'
import { scoreDifficulty, difficultyTier } from './tools/generator/difficultyScorer'
import { checkWin } from './src/game/engine/rules'

function seededRng(startSeed: number): () => number {
  let s = startSeed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s % 10000) / 10000
  }
}

const SAMPLES = 1000
let generated = 0
let alreadySolved = 0
let unsolvable = 0
const touchedCounts: Record<number, number> = {}
const scores: number[] = []
const tiers: Record<string, number> = { easy: 0, medium: 0, hard: 0 }

for (let i = 0; i < SAMPLES; i++) {
  const rng = seededRng(i)
  const { world: seed, groups } = createSeedWorld(rng)
  const steps = 3 + Math.floor(rng() * 20)
  const result = generateLevel(seed, steps, rng)
  if (!result) continue
  generated++

  const touched = computeTouchedGroups(result.events, groups)
  touchedCounts[touched.size] = (touchedCounts[touched.size] ?? 0) + 1
  const world = pruneUntouchedGoals(result.world, groups, touched)

  if (checkWin(world)) { alreadySolved++; continue }
  const solution = solve(world, 150)
  if (!solution || solution.length === 0) { unsolvable++; continue }

  const crossing = countCrossingMoves(world, solution)
  const score = scoreDifficulty(solution.length, crossing)
  scores.push(score)
  tiers[difficultyTier(score)]++
}

console.log(`samples=${SAMPLES} generated=${generated} alreadySolved=${alreadySolved} unsolvable=${unsolvable}`)
console.log('touchedGroupCount distribution:', touchedCounts)
console.log('score min/max/avg:', Math.min(...scores), Math.max(...scores), scores.reduce((a, b) => a + b, 0) / scores.length)
console.log('tier distribution:', tiers)
```

Run it with `npx tsx scratch-diagnostic.ts`, read the output, and delete the script afterward.

- [ ] **Step 2: Compare against the sub-project 4 baseline**

Sub-project 4's original 2-group seed, after its own fixes, reliably produced `easy=5/5, medium=5/5, hard=0/5` with a measured score ceiling of ~23 (never reaching the `hard` threshold of 25), and every accepted level's `touchedGroupCount` was effectively capped at 1 group (there was only ever one group to touch). Judge this task's output against that: does `touchedGroupCount` now show levels touching 2, 3, or 4 groups, not just 1? Is the score distribution's maximum meaningfully higher than ~23? Neither of these needs to hit a specific target — per the spec, "hard becomes reachable" is a welcome side effect to report, not a requirement — but if the new distribution looks basically identical to the old one (e.g. `touchedGroupCount` is still always 1), that's a signal something in Tasks 1-4 isn't working as intended and needs investigating before proceeding to Step 3.

- [ ] **Step 3: Run the real generator and tune if needed**

Run: `npm run generate:levels`

Read the printed summary. If it reports "Batch incomplete," apply the same sanctioned escalation sub-project 4 established: widen `generateBatch.ts`'s `steps` range (`3 + Math.floor(rng() * 20)` → try `* 30`, `* 40`) and, if that's insufficient, raise `MAX_ATTEMPTS` from 500. Do not modify `seed.ts`'s geometry as part of this tuning — if widening `steps`/`MAX_ATTEMPTS` genuinely isn't enough to reach quota, stop and report back with the diagnostic data from Steps 1-2 rather than redesigning the seed further; that would be a new design decision for the coordinator, not a tuning knob for this task.

- [ ] **Step 4: Update the generated-levels integration test**

In `src/levels/index.test.ts`, the `loadGeneratedLevels` describe block should already assert (from sub-project 4) that loaded levels are unsolved, unique, and solvable. Re-run it against the freshly regenerated files and confirm those assertions still pass as-is — this test doesn't hardcode tier counts or specific level content, so it likely needs no edits, only a fresh run:

Run: `npx vitest run src/levels/index.test.ts`
Expected: PASS

If this test does need updating (e.g. the number of generated files changed in a way an assertion depends on), make the smallest change that keeps it accurate.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: every test file is green except the known, out-of-scope `src/editor/EditorScreen.tsx`/`.test.tsx` failures.

- [ ] **Step 6: Confirm the project builds cleanly**

Run: `npm run build`
Expected: succeeds with no TypeScript errors beyond the known `EditorScreen` exception.

- [ ] **Step 7: Commit**

```bash
git add src/levels/builtin/generated/ src/levels/index.test.ts
# Only if Step 3 required a tuning change:
git add tools/generator/generateBatch.ts
git commit -m "feat(generator): generate and ship the multi-goal level batch"
```

Report the Step 1-2 diagnostic numbers in the commit message body or as a note for the coordinator — this is the evidence the spec's "measure, don't assume" requirement asks for.

---

## Self-Review Notes

- **Spec coverage:** every file the spec names (`seed.ts`, `generateLevel.ts`'s one-field change, the new `pruneUntouchedGoals.ts`, `generateBatch.ts`'s wiring, the migration fix to `generateLevel.test.ts`) has a task; the spec's mandatory diagnostic pass is Task 5's Steps 1-2; the spec's "do not modify seed geometry as a tuning knob" boundary is carried into Task 5 Step 3 explicitly.
- **Placeholder scan:** no step defers code to be written later; every code block is complete and was hand-traced during spec authorship (the `getEntryCell` arithmetic for size 5, the exact 9-value rng sequence covering all 4 directions/both sizes in Task 1's test, the `affectedPieceIds` diff behavior for a 2-piece push in Task 2's test, and the touched/untouched group bookkeeping in Task 3's tests).
- **A subtle correctness point fixed during planning, not left for the implementer to discover:** `generateLevel.test.ts`'s existing tests called bare `createSeedWorld()`, which after Task 1 defaults to `Math.random` — silently making those tests' seed content nondeterministic across runs (only the *walk*'s rng was ever meant to vary). Task 2 explicitly pins the seed to `createSeedWorld(seededRng(1))` so the whole test stays reproducible, not just the parts that already used a fixed rng.
- **Type/name consistency:** `SeedGroup`, `SeedResult`, `GenerationEvent.affectedPieceIds`, `computeTouchedGroups`, and `pruneUntouchedGoals` are named and typed identically everywhere they appear across Tasks 1, 2, 3, and 4.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-06-parabox-generator-multigoal.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
