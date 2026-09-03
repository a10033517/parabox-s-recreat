# Parabox Official-Style Engine Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shipped custom nesting mechanic with a flat multi-board push/enter/eat engine that matches Patrick's Parabox's actual rules, as reverse-engineered from a reference solver's source.

**Architecture:** A flat `World` (boards + pieces + locations, no nested Grid tree) with a recursive move-resolution algorithm (`push` → `enter` → `eat`) ported from the reference solver, using exact-rational (`Fraction`) arithmetic for edge-crossing geometry instead of floating point. Every board is square.

**Tech Stack:** TypeScript, Vitest (`describe`/`it`/`expect`, matches existing project setup — no new dependencies).

**Spec:** `docs/superpowers/specs/2026-09-04-parabox-official-engine-design.md`

## Global Constraints

- `tsconfig.json` has `noUnusedLocals: true` and `noUnusedParameters: true` — every import and parameter must be used, or the build fails. Run `tsc -b --noEmit` before considering any task done.
- No floating-point arithmetic anywhere in `Fraction` or in the move-resolution path — use only integer numerator/denominator math.
- Every board is square (`Board.size`, not independent width/height) — see spec's World invariant 2.
- Every non-root board is referenced by exactly one container; the root board is referenced by none (spec's World invariants 3–6). `levelSchema.ts` enforces this; engine code must never hand-construct a `World` that violates it (except the one deliberate defensive test in Task 6 that proves the engine doesn't infinite-loop if it ever did).
- This plan rewrites `src/game/engine/types.ts`, `rules.ts`, `GameState.ts`, `levelSchema.ts` from scratch. Do not try to preserve or patch the old `Grid`/`Box` tree-based API — it is fully replaced.
- Renderer (`CanvasRenderer.ts`), `GameScreen.tsx`, editor, solver, and generator are explicitly out of scope for this plan (separate future sub-projects) — do not modify them, even if they no longer compile against the new engine types. That breakage is expected and will be fixed by the sub-projects that own those files.
- Every new file lives under `src/game/engine/`.

---

## File Structure

- `src/game/engine/fraction.ts` — exact-rational `Fraction` type and arithmetic (new file)
- `src/game/engine/fraction.test.ts` — tests for the above
- `src/game/engine/types.ts` — `World`/`Board`/`Piece`/`Location` data model and small pure helpers (`inBounds`, `opposite`, `step`, `occupantAt`, `findContainerFor`, `moveTo`, `cloneWorld`) (rewrite, replaces the old `Grid`/`Box` file)
- `src/game/engine/types.test.ts` — tests for the above (rewrite)
- `src/game/engine/testFixtures.ts` — small non-test helper module for building `Board`/`World` fixtures, shared by every test file below (new file)
- `src/game/engine/rules.ts` — `computeTarget`, `getEntryCell`, `applyMove`/`tryMovePiece`/`resolveBlocked`/`tryEnter`, `checkWin` (rewrite, replaces the old push/nesting file)
- `src/game/engine/rules.test.ts` — tests for the above (rewrite)
- `src/game/engine/levelSchema.ts` — `serializeLevel`/`parseLevel` for the new `World` shape, with full invariant validation (rewrite)
- `src/game/engine/levelSchema.test.ts` — tests for the above (rewrite)
- `src/game/engine/GameState.ts` — history/undo wrapper around `World` (rewrite)
- `src/game/engine/GameState.test.ts` — tests for the above (rewrite)

---

### Task 1: Fraction — exact-rational arithmetic

**Files:**
- Create: `src/game/engine/fraction.ts`
- Test: `src/game/engine/fraction.test.ts`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces: `Fraction { numerator: number; denominator: number }`, `makeFraction(n, d)`, `addInt(f, n)`, `divideByInt(f, n)`, `multiplyByInt(f, n)`, `isZero(f)`, `fractionDivMod(f, unit)`, and constants `ZERO`, `HALF`, `ONE`. All consumed by Tasks 3–4.

- [ ] **Step 1: Write the failing tests**

```ts
// src/game/engine/fraction.test.ts
import { describe, it, expect } from 'vitest'
import {
  makeFraction, addInt, divideByInt, multiplyByInt, isZero, fractionDivMod,
  ZERO, HALF, ONE,
} from './fraction'

describe('makeFraction', () => {
  it('reduces to lowest terms', () => {
    expect(makeFraction(2, 4)).toEqual({ numerator: 1, denominator: 2 })
    expect(makeFraction(6, 3)).toEqual({ numerator: 2, denominator: 1 })
  })

  it('normalizes a negative denominator onto the numerator', () => {
    expect(makeFraction(1, -2)).toEqual({ numerator: -1, denominator: 2 })
  })

  it('reduces zero to 0/1 regardless of the input denominator', () => {
    expect(makeFraction(0, 5)).toEqual({ numerator: 0, denominator: 1 })
  })
})

describe('constants', () => {
  it('ZERO, HALF, and ONE have the expected values', () => {
    expect(ZERO).toEqual({ numerator: 0, denominator: 1 })
    expect(HALF).toEqual({ numerator: 1, denominator: 2 })
    expect(ONE).toEqual({ numerator: 1, denominator: 1 })
  })
})

describe('addInt', () => {
  it('adds an integer to a fraction', () => {
    expect(addInt(HALF, 1)).toEqual({ numerator: 3, denominator: 2 })
    expect(addInt(makeFraction(1, 3), 0)).toEqual({ numerator: 1, denominator: 3 })
  })
})

describe('divideByInt', () => {
  it('divides a fraction by an integer', () => {
    expect(divideByInt(makeFraction(3, 2), 3)).toEqual({ numerator: 1, denominator: 2 })
  })
})

describe('multiplyByInt', () => {
  it('multiplies a fraction by an integer', () => {
    expect(multiplyByInt(makeFraction(1, 6), 3)).toEqual({ numerator: 1, denominator: 2 })
    expect(multiplyByInt(ZERO, 4)).toEqual({ numerator: 0, denominator: 1 })
  })
})

describe('isZero', () => {
  it('is true only for a reduced zero fraction', () => {
    expect(isZero(ZERO)).toBe(true)
    expect(isZero(makeFraction(0, 7))).toBe(true)
    expect(isZero(HALF)).toBe(false)
  })
})

describe('fractionDivMod', () => {
  it('splits 1/2 by a unit of 1/3 into offset 1 and remainder 1/6', () => {
    expect(fractionDivMod(HALF, makeFraction(1, 3))).toEqual({
      offset: 1,
      remainder: { numerator: 1, denominator: 6 },
    })
  })

  it('splits 3/8 by a unit of 1/4 into offset 1 and remainder 1/8', () => {
    expect(fractionDivMod(makeFraction(3, 8), makeFraction(1, 4))).toEqual({
      offset: 1,
      remainder: { numerator: 1, denominator: 8 },
    })
  })

  it('splits 2/3 by a unit of 1/3 into offset 2 and a zero remainder', () => {
    expect(fractionDivMod(makeFraction(2, 3), makeFraction(1, 3))).toEqual({
      offset: 2,
      remainder: { numerator: 0, denominator: 1 },
    })
  })

  it('splits 0 by any unit into offset 0 and a zero remainder', () => {
    expect(fractionDivMod(ZERO, makeFraction(1, 3))).toEqual({
      offset: 0,
      remainder: { numerator: 0, denominator: 1 },
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/fraction.test.ts`
Expected: FAIL — `fraction.ts` does not exist yet.

