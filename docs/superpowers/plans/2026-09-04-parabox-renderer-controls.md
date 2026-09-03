# Parabox Renderer & Controls Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game playable again against the new `World` engine (sub-project 1), rendering the new "player enters a box" mechanic via a camera-cut model, with no changes needed to touch controls.

**Architecture:** `CanvasRenderer.renderBoard` draws exactly one `Board` (no recursion — the flat `World` model has nothing to recurse into). `GameScreen` holds a mutable `GameState` instance in a `useRef` paired with a tick counter to force re-renders, and re-renders whichever board the player's current location points at — a hard cut, no transition animation. `App.tsx` gets the minimal wiring needed to actually run this in a browser: a renamed prop, a lazy-loaded (and error-boundary-wrapped) editor import so its unrelated brokenness can't crash the whole app, and level loading rewritten against the new `World`-based schema.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, `@testing-library/react`/`user-event` — matches the existing project, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-parabox-renderer-controls-design.md`

## Global Constraints

- `tsconfig.json` has `noUnusedLocals: true` and `noUnusedParameters: true` — every import and parameter must be used, or `npx tsc -b --noEmit` fails on the files this plan touches. (The editor, solver, and generator are known to fail `tsc` already and are explicitly out of scope — do not try to make the whole-project `tsc` run clean.)
- No transition animation on board switch — a hard cut only.
- No breadcrumb or "where am I" navigation UI.
- `editor/EditorScreen.tsx`, `tools/generator/*`, and their tests remain untouched and non-compiling — sub-projects 3 and 4's job, not this plan's. Do not modify them.
- `src/ui/DPad.tsx` and `src/ui/SwipeLayer.tsx` are expected to need zero code changes (they only ever consumed the `Direction` type, which is unchanged) — verify this by reading them, don't blindly rewrite them.

---

## File Structure

- `src/game/engine/GameState.ts` — add one additive getter (`moveCount`); the class itself is already shipped and reviewed from sub-project 1
- `src/game/engine/GameState.test.ts` — add one test for the new getter
- `src/game/render/CanvasRenderer.ts` — rewritten: `renderBoard(ctx, board, world, cellSize)`, no recursion
- `src/game/render/CanvasRenderer.test.ts` — rewritten against `renderBoard`
- `src/levels/index.ts` — rewritten: `LevelMeta.world: World` (was `.grid: Grid`), `parseLevel(JSON.parse(raw))`, `loadGeneratedLevels`/`loadCustomLevels` stubbed to `[]`
- `src/levels/index.test.ts` — rewritten
- `src/levels/builtin/01-first-push.json` — rewritten (new `World` JSON shape)
- `src/levels/builtin/02-enter-container.json` — new
- `src/levels/builtin/03-chain-push.json` — new
- `src/levels/builtin/04-eat.json` — new
- `src/levels/builtin/05-double-nested.json` — new
- `src/levels/builtin/02-single-nest.json`, `03-chain-nest.json` — deleted (old incompatible format)
- `src/levels/builtin/generated/*` — deleted (old incompatible format; sub-project 4 regenerates)
- `src/ui/LevelSelect.test.tsx` — small fix: fixture objects use `world` instead of `grid`
- `src/game/GameScreen.tsx` — rewritten: `initialWorld` prop, mutable `GameState` in a `useRef` + tick-based re-render, renders whichever board the player is currently on
- `src/game/GameScreen.test.tsx` — rewritten
- `src/App.tsx` — `initialWorld` prop rename, `EditorScreen` lazy-loaded behind an error boundary
- `src/App.test.tsx` — two tests testing now-deferred custom-level loading replaced; others adjusted for the new level set

---

### Task 1: `GameState.moveCount`

**Files:**
- Modify: `src/game/engine/GameState.ts`
- Modify: `src/game/engine/GameState.test.ts`

**Interfaces:**
- Consumes: the existing `GameState` class (`current`, `isWon`, `move`, `undo`, all already shipped) and its private `history: World[]` field.
- Produces: `get moveCount(): number`, consumed by Task 4 (`GameScreen`'s step counter).

- [ ] **Step 1: Write the failing test**

Add to the `describe('GameState', ...)` block in `src/game/engine/GameState.test.ts` (it already has a `simpleWorld()` helper at the top — reuse it, don't redefine it):

```ts
  it('reports moveCount as the number of moves currently in history, decremented by undo', () => {
    const state = new GameState(simpleWorld())
    expect(state.moveCount).toBe(0)
    state.move('right')
    expect(state.moveCount).toBe(1)
    state.move('right')
    expect(state.moveCount).toBe(2)
    state.undo()
    expect(state.moveCount).toBe(1)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: FAIL — `moveCount` does not exist on `GameState`.

- [ ] **Step 3: Add the getter**

In `src/game/engine/GameState.ts`, add alongside the existing `isWon` getter:

```ts
  get moveCount(): number {
    return this.history.length - 1
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: PASS (all 7 tests: the 6 pre-existing plus the new one)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/engine/GameState.ts src/game/engine/GameState.test.ts
git commit -m "feat(engine): add GameState.moveCount getter"
```

---

### Task 2: `CanvasRenderer.renderBoard`

**Files:**
- Create: `src/game/render/CanvasRenderer.ts` (overwrites the old recursive `renderGrid` version)
- Create: `src/game/render/CanvasRenderer.test.ts` (overwrites the old test file)

**Interfaces:**
- Consumes: `Board`, `PieceKind`, `World` from `../engine/types` (all shipped in sub-project 1); `makeFloorBoard`, `makeWorld`, `setWall`, `setRequirement` from `../engine/testFixtures` (also shipped).
- Produces: `renderBoard(ctx: CanvasRenderingContext2D, board: Board, world: World, cellSize: number): void`, consumed by Task 4 (`GameScreen`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/game/render/CanvasRenderer.test.ts
import { describe, it, expect } from 'vitest'
import { renderBoard } from './CanvasRenderer'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from '../engine/testFixtures'
import { PLAYER_ID } from '../engine/types'

function mockContext() {
  return { fillRect: () => {}, fillStyle: '' } as unknown as CanvasRenderingContext2D
}

describe('renderBoard', () => {
  it('draws one rect per cell for a board with no requirements or pieces', () => {
    const board = makeFloorBoard('root', 3)
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    renderBoard(ctx, board, world, 32)
    expect(calls).toBe(9) // 3x3 cells
  })

  it('draws an extra overlay rect for each cell with a requirement', () => {
    const board = makeFloorBoard('root', 2)
    setRequirement(board, 1, 0, 'box')
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    renderBoard(ctx, board, world, 32)
    expect(calls).toBe(5) // 4 cells + 1 requirement overlay
  })

  it('draws one rect per piece located on the rendered board, and skips pieces on other boards', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'box1', kind: 'normal' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        box1: { board: 'inside', x: 0, y: 0 }, // on the OTHER board
      },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    renderBoard(ctx, root, world, 32)
    expect(calls).toBe(5) // 4 cells + 1 piece (player only; box1 is on 'inside')
  })

  it('uses a different fillStyle for a wall cell than a floor cell', () => {
    const board = makeFloorBoard('root', 2)
    setWall(board, 1, 0)
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    const stylesAtFillTime: string[] = []
    ctx.fillRect = () => { stylesAtFillTime.push(ctx.fillStyle as string) }
    renderBoard(ctx, board, world, 32)
    // cells are visited row-major: (0,0) floor, (1,0) wall, (0,1) floor, (1,1) floor
    expect(stylesAtFillTime[0]).not.toBe(stylesAtFillTime[1])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: FAIL — `renderBoard` is not exported yet (the old file still exports `renderGrid`).

- [ ] **Step 3: Implement `renderBoard`**

```ts
// src/game/render/CanvasRenderer.ts
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

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  world: World,
  cellSize: number,
): void {
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      const cell = board.cells[y][x]
      ctx.fillStyle = cell.type === 'wall' ? WALL_COLOR : FLOOR_COLOR
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)

      if (cell.requirement) {
        ctx.fillStyle = REQUIREMENT_OVERLAY[cell.requirement]
        const inset = cellSize / 4
        ctx.fillRect(x * cellSize + inset, y * cellSize + inset, cellSize - inset * 2, cellSize - inset * 2)
      }
    }
  }

  for (const [pieceId, location] of Object.entries(world.locations)) {
    if (location.board !== board.id) continue
    const piece = world.pieces[pieceId]
    ctx.fillStyle = PIECE_COLORS[piece.kind]
    ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/render/CanvasRenderer.ts src/game/render/CanvasRenderer.test.ts
git commit -m "feat(render): rewrite CanvasRenderer against the flat World model"
```

---

### Task 3: Level loading and the five builtin levels

**Files:**
- Delete: `src/levels/builtin/02-single-nest.json`, `src/levels/builtin/03-chain-nest.json`, `src/levels/builtin/generated/*` (5 files)
- Modify: `src/levels/builtin/01-first-push.json` (new content, old format)
- Create: `src/levels/builtin/02-enter-container.json`, `03-chain-push.json`, `04-eat.json`, `05-double-nested.json`
- Create: `src/levels/index.ts` (overwrites old content)
- Create: `src/levels/index.test.ts` (overwrites old content)
- Modify: `src/ui/LevelSelect.test.tsx`

**Interfaces:**
- Consumes: `parseLevel` from `../game/engine/levelSchema`, `World` from `../game/engine/types` (both shipped); `checkWin` from `../game/engine/rules` (shipped, used only in this task's tests); `listCustomLevels` from `../storage/progress` is **no longer imported** (the old `levels/index.ts` imported it; the new one doesn't call it at all, since `loadCustomLevels` no longer reads storage).
- Produces: `LevelMeta { id: string; name: string; world: World }`, `BUILTIN_LEVELS: LevelMeta[]`, `loadGeneratedLevels(): LevelMeta[]`, `loadCustomLevels(): LevelMeta[]`, `CUSTOM_LEVEL_ID_PREFIX: string` — consumed by Task 4 (`GameScreen`'s `initialWorld` prop shape) and Task 5 (`App.tsx`).

- [ ] **Step 1: Delete the old incompatible level files**

```bash
rm src/levels/builtin/02-single-nest.json src/levels/builtin/03-chain-nest.json
rm -rf src/levels/builtin/generated
```

- [ ] **Step 2: Write the five level JSON files**

`src/levels/builtin/01-first-push.json` — a 3×3 open board, no containers. One push wins.

```json
{
  "boards": {
    "root": {
      "id": "root",
      "size": 3,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor", "requirement": "box" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    }
  },
  "pieces": {
    "player": { "id": "player", "kind": "player" },
    "box1": { "id": "box1", "kind": "normal" }
  },
  "locations": {
    "player": { "board": "root", "x": 0, "y": 1 },
    "box1": { "board": "root", "x": 1, "y": 1 }
  }
}
```

`src/levels/builtin/02-enter-container.json` — the wall at `root(2,1)` is load-bearing: the algorithm always tries `push` before `enter`, so without something blocking the container from sliding, the player would push it instead of ever entering it.

```json
{
  "boards": {
    "root": {
      "id": "root",
      "size": 3,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "wall" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    },
    "inside": {
      "id": "inside",
      "size": 3,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor", "requirement": "player" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    }
  },
  "pieces": {
    "player": { "id": "player", "kind": "player" },
    "containerBox": { "id": "containerBox", "kind": "container", "boardRef": "inside" }
  },
  "locations": {
    "player": { "board": "root", "x": 0, "y": 1 },
    "containerBox": { "board": "root", "x": 1, "y": 1 }
  }
}
```

`src/levels/builtin/03-chain-push.json` — two `normal` boxes pushed as a chain.

```json
{
  "boards": {
    "root": {
      "id": "root",
      "size": 4,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor", "requirement": "box" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    }
  },
  "pieces": {
    "player": { "id": "player", "kind": "player" },
    "box1": { "id": "box1", "kind": "normal" },
    "box2": { "id": "box2", "kind": "normal" }
  },
  "locations": {
    "player": { "board": "root", "x": 0, "y": 1 },
    "box1": { "board": "root", "x": 1, "y": 1 },
    "box2": { "board": "root", "x": 2, "y": 1 }
  }
}
```

`src/levels/builtin/04-eat.json` — pushing the container into the wall-blocked `normal` box absorbs it (the "eat" mechanic); the box lands exactly on `inside`'s requirement cell, so this solves in one push.

```json
{
  "boards": {
    "root": {
      "id": "root",
      "size": 4,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "wall" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    },
    "inside": {
      "id": "inside",
      "size": 3,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor", "requirement": "box" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    }
  },
  "pieces": {
    "player": { "id": "player", "kind": "player" },
    "containerBox": { "id": "containerBox", "kind": "container", "boardRef": "inside" },
    "normalBox": { "id": "normalBox", "kind": "normal" }
  },
  "locations": {
    "player": { "board": "root", "x": 0, "y": 1 },
    "containerBox": { "board": "root", "x": 1, "y": 1 },
    "normalBox": { "board": "root", "x": 2, "y": 1 }
  }
}
```

`src/levels/builtin/05-double-nested.json` — a box inside a box; entering both is required to win (4 moves, 2 camera switches).

```json
{
  "boards": {
    "root": {
      "id": "root",
      "size": 3,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "wall" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    },
    "boardA": {
      "id": "boardA",
      "size": 3,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "wall" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    },
    "boardB": {
      "id": "boardB",
      "size": 3,
      "cells": [
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor", "requirement": "player" }],
        [{ "type": "floor" }, { "type": "floor" }, { "type": "floor" }]
      ]
    }
  },
  "pieces": {
    "player": { "id": "player", "kind": "player" },
    "containerA": { "id": "containerA", "kind": "container", "boardRef": "boardA" },
    "containerB": { "id": "containerB", "kind": "container", "boardRef": "boardB" }
  },
  "locations": {
    "player": { "board": "root", "x": 0, "y": 1 },
    "containerA": { "board": "root", "x": 1, "y": 1 },
    "containerB": { "board": "boardA", "x": 1, "y": 1 }
  }
}
```

- [ ] **Step 3: Write the failing tests**

```ts
// src/levels/index.test.ts
import { describe, it, expect } from 'vitest'
import { BUILTIN_LEVELS, CUSTOM_LEVEL_ID_PREFIX, loadCustomLevels, loadGeneratedLevels } from './index'
import { checkWin } from '../game/engine/rules'
import { PLAYER_ID } from '../game/engine/types'

describe('BUILTIN_LEVELS', () => {
  it('has one entry per shipped level file, each parsing to an unsolved world', () => {
    expect(BUILTIN_LEVELS).toHaveLength(5)
    for (const level of BUILTIN_LEVELS) {
      expect(level.world.locations[PLAYER_ID]).toBeDefined()
      expect(checkWin(level.world)).toBe(false)
    }
  })

  it('includes the expected level ids in order', () => {
    expect(BUILTIN_LEVELS.map((l) => l.id)).toEqual([
      '01-first-push',
      '02-enter-container',
      '03-chain-push',
      '04-eat',
      '05-double-nested',
    ])
  })
})

describe('loadGeneratedLevels', () => {
  it('returns an empty array (sub-project 4 rebuilds the generator against the new format)', () => {
    expect(loadGeneratedLevels()).toEqual([])
  })
})

describe('loadCustomLevels', () => {
  it('returns an empty array (sub-project 3 rebuilds the editor against the new format)', () => {
    expect(loadCustomLevels()).toEqual([])
  })
})

it('still exports CUSTOM_LEVEL_ID_PREFIX for future use', () => {
  expect(CUSTOM_LEVEL_ID_PREFIX).toBe('custom:')
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/levels/index.test.ts`
Expected: FAIL — `src/levels/index.ts` still has the old `Grid`-based implementation, so this either fails to compile or fails on `.world`/`.grid` mismatches.

- [ ] **Step 5: Implement `levels/index.ts`**

```ts
// src/levels/index.ts
import { parseLevel } from '../game/engine/levelSchema'
import { World } from '../game/engine/types'
import level01 from './builtin/01-first-push.json?raw'
import level02 from './builtin/02-enter-container.json?raw'
import level03 from './builtin/03-chain-push.json?raw'
import level04 from './builtin/04-eat.json?raw'
import level05 from './builtin/05-double-nested.json?raw'

export interface LevelMeta {
  id: string
  name: string
  world: World
}

export const BUILTIN_LEVELS: LevelMeta[] = [
  { id: '01-first-push', name: '第一次推动', world: parseLevel(JSON.parse(level01)) },
  { id: '02-enter-container', name: '进入箱子', world: parseLevel(JSON.parse(level02)) },
  { id: '03-chain-push', name: '连锁推动', world: parseLevel(JSON.parse(level03)) },
  { id: '04-eat', name: '箱子吞噬', world: parseLevel(JSON.parse(level04)) },
  { id: '05-double-nested', name: '双层嵌套', world: parseLevel(JSON.parse(level05)) },
]

// Sub-project 4 rebuilds the generator against the new World format; nothing in
// that format exists yet.
export function loadGeneratedLevels(): LevelMeta[] {
  return []
}

// Custom level names are chosen by the user, so they could collide with a
// builtin id and silently share its completion record. The stored id stays
// the display name; only the LevelMeta id carries the prefix.
export const CUSTOM_LEVEL_ID_PREFIX = 'custom:'

// Sub-project 3 rebuilds the editor against the new World format; any levels
// saved by the old editor are in the old, incompatible format.
export function loadCustomLevels(): LevelMeta[] {
  return []
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/levels/index.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 7: Fix `LevelSelect.test.tsx`'s fixtures**

`LevelSelect.tsx` itself does not reference `.grid`/`.world` (it only displays `id`/`name`), so only the test file's inline `LevelMeta`-shaped fixtures need updating:

```ts
// src/ui/LevelSelect.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LevelSelect } from './LevelSelect'
import { makeFloorBoard, makeWorld } from '../game/engine/testFixtures'
import { PLAYER_ID } from '../game/engine/types'

function tinyWorld() {
  return makeWorld(
    [makeFloorBoard('root', 1)],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
}

test('lists levels and marks completed ones', () => {
  const levels = [
    { id: 'a', name: '关卡 A', world: tinyWorld() },
    { id: 'b', name: '关卡 B', world: tinyWorld() },
  ]
  render(<LevelSelect levels={levels} completedIds={['a']} onSelect={() => {}} onBack={() => {}} />)
  expect(screen.getByText('关卡 A ✓')).toBeInTheDocument()
  expect(screen.getByText('关卡 B')).toBeInTheDocument()
})

test('clicking a level calls onSelect with it', async () => {
  const levels = [{ id: 'a', name: '关卡 A', world: tinyWorld() }]
  const onSelect = vi.fn()
  render(<LevelSelect levels={levels} completedIds={[]} onSelect={onSelect} onBack={() => {}} />)
  await userEvent.setup().click(screen.getByText('关卡 A'))
  expect(onSelect).toHaveBeenCalledWith(levels[0])
})
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/ui/LevelSelect.test.tsx`
Expected: PASS (both tests)

- [ ] **Step 9: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/levels/ src/ui/LevelSelect.test.tsx
git commit -m "feat(levels): rewrite level loading against the World schema, replace incompatible builtin levels"
```

---

### Task 4: `GameScreen`

**Files:**
- Create: `src/game/GameScreen.tsx` (overwrites old content)
- Create: `src/game/GameScreen.test.tsx` (overwrites old content)

**Interfaces:**
- Consumes: `GameState` (Task 1's `moveCount` included) from `./engine/GameState`; `Direction`, `PLAYER_ID`, `World` from `./engine/types`; `renderBoard` (Task 2) from `./render/CanvasRenderer`; `DPad` from `../ui/DPad`; `SwipeLayer` from `../ui/SwipeLayer` (neither needs changes — verify by reading them first).
- Produces: `GameScreen({ initialWorld: World; onExit: () => void; onWin: () => void })`, consumed by Task 5 (`App.tsx`).

- [ ] **Step 1: Verify DPad/SwipeLayer need no changes**

Read `src/ui/DPad.tsx` and `src/ui/SwipeLayer.tsx`. Both should only import `Direction` from `../game/engine/types` and nothing else engine-related. If either references anything beyond the `Direction` type, STOP and report — that would mean the spec's assumption was wrong and needs the controller's attention before proceeding.

- [ ] **Step 2: Write the failing tests**

```tsx
// src/game/GameScreen.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GameScreen } from './GameScreen'
import { makeFloorBoard, makeWorld, setRequirement, setWall } from './engine/testFixtures'
import { PLAYER_ID } from './engine/types'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

function simpleWorld() {
  return makeWorld(
    [makeFloorBoard('root', 3)],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
}

test('pressing a DPad button increments the step counter', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 1')).toBeInTheDocument()
})

test('undo button decrements the step counter', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByText('复位上一步'))
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
})

test('entering a container swaps the rendered board and resizes the canvas', async () => {
  const root = makeFloorBoard('root', 3)
  setWall(root, 2, 1) // block the container from being pushed, forcing entry instead
  const inside = makeFloorBoard('inside', 5)
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
  const { container } = render(<GameScreen initialWorld={world} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  const canvas = container.querySelector('canvas')!
  expect(canvas.width).toBe(5 * 32) // 'inside' is size 5, CELL_SIZE is 32
})

test('reaching the win condition calls onWin exactly once', async () => {
  const root = makeFloorBoard('root', 2)
  setRequirement(root, 1, 0, 'player')
  const world = makeWorld(
    [root],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
  const onWin = vi.fn()
  render(<GameScreen initialWorld={world} onExit={() => {}} onWin={onWin} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  expect(onWin).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: FAIL — `GameScreen`'s current implementation still expects `initialGrid` and the old function-style `GameState` API.

- [ ] **Step 4: Implement `GameScreen.tsx`**

```tsx
// src/game/GameScreen.tsx
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
        <button
          onClick={() => {
            if (state.undo()) setTick((t) => t + 1)
          }}
        >
          复位上一步
        </button>
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc -b --noEmit
git add src/game/GameScreen.tsx src/game/GameScreen.test.tsx
git commit -m "feat(game): rewrite GameScreen against GameState and renderBoard, add camera-cut board switching"
```

---

### Task 5: `App.tsx` — minimal wiring, lazy editor behind an error boundary

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `GameScreen` (Task 4, `initialWorld` prop); `BUILTIN_LEVELS`/`loadCustomLevels`/`loadGeneratedLevels`/`LevelMeta` (Task 3).
- Produces: nothing further downstream — this is the top of the tree.

- [ ] **Step 1: Write the failing tests**

`App.test.tsx`'s tests 3 and 4 currently exercise custom-level loading, which `loadCustomLevels` now permanently stubs to `[]` (Task 3) — those two tests are replaced, not merely patched, since the behavior they asserted no longer exists by design. A new test is added covering the editor's error-boundary fallback (this app previously had no way to reach the editor without crashing at all, so there's no old test to replace here — it's new coverage for new behavior).

```tsx
// src/App.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  localStorage.clear()
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

test('renders the menu screen by default', () => {
  render(<App />)
  expect(screen.getByText('Parabox Tribute')).toBeInTheDocument()
})

test('navigating from menu to level select shows builtin levels', async () => {
  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.getByText('第一次推动')).toBeInTheDocument()
})

test('a saved custom level does not appear yet (loading is deferred to a future sub-project)', async () => {
  const { saveCustomLevel } = await import('./storage/progress')
  saveCustomLevel('我的关卡', 'irrelevant in the new format')
  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.queryByText('我的关卡')).not.toBeInTheDocument()
})

test('a corrupt completed-levels value does not white-screen level select', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  localStorage.setItem('parabox:completedLevels', 'not valid json')
  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.getByText('第一次推动')).toBeInTheDocument()
})

test('the broken editor screen fails gracefully instead of crashing the whole app', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<App />)
  await userEvent.setup().click(screen.getByText('关卡编辑器'))
  expect(await screen.findByText('关卡编辑器暂时无法使用')).toBeInTheDocument()
  await userEvent.setup().click(screen.getByText('返回'))
  expect(screen.getByText('Parabox Tribute')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — `App.tsx` still imports `EditorScreen` statically (crashing module load entirely) and passes `initialGrid` to `GameScreen`.

- [ ] **Step 3: Implement `App.tsx`**

```tsx
// src/App.tsx
import { Component, lazy, ReactNode, Suspense, useState } from 'react'
import { MenuScreen } from './ui/MenuScreen'
import { LevelSelect } from './ui/LevelSelect'
import { GameScreen } from './game/GameScreen'
import { BUILTIN_LEVELS, loadCustomLevels, loadGeneratedLevels, LevelMeta } from './levels'
import { isLevelComplete, listCompletedLevels, markLevelComplete } from './storage/progress'

// Lazy-loaded: EditorScreen still targets the pre-World engine API and won't
// compile until sub-project 3 rebuilds it. A static import would fail at
// module-link time and crash every screen, not just the editor — deferring
// the import means only navigating into the editor hits that failure.
const EditorScreen = lazy(() => import('./editor/EditorScreen').then((m) => ({ default: m.EditorScreen })))

// Suspense alone only covers the loading state — a module-link failure
// inside the lazy import throws during render and, uncaught, unmounts the
// entire app. This boundary contains that failure to the editor screen.
class EditorErrorBoundary extends Component<{ onBack: () => void; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="editor-unavailable">
          <p>关卡编辑器暂时无法使用</p>
          <button onClick={this.props.onBack}>返回</button>
        </div>
      )
    }
    return this.props.children
  }
}

type Screen = 'menu' | 'levelSelect' | 'game' | 'editor'

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [activeLevel, setActiveLevel] = useState<LevelMeta | null>(null)
  // Recomputed each render rather than memoised so a level just saved in the
  // editor shows up as soon as the player navigates back to level select.
  const allLevels = [...BUILTIN_LEVELS, ...loadGeneratedLevels(), ...loadCustomLevels()]

  if (screen === 'menu') {
    return <MenuScreen onStart={() => setScreen('levelSelect')} onEditor={() => setScreen('editor')} />
  }

  if (screen === 'levelSelect') {
    return (
      <LevelSelect
        levels={allLevels}
        completedIds={listCompletedLevels()}
        onSelect={(level) => {
          setActiveLevel(level)
          setScreen('game')
        }}
        onBack={() => setScreen('menu')}
      />
    )
  }

  if (screen === 'game' && activeLevel) {
    return (
      <GameScreen
        initialWorld={activeLevel.world}
        onExit={() => setScreen('levelSelect')}
        onWin={() => {
          markLevelComplete(activeLevel.id)
          if (isLevelComplete(activeLevel.id)) setScreen('levelSelect')
        }}
      />
    )
  }

  if (screen === 'editor') {
    return (
      <EditorErrorBoundary onBack={() => setScreen('menu')}>
        <Suspense fallback={null}>
          <EditorScreen onBack={() => setScreen('menu')} />
        </Suspense>
      </EditorErrorBoundary>
    )
  }

  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Type-check, run the full engine+UI test suite, and commit**

```bash
npx tsc -b --noEmit
npx vitest run src/game src/levels src/ui src/App.test.tsx
```

Expected: clean type-check for every file this plan touches (the editor/generator's pre-existing errors are expected and out of scope — see Global Constraints), and every test file this plan touched passes.

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): wire GameScreen/levels to the new World engine, lazy-load the editor behind an error boundary"
```

- [ ] **Step 6: Manual verification in the browser**

```bash
npm run dev
```

Open the printed local URL and, for each of the 5 builtin levels, play it start to finish and confirm it's marked complete (✓) back on the level select screen:

- **第一次推动** — one push right wins
- **进入箱子** — push right (blocked by the wall, so the player enters the container instead), then two more rights inside to reach the win cell
- **连锁推动** — one push right wins (pushes both boxes as a chain)
- **箱子吞噬** — one push right wins (the wall-blocked normal box gets eaten into the container, landing directly on the container interior's win cell)
- **双层嵌套** — four pushes right: enter the first container (blocked push), enter the second container nested inside it (blocked push again), then two more rights to reach the win cell

Also click **关卡编辑器** from the main menu and confirm it shows "关卡编辑器暂时无法使用" with a working **返回** button instead of a blank screen, then confirm **开始游戏** still works normally afterward.

If any of this doesn't match, that's a real bug — stop and report it rather than adjusting the level files to paper over it.

---

## Plan self-review notes

- **Spec coverage:** Architecture (renderer simplification, camera-cut model) → Task 2. `GameScreen` state management pattern → Task 4. `GameState.moveCount` addition → Task 1. Level loading minimal fix + the two new/five total level files → Task 3. Testing strategy's three bullets (renderer tests, GameScreen tests, manual verification) → Tasks 2, 4, and Task 5 Step 6 respectively. Migration note's file list (rewritten/modified/deleted/created) → covered exactly across Tasks 1-5.
- **Beyond the spec, two real bugs found and fixed while validating the design in a working prototype, both folded into Task 5:** a static `EditorScreen` import crashing the entire module graph (not just the editor route) on load, and — found only by actually clicking into the editor with the lazy-load fix in place — an uncaught `React.lazy` rejection unmounting the whole app without an error boundary. Both are now covered by Task 5's tests, not just asserted in prose.
- **Type/signature consistency:** `renderBoard`'s signature (`ctx, board, world, cellSize`) is introduced once in Task 2 and consumed unchanged in Task 4. `GameScreen`'s `initialWorld` prop name is introduced in Task 4 and consumed unchanged in Task 5. `LevelMeta.world` is introduced in Task 3 and consumed unchanged in Tasks 4 (via `activeLevel.world` in Task 5's `App.tsx`, which is the actual call site) and nowhere else needs it.
- **Level design correctness:** all 5 level JSON files in Task 3 were hand-traced against the shipped engine algorithm and manually verified solvable move-by-move in an actual browser session before being written into this plan (see the plan's originating conversation) — not just asserted to work.