- [ ] **Step 3: Implement `fraction.ts`**

```ts
// src/game/engine/fraction.ts
export interface Fraction {
  numerator: number
  denominator: number
}

function gcd(a: number, b: number): number {
  let x = a
  let y = b
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

export function makeFraction(n: number, d: number): Fraction {
  if (d === 0) throw new Error('Fraction denominator cannot be zero')
  const sign = d < 0 ? -1 : 1
  const num = n * sign
  const den = d * sign
  if (num === 0) return { numerator: 0, denominator: 1 }
  const g = gcd(Math.abs(num), den)
  return { numerator: num / g, denominator: den / g }
}

export function addInt(f: Fraction, n: number): Fraction {
  return makeFraction(f.numerator + n * f.denominator, f.denominator)
}

export function divideByInt(f: Fraction, n: number): Fraction {
  return makeFraction(f.numerator, f.denominator * n)
}

export function multiplyByInt(f: Fraction, n: number): Fraction {
  return makeFraction(f.numerator * n, f.denominator)
}

export function isZero(f: Fraction): boolean {
  return f.numerator === 0
}

export function fractionDivMod(f: Fraction, unit: Fraction): { offset: number; remainder: Fraction } {
  const quotientNumerator = f.numerator * unit.denominator
  const quotientDenominator = f.denominator * unit.numerator
  const offset = Math.floor(quotientNumerator / quotientDenominator)
  const remainder = makeFraction(
    f.numerator * unit.denominator - offset * unit.numerator * f.denominator,
    f.denominator * unit.denominator,
  )
  return { offset, remainder }
}

export const ZERO: Fraction = makeFraction(0, 1)
export const HALF: Fraction = makeFraction(1, 2)
export const ONE: Fraction = makeFraction(1, 1)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/fraction.test.ts`
Expected: PASS (all cases above)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/fraction.ts src/game/engine/fraction.test.ts
git commit -m "feat(engine): add exact-rational Fraction arithmetic"
```

---

### Task 2: World data model, test fixtures, and basic helpers

**Files:**
- Create: `src/game/engine/types.ts`
- Create: `src/game/engine/testFixtures.ts`
- Test: `src/game/engine/types.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: types `BoardId`, `PieceId`, `Direction`, `CellType`, `Requirement`, `Cell`, `Board` (square: `{ id, size, cells }`), `PieceKind`, `Piece`, `Location`, `World`; constant `PLAYER_ID`; functions `inBounds(board, x, y)`, `opposite(dir)`, `step(x, y, dir)`, `occupantAt(world, location)`, `findContainerFor(world, boardId)`, `moveTo(world, pieceId, location)`, `cloneWorld(world)`. Also produces from `testFixtures.ts`: `makeFloorBoard(id, size)`, `setWall(board, x, y)`, `setRequirement(board, x, y, requirement)`, `makeWorld(boards, pieces, locations)`. All of the above are consumed by every later task.

- [ ] **Step 1: Write the failing tests**

```ts
// src/game/engine/types.test.ts
import { describe, it, expect } from 'vitest'
import { inBounds, opposite, step, occupantAt, findContainerFor, moveTo, PLAYER_ID, World } from './types'
import { makeFloorBoard, makeWorld } from './testFixtures'

describe('inBounds', () => {
  it('is true within the board and false outside it', () => {
    const board = makeFloorBoard('root', 3)
    expect(inBounds(board, 0, 0)).toBe(true)
    expect(inBounds(board, 2, 2)).toBe(true)
    expect(inBounds(board, 3, 0)).toBe(false)
    expect(inBounds(board, 0, 3)).toBe(false)
    expect(inBounds(board, -1, 0)).toBe(false)
  })
})

describe('opposite', () => {
  it('reverses each direction', () => {
    expect(opposite('up')).toBe('down')
    expect(opposite('down')).toBe('up')
    expect(opposite('left')).toBe('right')
    expect(opposite('right')).toBe('left')
  })
})

describe('step', () => {
  it('computes the delta for each direction', () => {
    expect(step(1, 1, 'up')).toEqual({ x: 1, y: 0 })
    expect(step(1, 1, 'down')).toEqual({ x: 1, y: 2 })
    expect(step(1, 1, 'left')).toEqual({ x: 0, y: 1 })
    expect(step(1, 1, 'right')).toEqual({ x: 2, y: 1 })
  })
})

describe('occupantAt', () => {
  it('finds the piece at a location, or undefined if empty', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 1 } },
    )
    expect(occupantAt(world, { board: 'root', x: 1, y: 1 })).toBe(PLAYER_ID)
    expect(occupantAt(world, { board: 'root', x: 0, y: 0 })).toBeUndefined()
  })
})

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
})

describe('moveTo', () => {
  it('returns a new world with the piece relocated, leaving the original untouched', () => {
    const world: World = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    const next = moveTo(world, PLAYER_ID, { board: 'root', x: 1, y: 0 })
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
    expect(world.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 0 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: FAIL — `types.ts` and `testFixtures.ts` do not exist yet.

- [ ] **Step 3: Implement `types.ts`**

```ts
// src/game/engine/types.ts
export type BoardId = string
export type PieceId = string
export type Direction = 'up' | 'down' | 'left' | 'right'

export type CellType = 'floor' | 'wall'
export type Requirement = 'box' | 'player'

export interface Cell {
  type: CellType
  requirement?: Requirement
}

export interface Board {
  id: BoardId
  size: number     // every board is size x size
  cells: Cell[][]  // cells[y][x], cells.length === size, cells[y].length === size
}

export type PieceKind = 'player' | 'normal' | 'container'

export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId // present only when kind === 'container'
}

export interface Location {
  board: BoardId
  x: number
  y: number
}

export interface World {
  boards: Record<BoardId, Board>
  pieces: Record<PieceId, Piece>
  locations: Record<PieceId, Location>
}

export const PLAYER_ID: PieceId = 'player'

export function inBounds(board: Board, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < board.size && y < board.size
}

export function opposite(dir: Direction): Direction {
  switch (dir) {
    case 'up': return 'down'
    case 'down': return 'up'
    case 'left': return 'right'
    case 'right': return 'left'
  }
}

export function step(x: number, y: number, dir: Direction): { x: number; y: number } {
  switch (dir) {
    case 'up': return { x, y: y - 1 }
    case 'down': return { x, y: y + 1 }
    case 'left': return { x: x - 1, y }
    case 'right': return { x: x + 1, y }
  }
}

export function occupantAt(world: World, location: Location): PieceId | undefined {
  for (const [pieceId, loc] of Object.entries(world.locations)) {
    if (loc.board === location.board && loc.x === location.x && loc.y === location.y) {
      return pieceId
    }
  }
  return undefined
}

export function findContainerFor(world: World, boardId: BoardId): PieceId | undefined {
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind === 'container' && piece.boardRef === boardId) return piece.id
  }
  return undefined
}

export function cloneWorld(world: World): World {
  return structuredClone(world)
}

export function moveTo(world: World, pieceId: PieceId, location: Location): World {
  const next = cloneWorld(world)
  next.locations[pieceId] = location
  return next
}
```

- [ ] **Step 4: Implement `testFixtures.ts`**

```ts
// src/game/engine/testFixtures.ts
import { Board, Piece, World, Location } from './types'

export function makeFloorBoard(id: string, size: number): Board {
  return {
    id,
    size,
    cells: Array.from({ length: size }, () =>
      Array.from({ length: size }, () => ({ type: 'floor' as const }))),
  }
}

export function setWall(board: Board, x: number, y: number): void {
  board.cells[y][x] = { ...board.cells[y][x], type: 'wall' }
}

export function setRequirement(
  board: Board,
  x: number,
  y: number,
  requirement: 'box' | 'player',
): void {
  board.cells[y][x] = { ...board.cells[y][x], requirement }
}

export function makeWorld(
  boards: Board[],
  pieces: Piece[],
  locations: Record<string, Location>,
): World {
  return {
    boards: Object.fromEntries(boards.map((b) => [b.id, b])),
    pieces: Object.fromEntries(pieces.map((p) => [p.id, p])),
    locations,
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: PASS

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/types.ts src/game/engine/testFixtures.ts src/game/engine/types.test.ts
git commit -m "feat(engine): add flat World data model and test fixtures"
```

---

### Task 3: `computeTarget` — board-exit geometry

**Files:**
- Create: `src/game/engine/rules.ts`
- Test: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `Fraction`/`HALF`/`addInt`/`divideByInt`/`makeFraction` (Task 1); `World`/`Board`/`Location`/`Direction`/`inBounds`/`step`/`findContainerFor` (Task 2); `makeFloorBoard`/`makeWorld` (Task 2).
- Produces: `computeTarget(world, loc, dir, relativeCoord): { location: Location; relativeCoord: Fraction } | null`, consumed by Task 5 (`tryMovePiece`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/game/engine/rules.test.ts
import { describe, it, expect } from 'vitest'
import { computeTarget } from './rules'
import { HALF, makeFraction } from './fraction'
import { makeFloorBoard, makeWorld } from './testFixtures'

describe('computeTarget', () => {
  it('returns the adjacent cell unchanged when it stays within the board', () => {
    const world = makeWorld([makeFloorBoard('root', 3)], [], {})
    const result = computeTarget(world, { board: 'root', x: 1, y: 1 }, 'right', HALF)
    expect(result).toEqual({ location: { board: 'root', x: 2, y: 1 }, relativeCoord: HALF })
  })

  it('exits into the parent board through the container piece that owns this board', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('boardA', 3)],
      [{ id: 'boxA', kind: 'container', boardRef: 'boardA' }],
      { boxA: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'boardA', x: 1, y: 0 }, 'up', HALF)
    expect(result).toEqual({ location: { board: 'root', x: 1, y: 0 }, relativeCoord: HALF })
  })

  it('produces a non-center fraction when exiting from an off-center column', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3), makeFloorBoard('boardA', 3)],
      [{ id: 'boxA', kind: 'container', boardRef: 'boardA' }],
      { boxA: { board: 'root', x: 1, y: 1 } },
    )
    const result = computeTarget(world, { board: 'boardA', x: 0, y: 0 }, 'up', HALF)
    expect(result).toEqual({ location: { board: 'root', x: 1, y: 0 }, relativeCoord: makeFraction(1, 6) })
  })

  it('fails to exit a board nothing else contains (e.g. the root board)', () => {
    const world = makeWorld([makeFloorBoard('root', 3)], [], {})
    const result = computeTarget(world, { board: 'root', x: 0, y: 1 }, 'left', HALF)
    expect(result).toBeNull()
  })

  it('crosses two board boundaries in a single call, chaining through two containers', () => {
    // boardC sits at the left edge of boardB (0,1); boardB in turn sits at
    // the center of root (1,1) — not the edge — so a single 'left' move
    // from the left edge of boardC exits boardC into boardB, immediately
    // exits boardB into root (since boardB's own position there is also
    // at boardB's left edge), and finally lands in-bounds inside root.
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
    expect(result).toEqual({ location: { board: 'root', x: 0, y: 1 }, relativeCoord: HALF })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL — `rules.ts` does not exist yet.

- [ ] **Step 3: Implement `computeTarget` in `rules.ts`**

```ts
// src/game/engine/rules.ts
import { Fraction, addInt, divideByInt } from './fraction'
import { World, Location, Direction, inBounds, step, findContainerFor } from './types'

export function computeTarget(
  world: World,
  loc: Location,
  dir: Direction,
  relativeCoord: Fraction,
): { location: Location; relativeCoord: Fraction } | null {
  const board = world.boards[loc.board]
  const { x, y } = step(loc.x, loc.y, dir)

  if (inBounds(board, x, y)) {
    return { location: { board: loc.board, x, y }, relativeCoord }
  }

  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null

  const offset = dir === 'up' || dir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)

  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, dir, newRelativeCoord)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS (all 5 `computeTarget` cases)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): add computeTarget board-exit geometry"
```

---

### Task 4: `getEntryCell` — entry-point geometry with boundary safety

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `Fraction`/`HALF`/`ONE`/`ZERO`/`isZero`/`multiplyByInt`/`fractionDivMod`/`makeFraction` (Task 1); `Board`/`Direction`/`inBounds` (Task 2); `makeFloorBoard` (Task 2).
- Produces: `getEntryCell(board, dir, relativeCoord): { cell: { x: number; y: number } | null; newRelativeCoord: Fraction }`, consumed by Task 6 (`tryEnter`). The `cell` is `null` when the computed position would fall outside the board — callers must treat that the same as any other blocked entry.

- [ ] **Step 1: Add the failing tests**

Append to `src/game/engine/rules.test.ts`:

```ts
import { getEntryCell } from './rules'
import { ZERO, ONE, makeFraction } from './fraction'

describe('getEntryCell', () => {
  it('lands on the center cell of a 3x3 board for all four directions when relativeCoord is HALF', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'up', HALF)).toEqual({ cell: { x: 1, y: 2 }, newRelativeCoord: HALF })
    expect(getEntryCell(board, 'down', HALF)).toEqual({ cell: { x: 1, y: 0 }, newRelativeCoord: HALF })
    expect(getEntryCell(board, 'left', HALF)).toEqual({ cell: { x: 2, y: 1 }, newRelativeCoord: HALF })
    expect(getEntryCell(board, 'right', HALF)).toEqual({ cell: { x: 0, y: 1 }, newRelativeCoord: HALF })
  })

  it('lands on a non-center cell for a non-center relativeCoord', () => {
    const board = makeFloorBoard('inside', 4)
    expect(getEntryCell(board, 'down', makeFraction(3, 8))).toEqual({
      cell: { x: 1, y: 0 },
      newRelativeCoord: HALF,
    })
  })

  it('backs up one cell on an exact-boundary left/right entry, still in bounds', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'left', makeFraction(2, 3))).toEqual({ cell: { x: 2, y: 1 }, newRelativeCoord: ONE })
    expect(getEntryCell(board, 'right', makeFraction(2, 3))).toEqual({ cell: { x: 0, y: 1 }, newRelativeCoord: ONE })
  })

  it('does not apply the back-up rule to up/down entry on the same exact-boundary input', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'up', makeFraction(2, 3))).toEqual({ cell: { x: 2, y: 2 }, newRelativeCoord: ZERO })
    expect(getEntryCell(board, 'down', makeFraction(2, 3))).toEqual({ cell: { x: 2, y: 0 }, newRelativeCoord: ZERO })
  })

  it('returns a null cell instead of a negative index when the boundary case lands out of bounds', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'left', ZERO)).toEqual({ cell: null, newRelativeCoord: ONE })
    expect(getEntryCell(board, 'right', ZERO)).toEqual({ cell: null, newRelativeCoord: ONE })
  })

  it('never needs the null case for up/down, even at the same zero input', () => {
    const board = makeFloorBoard('inside', 3)
    expect(getEntryCell(board, 'down', ZERO)).toEqual({ cell: { x: 0, y: 0 }, newRelativeCoord: ZERO })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL — `getEntryCell` is not exported yet.

- [ ] **Step 3: Implement `getEntryCell` in `rules.ts`**

Extend the imports at the top of `src/game/engine/rules.ts`:

```ts
import { Fraction, addInt, divideByInt, multiplyByInt, isZero, fractionDivMod, makeFraction } from './fraction'
import { World, Location, Direction, Board, inBounds, step, findContainerFor } from './types'
```

```ts
export function getEntryCell(
  board: Board,
  dir: Direction,
  relativeCoord: Fraction,
): { cell: { x: number; y: number } | null; newRelativeCoord: Fraction } {
  const unit = makeFraction(1, board.size)
  const { offset, remainder } = fractionDivMod(relativeCoord, unit)
  const scaled = multiplyByInt(remainder, board.size)

  const cell = (() => {
    switch (dir) {
      case 'up':    return { x: offset, y: board.size - 1 }
      case 'down':  return { x: offset, y: 0 }
      case 'left':
        return isZero(remainder)
          ? { x: board.size - 1, y: offset - 1 }
          : { x: board.size - 1, y: offset }
      case 'right':
        return isZero(remainder)
          ? { x: 0, y: offset - 1 }
          : { x: 0, y: offset }
    }
  })()

  const newRelativeCoord = isZero(remainder) && (dir === 'left' || dir === 'right')
    ? makeFraction(1, 1)
    : scaled

  if (!inBounds(board, cell.x, cell.y)) {
    return { cell: null, newRelativeCoord }
  }
  return { cell, newRelativeCoord }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS (all `getEntryCell` cases, `computeTarget` cases still passing)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): add getEntryCell entry-point geometry with boundary safety"
```

---

### Task 5: Basic move resolution — push only

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `computeTarget` (Task 3); `World`/`PieceId`/`Direction`/`PLAYER_ID`/`occupantAt`/`moveTo` (Task 2); `HALF` (Task 1).
- Produces: `applyMove(world, dir): World | null`, `tryMovePiece(world, pieceId, dir, inMotion, beingEntered): World | null`, `resolveBlocked(world, pieceId, occupantId, target, dir, inMotion, beingEntered): World | null` — `resolveBlocked` and `tryMovePiece`'s signatures are fixed here and unchanged by Tasks 6–7, which only extend `resolveBlocked`'s body.

- [ ] **Step 1: Add the failing tests**

Append to `src/game/engine/rules.test.ts`:

```ts
import { applyMove } from './rules'
import { PLAYER_ID } from './types'
import { setWall } from './testFixtures'

describe('applyMove — push only', () => {
  it('moves the player into an empty floor cell', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
  })

  it('fails when the target cell is a wall', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 1, 0)
    const world = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })

  it('pushes a single normal box into empty space', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box1', kind: 'normal' }],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        box1: { board: 'root', x: 1, y: 0 },
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
    expect(next?.locations.box1).toEqual({ board: 'root', x: 2, y: 0 })
  })

  it('fails to push a chain of normal boxes against a wall — nothing moves', () => {
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 0)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'box1', kind: 'normal' },
        { id: 'box2', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        box1: { board: 'root', x: 1, y: 0 },
        box2: { board: 'root', x: 2, y: 0 },
      },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL — `applyMove` is not exported yet.

- [ ] **Step 3: Implement `applyMove`/`tryMovePiece`/`resolveBlocked` (push branch only) in `rules.ts`**

Extend the `types` import with `PieceId`/`occupantAt`/`moveTo`/`PLAYER_ID`:

```ts
import {
  World, Location, Direction, Board, PieceId,
  inBounds, step, findContainerFor, occupantAt, moveTo, PLAYER_ID,
} from './types'
```

```ts
export function applyMove(world: World, dir: Direction): World | null {
  return tryMovePiece(world, PLAYER_ID, dir, new Map(), new Set())
}

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

  const targetBoard = world.boards[target.location.board]
  if (targetBoard.cells[target.location.y][target.location.x].type === 'wall') return null

  const occupant = occupantAt(world, target.location)
  if (!occupant) return moveTo(world, pieceId, target.location)

  return resolveBlocked(world, pieceId, occupant, target, dir, inMotion, beingEntered)
}

// beingEntered is threaded through but not yet used by this push-only
// version — Task 6 wires it into the enter branch. Referencing it here
// keeps the signature stable across tasks and satisfies noUnusedParameters.
export function resolveBlocked(
  world: World,
  pieceId: PieceId,
  occupantId: PieceId,
  target: { location: Location; relativeCoord: Fraction },
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  void beingEntered
  const nextInMotion = new Map(inMotion).set(pieceId, dir)

  const pushed = tryMovePiece(world, occupantId, dir, nextInMotion, new Set())
  if (pushed) return moveTo(pushed, pieceId, target.location)

  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS (all tests so far)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): add push-only move resolution (applyMove)"
```

---

### Task 6: Enter mechanic

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `getEntryCell` (Task 4); `resolveBlocked`/`tryMovePiece` signatures (Task 5); `Piece`/`kind` (Task 2).
- Produces: `tryEnter(world, pieceId, intoId, dir, relativeCoord, inMotion, beingEntered): World | null`, extends `resolveBlocked` with the `enter` branch. Consumed by Task 7 (`eat` reuses `tryEnter`) and Task 8 (integration tests).

- [ ] **Step 1: Add the failing tests**

Append to `src/game/engine/rules.test.ts`:

```ts
import { tryEnter } from './rules'

describe('applyMove — enter', () => {
  it('pushes a normal box into an adjacent container box, entering at the center', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'normalBox', kind: 'normal' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        normalBox: { board: 'root', x: 1, y: 1 },
        containerBox: { board: 'root', x: 2, y: 1 },
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
    expect(next?.locations.normalBox).toEqual({ board: 'inside', x: 0, y: 1 })
    expect(next?.locations.containerBox).toEqual({ board: 'root', x: 2, y: 1 })
  })

  it('lets the player walk directly into a container box', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        containerBox: { board: 'root', x: 1, y: 0 },
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'inside', x: 0, y: 1 })
    expect(next?.locations.containerBox).toEqual({ board: 'root', x: 1, y: 0 })
  })

  it('fails to enter when the center entry cell is a wall', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    setWall(inside, 0, 1) // the 'right'-direction entry cell for a 3x3 board
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'normalBox', kind: 'normal' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        normalBox: { board: 'root', x: 1, y: 1 },
        containerBox: { board: 'root', x: 2, y: 1 },
      },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })

  it('fails to enter when the entry cell is occupied by something that cannot itself move', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    setWall(inside, 1, 1) // wall directly behind the entry cell, blocking any further push
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'normalBox', kind: 'normal' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
        { id: 'blocker', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        normalBox: { board: 'root', x: 1, y: 1 },
        containerBox: { board: 'root', x: 2, y: 1 },
        blocker: { board: 'inside', x: 0, y: 1 }, // sits on the entry cell itself
      },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })

  it('tryEnter refuses to enter a container already marked as being entered, without recursing', () => {
    // This is a direct unit test of the beingEntered guard's own
    // short-circuit line, not a black-box test through applyMove. An
    // earlier version of this test tried to trigger the guard indirectly
    // by constructing a container whose boardRef equals the board it sits
    // on (a "self-containing box"). That construction doesn't actually
    // exercise this guard at all: findContainerFor(world, 'root') would
    // return that very container as root's "owner", so computeTarget's
    // board-exit recursion (a separate function with no cycle detection of
    // its own) loops forever on identical arguments before beingEntered is
    // ever consulted. That's a known, deliberately out-of-scope limitation
    // of computeTarget (self-recursive boards are explicitly deferred past
    // this sub-project), not a gap in this guard — and it can never arise
    // from a real level: parseLevel (Task 11) rejects any board that isn't
    // referenced by exactly one container (or, for the one true root,
    // zero), which this shape violates. So instead: call tryEnter directly
    // with a beingEntered set that already contains the target container's
    // id, and assert the guard's own `if (beingEntered.has(intoId)) return
    // null` line fires immediately — no push, no board traversal, no
    // reliance on any other function's cycle behavior.
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        containerBox: { board: 'root', x: 1, y: 1 },
      },
    )
    const result = tryEnter(
      world, PLAYER_ID, 'containerBox', 'right', HALF,
      new Map(), new Set(['containerBox']),
    )
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL — `enter` is not wired into `resolveBlocked` yet, so all `applyMove — enter` cases fail or hang.

- [ ] **Step 3: Implement `tryEnter` and wire it into `resolveBlocked`**

Extend the `types` import with `Piece`:

```ts
import {
  World, Location, Direction, Board, Piece, PieceId,
  inBounds, step, findContainerFor, occupantAt, moveTo, PLAYER_ID,
} from './types'
```

Add `tryEnter` to `src/game/engine/rules.ts`:

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
  if (into.kind !== 'container') return null

  const board = world.boards[into.boardRef as string]
  const { cell, newRelativeCoord } = getEntryCell(board, dir, relativeCoord)
  if (cell === null) return null
  if (board.cells[cell.y][cell.x].type === 'wall') return null

  const target: Location = { board: board.id, x: cell.x, y: cell.y }
  const nextBeingEntered = new Set(beingEntered).add(intoId)

  const occupant = occupantAt(world, target)
  if (!occupant) return moveTo(world, pieceId, target)

  return resolveBlocked(
    world, pieceId, occupant,
    { location: target, relativeCoord: newRelativeCoord },
    dir, inMotion, nextBeingEntered,
  )
}
```

Replace `resolveBlocked`'s body (remove the `void beingEntered` line from Task 5):

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

  const pushed = tryMovePiece(world, occupantId, dir, nextInMotion, new Set())
  if (pushed) return moveTo(pushed, pieceId, target.location)

  const entered = tryEnter(
    world, pieceId, occupantId, dir, target.relativeCoord,
    nextInMotion, beingEntered,
  )
  if (entered) return entered

  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS (all tests so far, including the self-recursion guard case terminating instead of hanging)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): add enter move resolution"
```

---

### Task 7: Eat mechanic

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `tryEnter`/`resolveBlocked` (Task 6); `opposite` (Task 2); `HALF` (Task 1).
- Produces: `resolveBlocked` gains its final `eat` branch. This completes `resolveBlocked`'s public behavior — no further tasks change its body.

- [ ] **Step 1: Add the failing tests**

Append to `src/game/engine/rules.test.ts`:

```ts
describe('applyMove — eat', () => {
  it('absorbs a normal box into the back of a container box being pushed into it', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 3)
    setWall(root, 3, 1) // wall behind the normal box — it cannot be pushed further
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
        { id: 'normalBox', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        containerBox: { board: 'root', x: 1, y: 1 },
        normalBox: { board: 'root', x: 2, y: 1 },
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
    expect(next?.locations.containerBox).toEqual({ board: 'root', x: 2, y: 1 })
    // Eaten from the opposite side (left) of the container's interior, entering at its center.
    expect(next?.locations.normalBox).toEqual({ board: 'inside', x: 2, y: 1 })
  })

  it('fails outright when the mover is not a container (no eat possible)', () => {
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 1)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'normalBox1', kind: 'normal' },
        { id: 'normalBox2', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
        normalBox1: { board: 'root', x: 1, y: 1 },
        normalBox2: { board: 'root', x: 2, y: 1 },
      },
    )
    expect(applyMove(world, 'right')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL — the eat case currently returns `null` because `resolveBlocked` has no `eat` branch.

- [ ] **Step 3: Add the `eat` branch to `resolveBlocked`**

Extend the `types` import in `rules.ts` with `opposite`:

```ts
import {
  World, Location, Direction, Board, Piece, PieceId,
  inBounds, step, findContainerFor, occupantAt, moveTo, opposite, PLAYER_ID,
} from './types'
import { Fraction, addInt, divideByInt, multiplyByInt, isZero, fractionDivMod, makeFraction, HALF } from './fraction'
```

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

  const pushed = tryMovePiece(world, occupantId, dir, nextInMotion, new Set())
  if (pushed) return moveTo(pushed, pieceId, target.location)

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS (all tests so far)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): add eat move resolution, completing resolveBlocked"
```

---

### Task 8: Exit integration and a cross-board occupied-entry chain

**Files:**
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `applyMove` (Tasks 5–7). No new production code — this task is integration-level tests proving the pieces already built compose correctly end to end. If any test here fails, the bug is in `computeTarget`/`getEntryCell`/`resolveBlocked` from earlier tasks — fix it there, not by adding new functions.

- [ ] **Step 1: Add the failing tests**

Append to `src/game/engine/rules.test.ts`:

```ts
describe('applyMove — exiting a box', () => {
  it('lets the player walk out of a container through an open edge into the parent board', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'containerBox', kind: 'container', boardRef: 'inside' },
      ],
      {
        [PLAYER_ID]: { board: 'inside', x: 1, y: 0 },
        containerBox: { board: 'root', x: 1, y: 1 },
      },
    )
    const next = applyMove(world, 'up')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
  })

  it('exits into an occupied cell that requires entering another box, whose own entry cell is also occupied', () => {
    // Player exits boardA into root, landing exactly on containerB (an
    // occupied cell) — this forces an `enter` into boardB. boardB's own
    // entry cell for that direction is occupied by normalBox, which can
    // still be pushed one cell further inside boardB. This exercises
    // exit -> occupied-entry -> enter -> occupied-entry -> recursive push,
    // plus inMotion and beingEntered, together in one fixture.
    const root = makeFloorBoard('root', 3)
    const boardA = makeFloorBoard('boardA', 3)
    const boardB = makeFloorBoard('boardB', 3)
    const world = makeWorld(
      [root, boardA, boardB],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'boxA', kind: 'container', boardRef: 'boardA' },
        { id: 'boxB', kind: 'container', boardRef: 'boardB' },
        { id: 'normalBox', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'boardA', x: 2, y: 1 }, // right edge, middle row
        boxA: { board: 'root', x: 1, y: 1 },           // center of root
        boxB: { board: 'root', x: 2, y: 1 },           // immediately right of boxA
        normalBox: { board: 'boardB', x: 0, y: 1 },     // sits on boardB's 'right'-entry cell
      },
    )
    const next = applyMove(world, 'right')
    expect(next?.locations[PLAYER_ID]).toEqual({ board: 'boardB', x: 0, y: 1 })
    expect(next?.locations.normalBox).toEqual({ board: 'boardB', x: 1, y: 1 })
    expect(next?.locations.boxA).toEqual({ board: 'root', x: 1, y: 1 })
    expect(next?.locations.boxB).toEqual({ board: 'root', x: 2, y: 1 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: These should already PASS if Tasks 3–7 are correct — run them to confirm before moving on. If either fails, treat it as a bug in `computeTarget`, `getEntryCell`, or `resolveBlocked` and fix it there (not here).

- [ ] **Step 3: No new implementation — this task only adds coverage**

(No code changes to `rules.ts` in this task.)

- [ ] **Step 4: Run the full test suite to verify everything still passes**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/rules.test.ts
git commit -m "test(engine): cover box-exit and a cross-board occupied-entry chain"
```

---

### Task 9: Loop / momentum consistency (`inMotion` guard)

**Files:**
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `tryMovePiece` (Task 5), called directly (not via `applyMove`) with a pre-populated `inMotion` map to unit-test the guard in isolation, since constructing real level geometry that naturally produces a push loop requires self-recursive boards (out of scope for this sub-project).

- [ ] **Step 1: Add the failing tests**

Append to `src/game/engine/rules.test.ts`:

```ts
import { tryMovePiece } from './rules'

describe('tryMovePiece — inMotion loop guard', () => {
  it('treats a piece already moving the same direction as a consistent no-op success', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 1 } },
    )
    const inMotion = new Map([['box1', 'right' as const]])
    const result = tryMovePiece(world, 'box1', 'right', inMotion, new Set())
    expect(result).toBe(world) // unchanged world, returned as-is
  })

  it('fails when a piece already moving is asked to move in a conflicting direction', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 3)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 1 } },
    )
    const inMotion = new Map([['box1', 'right' as const]])
    const result = tryMovePiece(world, 'box1', 'up', inMotion, new Set())
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: These should already PASS given Task 5's `tryMovePiece` implementation — run to confirm the guard behaves as designed. If either fails, fix the `inMotion` check at the top of `tryMovePiece`.

- [ ] **Step 3: No new implementation — this task only adds coverage**

(No code changes to `rules.ts` in this task.)

- [ ] **Step 4: Run the full test suite to verify everything still passes**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/rules.test.ts
git commit -m "test(engine): cover the inMotion consistent/conflicting loop guard"
```

---

### Task 10: `checkWin`

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `World`/`Requirement`/`PieceKind` (Task 2); `setRequirement` (Task 2).
- Produces: `checkWin(world): boolean`, consumed by `GameState.ts` (Task 12).

- [ ] **Step 1: Add the failing tests**

Append to `src/game/engine/rules.test.ts`:

```ts
import { checkWin } from './rules'
import { setRequirement } from './testFixtures'

describe('checkWin', () => {
  it('is true when there are no requirements anywhere', () => {
    const world = makeWorld([makeFloorBoard('root', 2)], [], {})
    expect(checkWin(world)).toBe(true)
  })

  it('accepts a normal box on a box requirement', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'box')
    const world = makeWorld(
      [root],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(world)).toBe(true)
  })

  it('accepts a container box on a box requirement', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'box')
    const world = makeWorld(
      [root, makeFloorBoard('inside', 1)],
      [{ id: 'box1', kind: 'container', boardRef: 'inside' }],
      { box1: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(world)).toBe(true)
  })

  it('rejects the player on a box requirement', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'box')
    const world = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(world)).toBe(false)
  })

  it('accepts only the player on a player requirement', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'player')
    const worldWithPlayer = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(worldWithPlayer)).toBe(true)

    const worldWithBox = makeWorld(
      [root],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 0 } },
    )
    expect(checkWin(worldWithBox)).toBe(false)
  })

  it('is false when a requirement anywhere is unmet, even if others are satisfied', () => {
    const root = makeFloorBoard('root', 3)
    setRequirement(root, 1, 0, 'box')
    setRequirement(root, 2, 0, 'box')
    const world = makeWorld(
      [root],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 1, y: 0 } }, // (2,0) has no occupant
    )
    expect(checkWin(world)).toBe(false)
  })

  it('checks requirements across every board, not just the root', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    setRequirement(inside, 1, 0, 'box')
    const world = makeWorld(
      [root, inside],
      [
        { id: 'outerBox', kind: 'container', boardRef: 'inside' },
        { id: 'innerBox', kind: 'normal' },
      ],
      {
        outerBox: { board: 'root', x: 0, y: 0 },
        innerBox: { board: 'inside', x: 1, y: 0 },
      },
    )
    expect(checkWin(world)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL — `checkWin` is not exported yet.

- [ ] **Step 3: Implement `checkWin` in `rules.ts`**

```ts
export function checkWin(world: World): boolean {
  for (const board of Object.values(world.boards)) {
    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const cell = board.cells[y][x]
        if (!cell.requirement) continue
        const occupantId = occupantAt(world, { board: board.id, x, y })
        if (!occupantId) return false
        const occupant = world.pieces[occupantId]
        if (cell.requirement === 'player' && occupant.kind !== 'player') return false
        if (cell.requirement === 'box' && occupant.kind === 'player') return false
      }
    }
  }
  return true
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS (full `rules.test.ts` suite green)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat(engine): add checkWin cell-requirement win condition"
```

---

### Task 11: Level schema — serialize/parse/validate

**Files:**
- Create: `src/game/engine/levelSchema.ts`
- Test: `src/game/engine/levelSchema.test.ts`

**Interfaces:**
- Consumes: `World`/`Board`/`Piece`/`Location`/`PLAYER_ID`/`inBounds` (Task 2).
- Produces: `serializeLevel(world): unknown` (JSON-safe plain object), `parseLevel(data: unknown): World` (throws `Error` with a descriptive message on any structural or referential problem, including every World invariant from the spec). Consumed by Task 12 and by future sub-projects (editor, generator) loading/saving level files.

- [ ] **Step 1: Write the failing tests**

```ts
// src/game/engine/levelSchema.test.ts
import { describe, it, expect } from 'vitest'
import { serializeLevel, parseLevel } from './levelSchema'
import { makeFloorBoard, makeWorld, setRequirement } from './testFixtures'
import { PLAYER_ID, World } from './types'

function sampleWorld(): World {
  const root = makeFloorBoard('root', 2)
  setRequirement(root, 1, 0, 'box')
  const inside = makeFloorBoard('inside', 1)
  return makeWorld(
    [root, inside],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'box1', kind: 'container', boardRef: 'inside' },
    ],
    {
      [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
      box1: { board: 'root', x: 1, y: 0 },
    },
  )
}

describe('serializeLevel / parseLevel round trip', () => {
  it('produces a world equal to the original after serializing and parsing', () => {
    const world = sampleWorld()
    const parsed = parseLevel(serializeLevel(world))
    expect(parsed).toEqual(world)
  })
})

describe('parseLevel structural validation', () => {
  it('rejects data that is not an object', () => {
    expect(() => parseLevel(null)).toThrow()
    expect(() => parseLevel('nope')).toThrow()
  })

  it('rejects a level with no player piece', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, unknown> }
    delete data.pieces[PLAYER_ID]
    expect(() => parseLevel(data)).toThrow(/player/i)
  })

  it('rejects a level with more than one player piece', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, unknown> }
    data.pieces.player2 = { id: 'player2', kind: 'player' }
    expect(() => parseLevel(data)).toThrow(/player/i)
  })

  it('rejects a non-square board', () => {
    const data = serializeLevel(sampleWorld()) as { boards: Record<string, { cells: unknown[] }> }
    data.boards.root.cells.push([{ type: 'floor' }, { type: 'floor' }]) // 3 rows for a declared size of 2
    expect(() => parseLevel(data)).toThrow(/square/i)
  })

  it('rejects a container piece whose boardRef does not exist', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, { boardRef?: string }> }
    data.pieces.box1.boardRef = 'missingBoard'
    expect(() => parseLevel(data)).toThrow(/boardRef/i)
  })

  it('rejects a location that points at a board that does not exist', () => {
    const data = serializeLevel(sampleWorld()) as { locations: Record<string, { board: string }> }
    data.locations.box1.board = 'missingBoard'
    expect(() => parseLevel(data)).toThrow(/board/i)
  })

  it('rejects a location out of bounds for its board', () => {
    const data = serializeLevel(sampleWorld()) as { locations: Record<string, { x: number }> }
    data.locations.box1.x = 99
    expect(() => parseLevel(data)).toThrow(/bounds/i)
  })

  it('rejects a piece with no matching location', () => {
    const data = serializeLevel(sampleWorld()) as { locations: Record<string, unknown> }
    delete data.locations.box1
    expect(() => parseLevel(data)).toThrow(/location/i)
  })

  it('rejects two pieces sharing the same location', () => {
    const data = serializeLevel(sampleWorld()) as {
      pieces: Record<string, unknown>
      locations: Record<string, { board: string; x: number; y: number }>
    }
    data.pieces.box2 = { id: 'box2', kind: 'normal' }
    data.locations.box2 = { ...data.locations.box1 }
    expect(() => parseLevel(data)).toThrow(/occupy/i)
  })
})

describe('parseLevel board-ownership validation', () => {
  it('rejects two containers referencing the same board', () => {
    const data = serializeLevel(sampleWorld()) as {
      pieces: Record<string, unknown>
    }
    data.pieces.box2 = { id: 'box2', kind: 'container', boardRef: 'inside' }
    expect(() => parseLevel(data)).toThrow(/owner/i)
  })

  it('rejects a non-root board referenced by zero containers', () => {
    const data = serializeLevel(sampleWorld()) as {
      boards: Record<string, unknown>
      locations: Record<string, unknown>
    }
    data.boards.orphan = makeFloorBoard('orphan', 1)
    // no piece references 'orphan', and it isn't 'root' — invalid
    expect(() => parseLevel(data)).toThrow(/owner/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: FAIL — `levelSchema.ts` does not exist yet.

- [ ] **Step 3: Implement `levelSchema.ts`**

```ts
// src/game/engine/levelSchema.ts
import { World, Board, Piece, Location, PLAYER_ID, inBounds } from './types'

export function serializeLevel(world: World): unknown {
  return structuredClone(world)
}

export function parseLevel(data: unknown): World {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Level data must be an object')
  }
  const raw = data as { boards?: unknown; pieces?: unknown; locations?: unknown }

  if (typeof raw.boards !== 'object' || raw.boards === null) {
    throw new Error('Level data is missing a "boards" object')
  }
  if (typeof raw.pieces !== 'object' || raw.pieces === null) {
    throw new Error('Level data is missing a "pieces" object')
  }
  if (typeof raw.locations !== 'object' || raw.locations === null) {
    throw new Error('Level data is missing a "locations" object')
  }

  const boards = raw.boards as Record<string, Board>
  const pieces = raw.pieces as Record<string, Piece>
  const locations = raw.locations as Record<string, Location>

  for (const [boardId, board] of Object.entries(boards)) {
    if (board.id !== boardId) {
      throw new Error(`Board "${boardId}" has a mismatched id "${board.id}"`)
    }
    if (board.cells.length !== board.size || board.cells.some((row) => row.length !== board.size)) {
      throw new Error(`Board "${boardId}" must be square: cells do not match its declared size`)
    }
  }

  const playerIds = Object.values(pieces).filter((p) => p.kind === 'player')
  if (playerIds.length !== 1) {
    throw new Error(`Level must have exactly one player piece, found ${playerIds.length}`)
  }
  if (pieces[PLAYER_ID] === undefined || pieces[PLAYER_ID].kind !== 'player') {
    throw new Error(`The player piece must be keyed by id "${PLAYER_ID}"`)
  }

  for (const [pieceId, piece] of Object.entries(pieces)) {
    if (piece.id !== pieceId) {
      throw new Error(`Piece "${pieceId}" has a mismatched id "${piece.id}"`)
    }
    if (piece.kind === 'container') {
      if (piece.boardRef === undefined || boards[piece.boardRef] === undefined) {
        throw new Error(`Container piece "${pieceId}" has a boardRef that does not exist`)
      }
    }
  }

  // Board ownership: every board must be referenced by exactly one
  // container, except a single root board referenced by none.
  const ownerCount: Record<string, number> = Object.fromEntries(
    Object.keys(boards).map((boardId) => [boardId, 0]),
  )
  for (const piece of Object.values(pieces)) {
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
      ownerCount[piece.boardRef] = (ownerCount[piece.boardRef] ?? 0) + 1
    }
  }
  const orphanBoards = Object.entries(ownerCount).filter(([, count]) => count === 0)
  if (orphanBoards.length !== 1) {
    throw new Error(
      `Level must have exactly one board with no owner (the root); found ${orphanBoards.length}`,
    )
  }
  const overOwnedBoards = Object.entries(ownerCount).filter(([, count]) => count > 1)
  if (overOwnedBoards.length > 0) {
    const [boardId] = overOwnedBoards[0]
    throw new Error(`Board "${boardId}" has more than one owner (container referencing it)`)
  }

  for (const [pieceId] of Object.entries(pieces)) {
    if (locations[pieceId] === undefined) {
      throw new Error(`Piece "${pieceId}" has no matching location`)
    }
  }
  const seenCells = new Set<string>()
  for (const [pieceId, loc] of Object.entries(locations)) {
    if (pieces[pieceId] === undefined) {
      throw new Error(`Location "${pieceId}" has no matching piece`)
    }
    const board = boards[loc.board]
    if (board === undefined) {
      throw new Error(`Location for "${pieceId}" references board "${loc.board}", which does not exist`)
    }
    if (!inBounds(board, loc.x, loc.y)) {
      throw new Error(`Location for "${pieceId}" is out of bounds for board "${loc.board}"`)
    }
    const cellKey = `${loc.board}:${loc.x}:${loc.y}`
    if (seenCells.has(cellKey)) {
      throw new Error(`More than one piece would occupy (${loc.board}, ${loc.x}, ${loc.y})`)
    }
    seenCells.add(cellKey)
  }

  return { boards, pieces, locations }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/levelSchema.ts src/game/engine/levelSchema.test.ts
git commit -m "feat(engine): add level schema serialize/parse/validate with board-ownership invariants"
```

---

### Task 12: `GameState` — history/undo wrapper

**Files:**
- Create: `src/game/engine/GameState.ts`
- Test: `src/game/engine/GameState.test.ts`

**Interfaces:**
- Consumes: `World`/`Direction` (Task 2); `applyMove`/`checkWin` (Tasks 5–10).
- Produces: class `GameState` with `constructor(initial: World)`, getter `current: World`, `move(dir: Direction): boolean`, `undo(): boolean`, getter `isWon: boolean`. This is the public API future rendering/controls code (sub-project 2) will drive — no further tasks in this plan change it.

- [ ] **Step 1: Write the failing tests**

```ts
// src/game/engine/GameState.test.ts
import { describe, it, expect } from 'vitest'
import { GameState } from './GameState'
import { makeFloorBoard, makeWorld, setRequirement } from './testFixtures'
import { PLAYER_ID } from './types'

function simpleWorld() {
  return makeWorld(
    [makeFloorBoard('root', 3)],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
}

describe('GameState', () => {
  it('starts at the initial world', () => {
    const world = simpleWorld()
    const state = new GameState(world)
    expect(state.current).toEqual(world)
  })

  it('applies a successful move and updates current', () => {
    const state = new GameState(simpleWorld())
    const ok = state.move('right')
    expect(ok).toBe(true)
    expect(state.current.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 0 })
  })

  it('leaves current unchanged when the move is illegal', () => {
    const world = simpleWorld()
    const state = new GameState(world)
    const ok = state.move('left') // x=0, moving left goes out of bounds with no container
    expect(ok).toBe(false)
    expect(state.current).toEqual(world)
  })

  it('undoes the most recent move', () => {
    const state = new GameState(simpleWorld())
    state.move('right')
    const ok = state.undo()
    expect(ok).toBe(true)
    expect(state.current.locations[PLAYER_ID]).toEqual({ board: 'root', x: 0, y: 0 })
  })

  it('fails to undo past the initial state', () => {
    const state = new GameState(simpleWorld())
    expect(state.undo()).toBe(false)
  })

  it('reports isWon based on the current state', () => {
    const root = makeFloorBoard('root', 2)
    setRequirement(root, 1, 0, 'player')
    const world = makeWorld(
      [root],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    const state = new GameState(world)
    expect(state.isWon).toBe(false)
    state.move('right')
    expect(state.isWon).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: FAIL — `GameState.ts` does not exist yet.

- [ ] **Step 3: Implement `GameState.ts`**

```ts
// src/game/engine/GameState.ts
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check, run the full engine test suite, and commit**

```bash
npx tsc -b --noEmit
npx vitest run src/game/engine
git add src/game/engine/GameState.ts src/game/engine/GameState.test.ts
git commit -m "feat(engine): add GameState history/undo wrapper"
```

---

## Plan self-review notes

- **Spec coverage:** Fraction (Task 1) → World/flat model + square-board invariant (Task 2) → computeTarget, including the two-hop exit case (Task 3) → getEntryCell with boundary safety (Task 4) → push (Task 5) → enter, including the self-recursion defensive test (Task 6) → eat (Task 7) → exit + cross-board occupied-entry integration (Task 8) → inMotion loop guard (Task 9) → checkWin (Task 10) → levelSchema with full board-ownership validation (Task 11) → GameState (Task 12). Every section of the spec — architecture, World invariants, fraction, algorithm, win condition, box-type mapping, testing strategy, level-schema validation list, migration note's 4 named files — maps to a task.
- **The reviewer's requested "one fixture that proves everything together" (fractional offset, exit, entry, recursive push, recursive enter, eat, beingEntered, inMotion) is deliberately split** across Task 3 (two-hop exit + non-center fraction), Task 6 (entry + beingEntered + recursive push inside enter), Task 7 (eat), and Task 8 (the exit → occupied entry → occupied entry → recursive push chain) rather than forced into one mega-fixture — each task still produces an independently reviewable, appropriately-scoped deliverable, and between them every element on the reviewer's list is exercised by a concrete, hand-verified test.
- **Type/signature consistency:** `tryMovePiece` and `resolveBlocked` both carry `beingEntered: Set<PieceId>` from their first appearance in Task 5 (even though it's unused until Task 6) specifically so their signatures don't change shape across tasks. `getEntryCell`'s `cell` field is `{ x: number; y: number } | null` from its first appearance in Task 4, and `tryEnter` (Task 6) checks for `null` from the start — no task needs to retrofit that check.
- **Box-type mapping table** from the spec is realized directly by the `PieceKind` union (`'player' | 'normal' | 'container'`) in Task 2 — no separate mapping code needed, the type *is* the mapping.
