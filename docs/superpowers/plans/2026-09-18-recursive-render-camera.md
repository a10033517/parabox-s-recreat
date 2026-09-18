# Recursive Render & Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, one-board-at-a-time renderer with true recursive rendering
(a container's interior drawn live, scaled, inside its own cell, to whatever depth stays
legible) and a continuous pan/zoom camera, so every mechanic this codebase has shipped is
visually self-explanatory and board transitions are smooth instead of hard cuts.

**Architecture:** Two new pure-logic files (`recursiveTransform.ts` for board position math,
`camera.ts` for the camera transform) sit under the existing `CanvasRenderer.ts`, which gets
a full rewrite from a single `renderBoard(ctx, board, world, cellSize)` call to a recursive
`drawBoardRecursive` walking the whole containment tree from an anchor board outward.
`GameScreen.tsx` moves from a one-shot per-move redraw to a continuous
`requestAnimationFrame` loop driven by a small explicit animation-state object.

**Tech Stack:** TypeScript, Vitest, Canvas 2D, React (existing stack — no new dependencies).

**Spec:** `docs/superpowers/specs/2026-09-18-recursive-render-camera-design.md` — read it
first; it has the full rationale for every rule below, including a "Revision note" section
documenting what was corrected from an earlier draft. This plan implements it section by
section; section numbers below (`§N`) refer to that spec.

## Global Constraints

- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true` in `tsconfig.json`.
- `src/game/engine/**` is never modified by this plan — every mechanic reused
  (`findContainerFor`, `isInVoid`, `VOID_BOARD_ID`, `PLAYER_ID`) is read-only.
- `minCellPixels: 4`, `maxCellsPerFrame: 4000`, `maxRecursionDepth: 48`,
  `targetPlayerCellPixels: 64` — the spec's exact default `RenderBudget` values (§2.1).
- A clone's own `fliph` is never read for its rendering mirror — only its main body's
  `fliph` is (§4.2) — this mirrors the already-shipped, already-correct gameplay behavior
  (`tryEnter`'s `cloneOf` interception returns before `into.fliph` is ever read).
- A `linkedTo` border is drawn on a container because **its own** `linkedTo` field is set,
  never inferred onto whatever it points at (§6.1) — the mechanic is genuinely
  one-directional per its own shipped spec and tests.
- Container border/marker is always drawn **after** any recursively-drawn nested content,
  never before (§3, "Draw order") — otherwise the nested content's own fills paint over it.
- The render anchor's identity board is resolved via `resolveAnchorBoardId` (§1.3) —
  the sole zero-owner board if one exists, otherwise the player's board at level load —
  never a hardcoded `'root'` string, because a pure-cycle level (see this session's own
  `docs/superpowers/specs/2026-09-18-parabox-general-cycles.md`) has no zero-owner board.

---

### Task 1: `recursiveTransform.ts` — board position math

**Files:**
- Create: `src/game/render/recursiveTransform.ts`
- Test: `src/game/render/recursiveTransform.test.ts`

**Interfaces:**
- Produces: `BoardTransform { boardId, originX, originY, scale }`, `CameraAnchor = 'root' |
  'void'`, `childTransform(parentTransform, location, childBoard): BoardTransform`,
  `resolveAnchorBoardId(world, anchor): BoardId | null`,
  `resolveCanonicalBoardTransform(world, boardId, anchor): BoardTransform | null`.
- Consumes: nothing new — only `findContainerFor`, `PLAYER_ID`, `VOID_BOARD_ID` from
  `../engine/types`, already-shipped.

- [ ] **Step 1: Write the failing tests**

```ts
// src/game/render/recursiveTransform.test.ts
import { describe, it, expect } from 'vitest'
import { childTransform, resolveAnchorBoardId, resolveCanonicalBoardTransform } from './recursiveTransform'
import { makeFloorBoard, makeWorld } from '../engine/testFixtures'
import { PLAYER_ID, VOID_BOARD_ID } from '../engine/types'

describe('childTransform', () => {
  it('places a child board inside one cell of its parent, scaled by 1/childSize', () => {
    const root = makeFloorBoard('root', 4)
    const identity = { boardId: 'root', originX: 0, originY: 0, scale: 1 }
    const interior = makeFloorBoard('interior', 2)
    const t = childTransform(identity, { board: 'root', x: 2, y: 1 }, interior)
    expect(t).toEqual({ boardId: 'interior', originX: 2, originY: 1, scale: 0.5 })
  })

  it('composes across two levels of nesting', () => {
    const rootT = { boardId: 'root', originX: 0, originY: 0, scale: 1 }
    const inside = makeFloorBoard('inside', 4)
    const insideT = childTransform(rootT, { board: 'root', x: 1, y: 1 }, inside)
    // insideT = { originX: 1, originY: 1, scale: 0.25 }
    const deepest = makeFloorBoard('deepest', 2)
    const deepestT = childTransform(insideT, { board: 'inside', x: 2, y: 3 }, deepest)
    // deepest's own (0,0) sits at insideT.origin + (2,3)*insideT.scale
    expect(deepestT).toEqual({
      boardId: 'deepest',
      originX: 1 + 2 * 0.25,
      originY: 1 + 3 * 0.25,
      scale: 0.25 / 2,
    })
  })

  it('throws for an invalid (zero) board size', () => {
    const identity = { boardId: 'root', originX: 0, originY: 0, scale: 1 }
    const bad = { id: 'bad', size: 0, cells: [] }
    expect(() => childTransform(identity, { board: 'root', x: 0, y: 0 }, bad)).toThrow(/invalid board size/i)
  })
})

describe('resolveAnchorBoardId', () => {
  it('returns the sole zero-owner board for a normal tree level', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(resolveAnchorBoardId(world, 'root')).toBe('root')
  })

  it('returns the player\'s own board for a pure-cycle level with no zero-owner board, regardless of its name', () => {
    // Two-node cycle through 'start': redPiece owns redInterior, yellowPiece (inside
    // redInterior) owns 'start' — reproduces the general-cycles spec's own worked
    // example, renamed to prove this isn't a hardcoded 'root' check.
    const start = makeFloorBoard('start', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [start, redInterior],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'start' },
      ],
      {
        [PLAYER_ID]: { board: 'start', x: 0, y: 0 },
        redPiece: { board: 'start', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )
    expect(resolveAnchorBoardId(world, 'root')).toBe('start')
  })

  it('returns VOID_BOARD_ID for the void anchor when the Void board exists', () => {
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 5)
    const world = makeWorld([voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: VOID_BOARD_ID, x: 2, y: 2 } })
    expect(resolveAnchorBoardId(world, 'void')).toBe(VOID_BOARD_ID)
  })

  it('returns null for the void anchor when the Void board has never been synthesized', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(resolveAnchorBoardId(world, 'void')).toBeNull()
  })
})

describe('resolveCanonicalBoardTransform', () => {
  it('matches childTransform for a real two-level World', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'container', boardRef: 'inside' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 1 } },
    )
    expect(resolveCanonicalBoardTransform(world, 'inside', 'root')).toEqual({
      boardId: 'inside', originX: 2, originY: 1, scale: 0.5,
    })
  })

  it('resolves the anchor board itself to the identity transform', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(resolveCanonicalBoardTransform(world, 'root', 'root')).toEqual({ boardId: 'root', originX: 0, originY: 0, scale: 1 })
  })

  it('resolves a real position for a board on a pure cycle, not just the anchor itself', () => {
    const start = makeFloorBoard('start', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [start, redInterior],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'start' },
      ],
      {
        [PLAYER_ID]: { board: 'start', x: 0, y: 0 },
        redPiece: { board: 'start', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )
    // anchor is 'start' (per the resolveAnchorBoardId test above). redInterior is owned
    // by redPiece, which sits on 'start' at (1,0) — one level in.
    expect(resolveCanonicalBoardTransform(world, 'redInterior', 'root')).toEqual({
      boardId: 'redInterior', originX: 1, originY: 0, scale: 0.5,
    })
  })

  it('terminates instead of hanging when walking up from a self-loop board that is not the anchor', () => {
    // loopBoard is a 1x1 self-loop (C owns loopBoard and sits on it), completely
    // disconnected from 'root' — proves the upward walk's visited-set guard fires
    // rather than looping forever, regardless of board.size.
    const root = makeFloorBoard('root', 3)
    const loopBoard = makeFloorBoard('loopBoard', 1)
    const world = makeWorld(
      [root, loopBoard],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'C', kind: 'container', boardRef: 'loopBoard' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        C: { board: 'loopBoard', x: 0, y: 0 }, // self-referencing
      },
    )
    expect(resolveCanonicalBoardTransform(world, 'loopBoard', 'root')).toBeNull()
  })

  it('returns null for a board on a cycle fully disconnected from the requested anchor', () => {
    const root = makeFloorBoard('root', 2)
    const a = makeFloorBoard('a', 2)
    const b = makeFloorBoard('b', 2)
    const world = makeWorld(
      [root, a, b],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'ca', kind: 'container', boardRef: 'a' },
        { id: 'cb', kind: 'container', boardRef: 'b' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        ca: { board: 'b', x: 0, y: 0 }, // ca sits inside b
        cb: { board: 'a', x: 0, y: 0 }, // cb sits inside a — a<->b mutual cycle, no link to root
      },
    )
    expect(resolveCanonicalBoardTransform(world, 'a', 'root')).toBeNull()
  })

  it('returns null when boardId does not exist in the world', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(resolveCanonicalBoardTransform(world, 'nonexistent', 'root')).toBeNull()
  })

  it('a clone pointing at a board does not affect that board\'s own canonical transform', () => {
    // mainBody canonically owns mainInside; a separate clone (cloneOf: mainBody, no
    // boardRef of its own) also exists elsewhere. Resolving mainInside's canonical
    // transform must walk mainBody's real ownership only — the clone must never be
    // consulted, confirming findContainerFor (which resolveCanonicalBoardTransform's
    // walk uses) has no cloneOf-awareness at all to accidentally trip over.
    const root = makeFloorBoard('root', 3)
    const mainInside = makeFloorBoard('mainInside', 2)
    const world = makeWorld(
      [root, mainInside],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'mainBody', kind: 'container', boardRef: 'mainInside' },
        { id: 'clone', kind: 'container', cloneOf: 'mainBody' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        mainBody: { board: 'root', x: 1, y: 1 },
        clone: { board: 'root', x: 2, y: 2 },
      },
    )
    expect(resolveCanonicalBoardTransform(world, 'mainInside', 'root')).toEqual({
      boardId: 'mainInside', originX: 1, originY: 1, scale: 0.5, // mainInside is size 2
    })
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/render/recursiveTransform.test.ts`
Expected: FAIL — `./recursiveTransform` has no exports yet (module doesn't exist).

- [ ] **Step 3: Implement**

```ts
// src/game/render/recursiveTransform.ts
import { Board, BoardId, Location, PLAYER_ID, VOID_BOARD_ID, World, findContainerFor } from '../engine/types'

export interface BoardTransform {
  boardId: BoardId
  // Top-left corner of this board's (0,0) cell, in the active anchor's units.
  originX: number
  originY: number
  // Size of ONE cell of this board, in anchor units. The anchor board's own
  // transform has scale === 1.
  scale: number
}

export function childTransform(
  parentTransform: BoardTransform,
  location: Location,
  childBoard: Board,
): BoardTransform {
  if (childBoard.size <= 0) {
    throw new Error(`Invalid board size: ${childBoard.size}`)
  }
  return {
    boardId: childBoard.id,
    originX: parentTransform.originX + location.x * parentTransform.scale,
    originY: parentTransform.originY + location.y * parentTransform.scale,
    scale: parentTransform.scale / childBoard.size,
  }
}

export type CameraAnchor = 'root' | 'void'

// The anchor board is identified the same way levelSchema.ts's own startBoardId is: the
// sole zero-owner board if one exists (an ordinary tree level), otherwise the player's
// own board (a pure-cycle level has no zero-owner board at all — see the general-cycles
// spec). Never a hardcoded 'root' literal.
export function resolveAnchorBoardId(world: World, anchor: CameraAnchor): BoardId | null {
  if (anchor === 'void') {
    return world.boards[VOID_BOARD_ID] !== undefined ? VOID_BOARD_ID : null
  }
  const ownerCount = new Map<BoardId, number>(Object.keys(world.boards).map((id) => [id, 0]))
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
      ownerCount.set(piece.boardRef, (ownerCount.get(piece.boardRef) ?? 0) + 1)
    }
  }
  const orphan = [...ownerCount.entries()].find(([, count]) => count === 0)
  if (orphan !== undefined) return orphan[0]
  return world.locations[PLAYER_ID]?.board ?? null
}

// Walks from boardId UP to the anchor board via findContainerFor (mirroring
// computeTarget's own upward climb in rules.ts), cycle-safe via a visited set, then
// composes childTransform forward from the anchor's identity transform down through the
// discovered path. Returns null if boardId isn't reachable from this anchor at all, or a
// cycle prevents reaching the anchor board.
export function resolveCanonicalBoardTransform(
  world: World,
  boardId: BoardId,
  anchor: CameraAnchor,
): BoardTransform | null {
  const anchorBoardId = resolveAnchorBoardId(world, anchor)
  if (anchorBoardId === null) return null
  if (world.boards[boardId] === undefined) return null

  const path: { location: Location; board: Board }[] = []
  let current = boardId
  const visited = new Set<BoardId>()
  while (current !== anchorBoardId) {
    if (visited.has(current)) return null
    visited.add(current)
    const ownerId = findContainerFor(world, current)
    if (ownerId === undefined) return null
    const ownerLoc = world.locations[ownerId]
    if (ownerLoc === undefined) return null
    path.push({ location: ownerLoc, board: world.boards[current] })
    current = ownerLoc.board
  }

  let transform: BoardTransform = { boardId: anchorBoardId, originX: 0, originY: 0, scale: 1 }
  for (let i = path.length - 1; i >= 0; i--) {
    transform = childTransform(transform, path[i].location, path[i].board)
  }
  return transform
}
```

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/render/recursiveTransform.test.ts`
Expected: PASS, every test.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/render/recursiveTransform.ts src/game/render/recursiveTransform.test.ts
git commit -m "feat(render): board position math for the recursive renderer"
```

---

### Task 2: `camera.ts` — camera transform

**Files:**
- Create: `src/game/render/camera.ts`
- Test: `src/game/render/camera.test.ts`

**Interfaces:**
- Consumes: `BoardTransform`, `CameraAnchor`, `resolveCanonicalBoardTransform` (Task 1).
- Produces: `Viewport { width, height }`, `CameraTransform { centerX, centerY,
  pixelsPerRootUnit, anchor }`, `CameraBudget { targetPlayerCellPixels }`,
  `clampCameraZoom(zoom): number`, `worldToScreen(x, y, camera, viewport): {x, y}`,
  `cameraFallbackForAnchor(anchor, targetPlayerCellPixels): CameraTransform`,
  `cameraForPlayer(world, budget): CameraTransform`.
  `CameraBudget` is deliberately its own small type (just the one field camera math
  needs), not `CanvasRenderer.ts`'s later, larger `RenderBudget` — keeps this file
  independent of `CanvasRenderer.ts` rather than creating a forward dependency on a file
  this task's own commit doesn't touch. `GameScreen.tsx` (Task 6) passes
  `{ targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels }` when it calls
  this.

- [ ] **Step 1: Write the failing tests**

```ts
// src/game/render/camera.test.ts
import { describe, it, expect } from 'vitest'
import { cameraForPlayer, clampCameraZoom, worldToScreen, cameraFallbackForAnchor } from './camera'
import { makeFloorBoard, makeWorld } from '../engine/testFixtures'
import { PLAYER_ID, VOID_BOARD_ID } from '../engine/types'

describe('clampCameraZoom', () => {
  it('passes through an in-range value unchanged', () => {
    expect(clampCameraZoom(100)).toBe(100)
  })
  it('clamps a non-finite or non-positive value to the minimum', () => {
    expect(clampCameraZoom(NaN)).toBeGreaterThan(0)
    expect(clampCameraZoom(Infinity)).toBeLessThan(Infinity)
    expect(clampCameraZoom(-5)).toBeGreaterThan(0)
    expect(clampCameraZoom(0)).toBeGreaterThan(0)
  })
  it('clamps an extreme value into [min, max]', () => {
    expect(clampCameraZoom(1e12)).toBeLessThan(1e12)
    expect(clampCameraZoom(1e-12)).toBeGreaterThan(1e-12)
  })
})

describe('worldToScreen', () => {
  it('maps the camera center to the exact viewport center', () => {
    const camera = { centerX: 5, centerY: 5, pixelsPerRootUnit: 32, anchor: 'root' as const }
    const viewport = { width: 400, height: 300 }
    expect(worldToScreen(5, 5, camera, viewport)).toEqual({ x: 200, y: 150 })
  })
  it('scales offsets from center by pixelsPerRootUnit', () => {
    const camera = { centerX: 0, centerY: 0, pixelsPerRootUnit: 10, anchor: 'root' as const }
    const viewport = { width: 100, height: 100 }
    expect(worldToScreen(1, 2, camera, viewport)).toEqual({ x: 60, y: 70 })
  })
})

describe('cameraForPlayer', () => {
  it('centers a player standing directly on the anchor board at that cell\'s center', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 1, y: 2 } })
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    expect(camera.anchor).toBe('root')
    expect(camera.centerX).toBeCloseTo(1.5) // x + 0.5, scale 1
    expect(camera.centerY).toBeCloseTo(2.5)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(64) // targetPlayerCellPixels / scale(1)
  })

  it('zooms in further for a player nested two levels deep, per targetPlayerCellPixels / boardScale', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'container', boardRef: 'inside' }],
      { [PLAYER_ID]: { board: 'inside', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 1 } },
    )
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    // inside's transform: originX 2, originY 1, scale 0.5 (root size 4)
    expect(camera.centerX).toBeCloseTo(2 + 0.5 * 0.5) // originX + (0+0.5)*scale
    expect(camera.centerY).toBeCloseTo(1 + 0.5 * 0.5)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(64 / 0.5) // = 128, more zoomed in than the root case
  })

  it('selects the void anchor for a player standing in the Void', () => {
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 5)
    const world = makeWorld([voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: VOID_BOARD_ID, x: 2, y: 2 } })
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    expect(camera.anchor).toBe('void')
  })

  it('falls back to a defined default instead of NaN when the player has no location', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [], {})
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.centerY)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })

  it('falls back to a defined default when the player\'s board has no reachable canonical transform', () => {
    // ca/cb mutual cycle disconnected from root, player placed on 'a' (unreachable) —
    // same shape as recursiveTransform.test.ts's disconnected-cycle fixture.
    const root = makeFloorBoard('root', 2)
    const a = makeFloorBoard('a', 2)
    const b = makeFloorBoard('b', 2)
    const world = makeWorld(
      [root, a, b],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'ca', kind: 'container', boardRef: 'a' },
        { id: 'cb', kind: 'container', boardRef: 'b' },
      ],
      {
        [PLAYER_ID]: { board: 'a', x: 0, y: 0 },
        ca: { board: 'b', x: 0, y: 0 },
        cb: { board: 'a', x: 0, y: 0 },
      },
    )
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })
})

describe('cameraFallbackForAnchor', () => {
  it('returns a finite camera for the given anchor', () => {
    const camera = cameraFallbackForAnchor('void', 64)
    expect(camera.anchor).toBe('void')
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/render/camera.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/game/render/camera.ts
import { PLAYER_ID, World, isInVoid } from '../engine/types'
import { CameraAnchor, resolveCanonicalBoardTransform } from './recursiveTransform'

export interface Viewport {
  width: number
  height: number
}

export interface CameraTransform {
  centerX: number
  centerY: number
  pixelsPerRootUnit: number
  anchor: CameraAnchor
}

export interface CameraBudget {
  targetPlayerCellPixels: number
}

const MIN_ZOOM = 4
const MAX_ZOOM = 4096

export function clampCameraZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function worldToScreen(
  x: number,
  y: number,
  camera: CameraTransform,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (x - camera.centerX) * camera.pixelsPerRootUnit + viewport.width / 2,
    y: (y - camera.centerY) * camera.pixelsPerRootUnit + viewport.height / 2,
  }
}

export function cameraFallbackForAnchor(anchor: CameraAnchor, targetPlayerCellPixels: number): CameraTransform {
  return { anchor, centerX: 0.5, centerY: 0.5, pixelsPerRootUnit: clampCameraZoom(targetPlayerCellPixels) }
}

export function cameraForPlayer(world: World, budget: CameraBudget): CameraTransform {
  const anchor: CameraAnchor = isInVoid(world, PLAYER_ID) ? 'void' : 'root'
  const playerLoc = world.locations[PLAYER_ID]
  if (playerLoc === undefined) return cameraFallbackForAnchor(anchor, budget.targetPlayerCellPixels)

  const boardTransform = resolveCanonicalBoardTransform(world, playerLoc.board, anchor)
  if (boardTransform === null) return cameraFallbackForAnchor(anchor, budget.targetPlayerCellPixels)

  const centerX = boardTransform.originX + (playerLoc.x + 0.5) * boardTransform.scale
  const centerY = boardTransform.originY + (playerLoc.y + 0.5) * boardTransform.scale
  const targetZoom = budget.targetPlayerCellPixels / boardTransform.scale

  return { anchor, centerX, centerY, pixelsPerRootUnit: clampCameraZoom(targetZoom) }
}
```

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/render/camera.test.ts`
Expected: PASS, every test.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/render/camera.ts src/game/render/camera.test.ts
git commit -m "feat(render): camera transform driven by the player's canonical position"
```

---

### Task 3: `CanvasRenderer.ts` — budget, piece index, viewport culling helpers

**Files:**
- Modify: `src/game/render/CanvasRenderer.ts`
- Modify: `src/game/render/CanvasRenderer.test.ts`

**Interfaces:**
- Consumes: `CameraTransform`, `Viewport`, `worldToScreen` (Task 2).
- Produces: `RenderBudget { minCellPixels, maxCellsPerFrame, maxRecursionDepth,
  targetPlayerCellPixels }`, `DEFAULT_RENDER_BUDGET: RenderBudget`,
  `BoardPieceEntry { pieceId, location }`, `PiecesByBoard = Map<BoardId,
  BoardPieceEntry[]>`, `indexPiecesByBoard(world): PiecesByBoard`. These are pure helpers,
  independently testable, with no dependency yet on the recursive draw function itself
  (Task 4 consumes them).

This task keeps the FILE's existing content (the current `renderBoard`, `isCycleMember`,
`cycleColorFor`, color constants) untouched for now — Task 4 replaces `renderBoard`. Add
the new exports alongside the existing ones.

- [ ] **Step 1: Write the failing tests**

Add to `src/game/render/CanvasRenderer.test.ts` (new `describe` blocks, existing tests
untouched):

```ts
import { indexPiecesByBoard, DEFAULT_RENDER_BUDGET } from './CanvasRenderer'

describe('indexPiecesByBoard', () => {
  it('groups pieces by their current board', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box1', kind: 'normal' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, box1: { board: 'inside', x: 1, y: 1 } },
    )
    const index = indexPiecesByBoard(world)
    expect(index.get('root')).toEqual([{ pieceId: PLAYER_ID, location: { board: 'root', x: 0, y: 0 } }])
    expect(index.get('inside')).toEqual([{ pieceId: 'box1', location: { board: 'inside', x: 1, y: 1 } }])
  })

  it('returns an empty map for a world with no pieces', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [], {})
    expect(indexPiecesByBoard(world).size).toBe(0)
  })
})

describe('DEFAULT_RENDER_BUDGET', () => {
  it('matches the spec\'s exact default values', () => {
    expect(DEFAULT_RENDER_BUDGET).toEqual({
      minCellPixels: 4,
      maxCellsPerFrame: 4000,
      maxRecursionDepth: 48,
      targetPlayerCellPixels: 64,
    })
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: FAIL — `indexPiecesByBoard`/`DEFAULT_RENDER_BUDGET` not exported.

- [ ] **Step 3: Implement**

The file's existing top import is `import { Board, BoardId, PieceId, PieceKind, World,
findContainerFor, VOID_BOARD_ID } from '../engine/types'` — it already brings in `BoardId`
and `PieceId`; only `Location` is new. Change that line to add `Location`, and add one new
import line for `camera.ts`:

```ts
import { Board, BoardId, Location, PieceId, PieceKind, World, findContainerFor, VOID_BOARD_ID } from '../engine/types'
import { CameraTransform, Viewport, worldToScreen } from './camera'
```

Add, near the top (after the existing color constants, before `isCycleMember`):

```ts
export interface RenderBudget {
  minCellPixels: number
  maxCellsPerFrame: number
  maxRecursionDepth: number
  targetPlayerCellPixels: number
}

export const DEFAULT_RENDER_BUDGET: RenderBudget = {
  minCellPixels: 4,
  maxCellsPerFrame: 4000,
  maxRecursionDepth: 48,
  targetPlayerCellPixels: 64,
}

export interface BoardPieceEntry {
  pieceId: PieceId
  location: Location
}
export type PiecesByBoard = Map<BoardId, BoardPieceEntry[]>

export function indexPiecesByBoard(world: World): PiecesByBoard {
  const index: PiecesByBoard = new Map()
  for (const [pieceId, location] of Object.entries(world.locations)) {
    const entries = index.get(location.board)
    if (entries) {
      entries.push({ pieceId, location })
    } else {
      index.set(location.board, [{ pieceId, location }])
    }
  }
  return index
}

interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

function intersectsViewport(rect: ScreenRect, viewport: Viewport): boolean {
  return rect.right > 0 && rect.left < viewport.width && rect.bottom > 0 && rect.top < viewport.height
}
```

(`ScreenRect` and `intersectsViewport` are module-private — Task 4 uses them directly, no
other file needs them exported.)

`Board`'s existing import in this file already brings in `World` — confirm the import list
at the top of `CanvasRenderer.ts` includes `World` (it already does, per the existing
`renderBoard(ctx, board, world, cellSize)` signature).

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: PASS, every test (existing `renderBoard` tests untouched and still green).

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/render/CanvasRenderer.ts src/game/render/CanvasRenderer.test.ts
git commit -m "feat(render): render budget, piece index, and viewport-culling helpers"
```

---

### Task 4: `CanvasRenderer.ts` — `drawBoardRecursive` base case, replaces `renderBoard`

**Files:**
- Modify: `src/game/render/CanvasRenderer.ts`
- Modify: `src/game/render/CanvasRenderer.test.ts`

**Interfaces:**
- Consumes: `BoardTransform`, `childTransform` (Task 1); `CameraTransform`, `Viewport`,
  `worldToScreen` (Task 2); `RenderBudget`, `DEFAULT_RENDER_BUDGET`, `PiecesByBoard`,
  `indexPiecesByBoard` (Task 3).
- Produces: `DrawContext { ctx, world, camera, viewport, budget, piecesByBoard,
  cellsDrawnSoFar }`, `drawBoardRecursive(dc, board, transform, recursionDepth,
  tintAmount, mirrorH): void`. **`tintAmount`/`mirrorH`/`recursionDepth` are explicit
  function parameters, not `DrawContext` fields** — they're branch-local values that
  change going deeper into the recursion, unlike `DrawContext`'s other fields (`ctx`,
  `cellsDrawnSoFar`, etc.), which are genuinely shared, single mutable state across the
  whole call tree for one frame. Task 5 (clone/flip/link) is the first caller that passes
  non-default `tintAmount`/`mirrorH`; this task always passes `0`/`false`.
- **Deliberately not implemented (spec §14.1):** budget-exhaustion draw-order priority
  (favoring the player's own containment path over arbitrary iteration order when
  `maxCellsPerFrame` runs out). The spec itself marks this "recommended... approximated...
  not a hard requirement" — pieces draw in whatever order `Object.entries` on
  `piecesByBoard`'s per-board arrays naturally produces. Worth a follow-up once real
  levels expose whether this ever actually starves the player's own visible path in
  practice; not a blocker for this plan's acceptance criteria.
- **This task deletes `renderBoard` entirely** and rewrites every existing test in
  `CanvasRenderer.test.ts` to call `drawBoardRecursive` via a small test helper that
  reproduces `renderBoard`'s old "draw exactly this one board, 1:1, at the canvas origin"
  behavior — see Step 1's `drawBoardForTest` helper. The *assertions* in the existing
  tests (rect counts, color comparisons, ring/marker checks) are unchanged; only the call
  site changes.

- [ ] **Step 1: Write the failing tests**

Replace the top of `src/game/render/CanvasRenderer.test.ts` (imports and the `mockContext`
helper stay; everything from `describe('renderBoard', ...)` onward is rewritten) with:

```ts
import { describe, it, expect } from 'vitest'
import { drawBoardRecursive, indexPiecesByBoard, DEFAULT_RENDER_BUDGET } from './CanvasRenderer'
import { CameraTransform, Viewport } from './camera'
import { makeFloorBoard, makeWorld, setWall, setRequirement } from '../engine/testFixtures'
import { PLAYER_ID, World, Board } from '../engine/types'

function mockContext() {
  return {
    fillRect: () => {},
    fillStyle: '',
    strokeRect: () => {},
    strokeStyle: '',
    lineWidth: 0,
    save: () => {},
    restore: () => {},
    font: '',
    textAlign: '',
    textBaseline: '',
    fillText: () => {},
  } as unknown as CanvasRenderingContext2D
}

// Reproduces the old renderBoard(ctx, board, world, cellSize)'s exact framing: draws
// `board` 1:1 (one board cell = cellSize screen pixels), board's own top-left at the
// canvas origin — verified algebraically (worldToScreen(0,0,...) = 0 and
// worldToScreen(size,size,...) = size*cellSize for these camera/viewport values).
function drawBoardForTest(ctx: CanvasRenderingContext2D, board: Board, world: World, cellSize: number) {
  const camera: CameraTransform = {
    anchor: 'root',
    centerX: board.size / 2,
    centerY: board.size / 2,
    pixelsPerRootUnit: cellSize,
  }
  const viewport: Viewport = { width: board.size * cellSize, height: board.size * cellSize }
  const dc = {
    ctx,
    world,
    camera,
    viewport,
    budget: DEFAULT_RENDER_BUDGET,
    piecesByBoard: indexPiecesByBoard(world),
    cellsDrawnSoFar: { count: 0 },
  }
  drawBoardRecursive(dc, board, { boardId: board.id, originX: 0, originY: 0, scale: 1 }, 0, 0, false)
}

describe('drawBoardRecursive', () => {
  it('draws one rect per cell for a board with no requirements or pieces', () => {
    const board = makeFloorBoard('root', 3)
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    drawBoardForTest(ctx, board, world, 32)
    expect(calls).toBe(9)
  })

  it('draws an extra overlay rect for each cell with a requirement', () => {
    const board = makeFloorBoard('root', 2)
    setRequirement(board, 1, 0, 'box')
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    drawBoardForTest(ctx, board, world, 32)
    expect(calls).toBe(5)
  })

  it('draws one rect per piece located on the rendered board, and skips pieces on other boards', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box1', kind: 'normal' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, box1: { board: 'inside', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    drawBoardForTest(ctx, root, world, 32)
    expect(calls).toBe(5) // 4 cells + player only
  })

  it('renders a self-loop container with a different fillStyle than a normal container', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 1)
    const world = makeWorld(
      [root, inside],
      [{ id: 'c1', kind: 'container', boardRef: 'inside' }, { id: 'c2', kind: 'container', boardRef: 'root' }],
      { c1: { board: 'root', x: 0, y: 0 }, c2: { board: 'root', x: 1, y: 0 } },
    )
    const ctx = mockContext()
    const styles: string[] = []
    ctx.fillRect = () => { styles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, root, world, 32)
    expect(styles[5]).not.toBe(styles[4])
  })

  it('uses a different fillStyle for a wall cell than a floor cell', () => {
    const board = makeFloorBoard('root', 2)
    setWall(board, 1, 0)
    const world = makeWorld([board], [], {})
    const ctx = mockContext()
    const stylesAtFillTime: string[] = []
    ctx.fillRect = () => { stylesAtFillTime.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, board, world, 32)
    expect(stylesAtFillTime[0]).not.toBe(stylesAtFillTime[1])
  })

  it('renders two members of a multi-node cycle in different colors from each other', () => {
    const root = makeFloorBoard('root', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [root, redInterior],
      [{ id: 'redPiece', kind: 'container', boardRef: 'redInterior' }, { id: 'yellowPiece', kind: 'container', boardRef: 'root' }],
      { redPiece: { board: 'root', x: 0, y: 0 }, yellowPiece: { board: 'redInterior', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    const rootStyles: string[] = []
    ctx.fillRect = () => { rootStyles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, root, world, 32)
    const redPieceColor = rootStyles[4]

    const insideStyles: string[] = []
    ctx.fillRect = () => { insideStyles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, redInterior, world, 32)
    const yellowPieceColor = insideStyles[1]

    expect(redPieceColor).not.toBe(yellowPieceColor)
    expect(redPieceColor).not.toBe('#38bdf8')
    expect(yellowPieceColor).not.toBe('#38bdf8')
  })

  it('does not color an ordinary container that merely owns an unrelated board, even when a real cycle exists on the same board', () => {
    const root = makeFloorBoard('root', 3)
    const obstacleInside = makeFloorBoard('obstacleInside', 1)
    const world = makeWorld(
      [root, obstacleInside],
      [{ id: 'loopBox', kind: 'container', boardRef: 'root' }, { id: 'obstacleContainer', kind: 'container', boardRef: 'obstacleInside' }],
      { loopBox: { board: 'root', x: 0, y: 0 }, obstacleContainer: { board: 'root', x: 1, y: 0 } },
    )
    const ctx = mockContext()
    const styles: string[] = []
    ctx.fillRect = () => { styles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, root, world, 32)
    expect(styles[10]).toBe('#38bdf8')
    expect(styles[9]).not.toBe('#38bdf8')
  })

  it('draws a gold ring around a locked piece', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld([voidBoard], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'void', x: 2, y: 2 } })
    const ctx = mockContext()
    let strokeCalls = 0
    let sawPaleSlateStroke = false
    ctx.strokeRect = () => {
      strokeCalls++
      if (ctx.strokeStyle === '#e2e8f0') sawPaleSlateStroke = true
    }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(strokeCalls).toBe(1)
    expect(sawPaleSlateStroke).toBe(true)
  })

  it('does not draw a ring around a non-locked piece of the same kind', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'root', x: 0, y: 0 } })
    const ctx = mockContext()
    let strokeCalls = 0
    ctx.strokeRect = () => { strokeCalls++ }
    drawBoardForTest(ctx, root, world, 32)
    expect(strokeCalls).toBe(0)
  })

  it('a voided former cycle member gets the plain container color plus the ring, not the cycle color', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld([voidBoard], [{ id: 'loopBox', kind: 'container', boardRef: 'root' }], { loopBox: { board: 'void', x: 2, y: 2 } })
    const ctx = mockContext()
    let fillStyleAtPieceDraw = ''
    let strokeCalls = 0
    ctx.fillRect = () => { fillStyleAtPieceDraw = ctx.fillStyle as string }
    ctx.strokeRect = () => { strokeCalls++ }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(fillStyleAtPieceDraw).toBe('#38bdf8')
    expect(strokeCalls).toBe(1)
  })

  it('restores context state after drawing a locked ring, so it does not bleed into the next piece drawn', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld(
      [voidBoard],
      [{ id: 'locked1', kind: 'normal' }, { id: 'locked2', kind: 'container', boardRef: 'someInterior' }],
      { locked1: { board: 'void', x: 2, y: 2 }, locked2: { board: 'void', x: 3, y: 2 } },
    )
    const ctx = mockContext()
    let saveCalls = 0
    let restoreCalls = 0
    const pieceFillStyles: string[] = []
    ctx.save = () => { saveCalls++ }
    ctx.restore = () => { restoreCalls++ }
    ctx.strokeRect = () => {}
    ctx.fillRect = () => { pieceFillStyles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(saveCalls).toBe(2)
    expect(restoreCalls).toBe(2)
    expect(pieceFillStyles.at(-2)).toBe('#f59e0b')
    expect(pieceFillStyles.at(-1)).toBe('#38bdf8')
  })

  it('an infinite destination renders with the color of the real piece it represents, plus the infinity marker', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [voidBoard, root],
      [{ id: 'realOwner', kind: 'container', boardRef: 'root' }, { id: 'void-infinite:realOwner', kind: 'normal', infiniteFor: 'realOwner' }],
      { realOwner: { board: 'root', x: 0, y: 0 }, 'void-infinite:realOwner': { board: 'void', x: 2, y: 2 } },
    )
    const ctx = mockContext()
    let destinationFillStyle = ''
    let markerDrawn = false
    ctx.fillRect = () => { destinationFillStyle = ctx.fillStyle as string }
    ctx.fillText = (text) => { if (text === '∞') markerDrawn = true }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(destinationFillStyle).not.toBe('#38bdf8')
    expect(markerDrawn).toBe(true)
  })

  it('an ordinary locked Void piece (no infiniteFor) does not render the infinity marker', () => {
    const voidBoard = makeFloorBoard('void', 5)
    const world = makeWorld([voidBoard], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'void', x: 2, y: 2 } })
    const ctx = mockContext()
    let markerDrawn = false
    ctx.fillText = (text) => { if (text === '∞') markerDrawn = true }
    drawBoardForTest(ctx, voidBoard, world, 32)
    expect(markerDrawn).toBe(false)
  })

  it('a container above the pixel cutoff draws its nested board\'s own cells', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside' }],
      { box: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    // cellSize 32 on a 2x2 root -> box's own cell is 32px, well above the 4px cutoff,
    // and its nested 3x3 board's cells render at 32/2=16px, still above cutoff.
    drawBoardForTest(ctx, root, world, 32)
    // 4 root cells + 1 box fill + 9 nested inside cells = 14
    expect(calls).toBe(14)
  })

  it('a container below the pixel cutoff keeps its flat fill without recursing', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 3)
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside' }],
      { box: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    // cellSize 2 -> box's own cell is 2px, below the 4px cutoff -> no nested draw.
    drawBoardForTest(ctx, root, world, 2)
    expect(calls).toBe(5) // 4 root cells + 1 box fill, nothing nested
  })

  it('a viewport-culled board is skipped entirely', () => {
    const root = makeFloorBoard('root', 2)
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    const world = makeWorld([root], [], {})
    const dc = {
      ctx,
      world,
      camera: { anchor: 'root' as const, centerX: 1000, centerY: 1000, pixelsPerRootUnit: 32 }, // far off-screen
      viewport: { width: 100, height: 100 },
      budget: DEFAULT_RENDER_BUDGET,
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
    }
    drawBoardRecursive(dc, root, { boardId: 'root', originX: 0, originY: 0, scale: 1 }, 0, 0, false)
    expect(calls).toBe(0)
  })

  it('stops drawing once maxCellsPerFrame is reached, mid-board', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld([root], [], {})
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    const dc = {
      ctx,
      world,
      camera: { anchor: 'root' as const, centerX: 2, centerY: 2, pixelsPerRootUnit: 32 },
      viewport: { width: 128, height: 128 },
      budget: { ...DEFAULT_RENDER_BUDGET, maxCellsPerFrame: 5 },
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
    }
    drawBoardRecursive(dc, root, { boardId: 'root', originX: 0, originY: 0, scale: 1 }, 0, 0, false)
    expect(calls).toBe(5)
  })

  it('stops recursing once maxRecursionDepth is reached, even for a 1x1 self-loop that never shrinks', () => {
    const loopBoard = makeFloorBoard('loop', 1)
    const world = makeWorld(
      [loopBoard],
      [{ id: 'C', kind: 'container', boardRef: 'loop' }],
      { C: { board: 'loop', x: 0, y: 0 } }, // self-referencing, size 1 -> scale never shrinks
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    const dc = {
      ctx,
      world,
      camera: { anchor: 'root' as const, centerX: 0.5, centerY: 0.5, pixelsPerRootUnit: 1000 }, // stays >4px at every depth
      viewport: { width: 2000, height: 2000 },
      budget: { ...DEFAULT_RENDER_BUDGET, maxRecursionDepth: 5, maxCellsPerFrame: 100000 },
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
    }
    drawBoardRecursive(dc, loopBoard, { boardId: 'loop', originX: 0, originY: 0, scale: 1 }, 0, 0, false)
    // exactly one cell-draw per depth level (1 cell board), depths 0..4 = 5 draws, then
    // depth 5 hits maxRecursionDepth and stops — proves termination independent of pixel
    // size, which never drops below cutoff in this fixture.
    expect(calls).toBe(5)
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: FAIL — `drawBoardRecursive` not exported, `renderBoard` tests removed.

- [ ] **Step 3: Implement**

Delete `renderBoard` entirely from `src/game/render/CanvasRenderer.ts` and replace it with:

```ts
export interface DrawContext {
  ctx: CanvasRenderingContext2D
  world: World
  camera: CameraTransform
  viewport: Viewport
  budget: RenderBudget
  piecesByBoard: PiecesByBoard
  cellsDrawnSoFar: { count: number }
}

export function drawBoardRecursive(
  dc: DrawContext,
  board: Board,
  transform: BoardTransform,
  recursionDepth: number,
  tintAmount: number,
  mirrorH: boolean,
): void {
  if (dc.cellsDrawnSoFar.count >= dc.budget.maxCellsPerFrame) return
  if (recursionDepth >= dc.budget.maxRecursionDepth) return
  if (!Number.isFinite(transform.scale) || transform.scale <= 0) return

  const screenCellSize = transform.scale * dc.camera.pixelsPerRootUnit
  const boardTopLeft = worldToScreen(transform.originX, transform.originY, dc.camera, dc.viewport)
  const boardBottomRight = worldToScreen(
    transform.originX + board.size * transform.scale,
    transform.originY + board.size * transform.scale,
    dc.camera,
    dc.viewport,
  )
  const boardRect: ScreenRect = { left: boardTopLeft.x, top: boardTopLeft.y, right: boardBottomRight.x, bottom: boardBottomRight.y }
  if (!intersectsViewport(boardRect, dc.viewport)) return

  const mirrorX = (x: number) => (mirrorH ? board.size - 1 - x : x)

  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      const screen = worldToScreen(
        transform.originX + mirrorX(x) * transform.scale,
        transform.originY + y * transform.scale,
        dc.camera,
        dc.viewport,
      )
      const cellRect: ScreenRect = { left: screen.x, top: screen.y, right: screen.x + screenCellSize, bottom: screen.y + screenCellSize }
      if (!intersectsViewport(cellRect, dc.viewport)) continue
      if (dc.cellsDrawnSoFar.count >= dc.budget.maxCellsPerFrame) return
      dc.cellsDrawnSoFar.count++

      const cell = board.cells[y][x]
      dc.ctx.fillStyle = applyTint(cell.type === 'wall' ? WALL_COLOR : FLOOR_COLOR, tintAmount)
      dc.ctx.fillRect(cellRect.left, cellRect.top, screenCellSize, screenCellSize)
      if (cell.requirement) {
        dc.ctx.fillStyle = applyTint(REQUIREMENT_OVERLAY[cell.requirement], tintAmount)
        const inset = screenCellSize / 4
        dc.ctx.fillRect(cellRect.left + inset, cellRect.top + inset, screenCellSize - inset * 2, screenCellSize - inset * 2)
      }
    }
  }

  const entries = dc.piecesByBoard.get(board.id) ?? []
  for (const { pieceId, location } of entries) {
    const piece = dc.world.pieces[pieceId]
    const screen = worldToScreen(
      transform.originX + mirrorX(location.x) * transform.scale,
      transform.originY + location.y * transform.scale,
      dc.camera,
      dc.viewport,
    )
    const pieceRect: ScreenRect = { left: screen.x, top: screen.y, right: screen.x + screenCellSize, bottom: screen.y + screenCellSize }
    if (!intersectsViewport(pieceRect, dc.viewport)) continue

    const colorSourceId = piece.infiniteFor ?? pieceId
    const colorSource = piece.infiniteFor !== undefined ? dc.world.pieces[piece.infiniteFor] : piece
    const baseColor = isCycleMember(colorSourceId, dc.world) ? cycleColorFor(colorSourceId) : PIECE_COLORS[colorSource.kind]
    dc.ctx.fillStyle = applyTint(baseColor, tintAmount)
    dc.ctx.fillRect(pieceRect.left, pieceRect.top, screenCellSize, screenCellSize)

    if (board.id === VOID_BOARD_ID) {
      dc.ctx.save()
      dc.ctx.strokeStyle = LOCKED_RING_COLOR
      dc.ctx.lineWidth = Math.max(2, screenCellSize / 8)
      const ringInset = dc.ctx.lineWidth / 2
      dc.ctx.strokeRect(pieceRect.left + ringInset, pieceRect.top + ringInset, screenCellSize - ringInset * 2, screenCellSize - ringInset * 2)
      if (piece.infiniteFor !== undefined) {
        dc.ctx.fillStyle = INFINITY_MARKER_COLOR
        dc.ctx.font = `${Math.floor(screenCellSize / 2)}px sans-serif`
        dc.ctx.textAlign = 'center'
        dc.ctx.textBaseline = 'middle'
        dc.ctx.fillText('∞', pieceRect.left + screenCellSize / 2, pieceRect.top + screenCellSize / 2)
      }
      dc.ctx.restore()
    }

    if (piece.kind === 'container' && piece.boardRef !== undefined && screenCellSize >= dc.budget.minCellPixels) {
      const childBoard = dc.world.boards[piece.boardRef]
      if (childBoard !== undefined) {
        const childT = childTransform(transform, location, childBoard)
        drawBoardRecursive(dc, childBoard, childT, recursionDepth + 1, tintAmount, mirrorH)
      }
    }
  }
}

// Alpha-blend toward white. amount 0 = unchanged; used for Clone's paler tint.
function applyTint(hexColor: string, amount: number): string {
  if (amount <= 0) return hexColor
  const r = parseInt(hexColor.slice(1, 3), 16)
  const g = parseInt(hexColor.slice(3, 5), 16)
  const b = parseInt(hexColor.slice(5, 7), 16)
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}
```

Add the new imports this needs at the top of the file (alongside the existing ones):

```ts
import { BoardTransform, childTransform } from './recursiveTransform'
```

(`applyTint` with `tintAmount` always `0` at this task's only call sites is a no-op —
`applyTint(color, 0)` returns `color` unchanged via its own early return — so every
existing color assertion still holds exactly. Task 5 is what actually passes a nonzero
`tintAmount`.)

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: PASS, every test.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/render/CanvasRenderer.ts src/game/render/CanvasRenderer.test.ts
git commit -m "feat(render): recursive board drawing replaces the flat one-board renderBoard"
```

---

### Task 5: `CanvasRenderer.ts` — Clone, Flip, Transfer visuals

**Files:**
- Modify: `src/game/render/CanvasRenderer.ts`
- Modify: `src/game/render/CanvasRenderer.test.ts`

**Interfaces:**
- Consumes: `drawBoardRecursive`'s `tintAmount`/`mirrorH` parameters (Task 4).
- Produces: `RecursionTarget { boardId, tintAmount, mirrorH }`,
  `resolveRecursionTarget(world, piece): RecursionTarget | null`, `combineTint(parent,
  local): number`. Changes `drawBoardRecursive`'s recursion step to call
  `resolveRecursionTarget` instead of reading `piece.boardRef` directly, and adds the
  `linkedTo` border pass after the recursive call.

- [ ] **Step 1: Write the failing tests**

Add to `src/game/render/CanvasRenderer.test.ts`:

```ts
import { resolveRecursionTarget, combineTint, LINKED_BORDER_COLOR } from './CanvasRenderer'

describe('resolveRecursionTarget', () => {
  it('a plain container recurses into its own boardRef, untinted, mirrored per its own fliph', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld([root, inside], [{ id: 'box', kind: 'container', boardRef: 'inside', fliph: true }], { box: { board: 'root', x: 0, y: 0 } })
    expect(resolveRecursionTarget(world, world.pieces.box)).toEqual({ boardId: 'inside', tintAmount: 0, mirrorH: true })
  })

  it('a clone recurses into its main body\'s CURRENT board, tinted, mirrored per the MAIN BODY\'s fliph (not its own)', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [
        { id: 'mainBody', kind: 'normal', fliph: true },
        { id: 'clone', kind: 'container', cloneOf: 'mainBody', fliph: false }, // clone's own fliph is inert
      ],
      { mainBody: { board: 'root', x: 0, y: 0 }, clone: { board: 'root', x: 2, y: 0 } },
    )
    expect(resolveRecursionTarget(world, world.pieces.clone)).toEqual({ boardId: 'root', tintAmount: 0.35, mirrorH: true })
  })

  it('returns null for a clone whose main body no longer exists', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [{ id: 'clone', kind: 'container', cloneOf: 'gone' }], { clone: { board: 'root', x: 0, y: 0 } })
    expect(resolveRecursionTarget(world, world.pieces.clone)).toBeNull()
  })

  it('returns null for a non-container, non-clone piece', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld([root], [{ id: 'box1', kind: 'normal' }], { box1: { board: 'root', x: 0, y: 0 } })
    expect(resolveRecursionTarget(world, world.pieces.box1)).toBeNull()
  })
})

describe('combineTint', () => {
  it('composes so a second application never fully resets toward zero', () => {
    const once = combineTint(0, 0.35)
    const twice = combineTint(once, 0.35)
    expect(twice).toBeGreaterThan(once)
  })
  it('parent tint alone (local 0) is unchanged', () => {
    expect(combineTint(0.5, 0)).toBeCloseTo(0.5)
  })
})

describe('drawBoardRecursive — Clone', () => {
  it('displays the main body\'s actual current board content, not a nonexistent boardRef', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld(
      [root],
      [{ id: 'mainBody', kind: 'normal' }, { id: 'clone', kind: 'container', cloneOf: 'mainBody' }],
      { mainBody: { board: 'root', x: 0, y: 0 }, clone: { board: 'root', x: 2, y: 0 } },
    )
    const ctx = mockContext()
    let calls = 0
    ctx.fillRect = () => { calls++ }
    drawBoardForTest(ctx, root, world, 64) // 64px/3 cells ~21px, above cutoff -> clone recurses into root itself
    // 9 root cells + mainBody fill + clone fill + (clone's recursive peek: another 9
    // root cells + mainBody fill again, but NOT clone's own fill again since piece
    // identity inside the peek is still just mainBody/clone at their real root positions)
    expect(calls).toBeGreaterThan(11) // proves recursion happened, not just the flat clone fill
  })

  it('a clone\'s recursively-drawn content is provably paler than the same content drawn unc loned', () => {
    const root = makeFloorBoard('root', 3)
    const worldWithClone = makeWorld(
      [root],
      [{ id: 'mainBody', kind: 'normal' }, { id: 'clone', kind: 'container', cloneOf: 'mainBody' }],
      { mainBody: { board: 'root', x: 0, y: 0 }, clone: { board: 'root', x: 2, y: 0 } },
    )
    const ctx1 = mockContext()
    const stylesViaClone: string[] = []
    ctx1.fillRect = () => { stylesViaClone.push(ctx1.fillStyle as string) }
    drawBoardForTest(ctx1, root, worldWithClone, 64)
    // The nested peek's floor-cell fills come after the top-level 9 cells + 2 piece
    // fills (mainBody, clone) — compare one of those nested floor fills against a plain
    // undyed floor fill.
    const nestedFloorFill = stylesViaClone[11] // first cell of the recursed peek
    expect(nestedFloorFill).not.toBe('#1e293b') // FLOOR_COLOR, unmixed
  })

  it('nested clone tint composes rather than resetting: a plain container reached through a clone stays tinted', () => {
    // mainBody lives on its OWN separate board ('elsewhere'), away from the clone —
    // deliberately, so the clone's peek can't loop back into itself (a clone sitting on
    // the SAME board its own main body occupies would recurse into that board again,
    // re-encounter the clone piece, and keep going until the pixel cutoff — correct
    // behavior, but not what this test is isolating). Recursion path: clone (root) ->
    // peeks at mainBody's location board 'elsewhere' (tint 0.35) -> encounters mainBody
    // itself there, an ORDINARY container (tint contribution 0) -> recurses into
    // mainBody's own boardRef 'mainInside' (combined tint stays 0.35, since 0 composed
    // with 0.35 is 0.35) -> mainInside has no pieces, a clean leaf. Deterministic: 9
    // root cells + 1 clone fill + 4 elsewhere cells + 1 mainBody fill + 4 mainInside
    // cells = 19 total fillRect calls, so the last 4 are unambiguously mainInside's.
    const root = makeFloorBoard('root', 3)
    const elsewhere = makeFloorBoard('elsewhere', 2)
    const mainInside = makeFloorBoard('mainInside', 2)
    const world = makeWorld(
      [root, elsewhere, mainInside],
      [
        { id: 'mainBody', kind: 'container', boardRef: 'mainInside' },
        { id: 'clone', kind: 'container', cloneOf: 'mainBody' },
      ],
      { mainBody: { board: 'elsewhere', x: 0, y: 0 }, clone: { board: 'root', x: 2, y: 0 } },
    )
    const ctx = mockContext()
    const styles: string[] = []
    ctx.fillRect = () => { styles.push(ctx.fillStyle as string) }
    drawBoardForTest(ctx, root, world, 64)
    expect(styles).toHaveLength(19)
    const innermostMainInsideFill = styles.at(-1) as string
    expect(innermostMainInsideFill).not.toBe('#1e293b') // FLOOR_COLOR, unmixed — must be tinted
  })
})

describe('drawBoardRecursive — Flip', () => {
  it('mirrors both cells and pieces horizontally inside a fliph container', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    setRequirement(inside, 0, 0, 'box') // leftmost column has the marker
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside', fliph: true }],
      { box: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    const fillCalls: { x: number; style: string }[] = []
    ctx.fillRect = (x) => { fillCalls.push({ x: x as number, style: ctx.fillStyle as string }) }
    drawBoardForTest(ctx, root, world, 64)
    // Without mirroring, the requirement overlay (0,0) would draw at the LEFT half of
    // box's own screen cell; mirrored, it must draw at the RIGHT half instead.
    const overlayCall = fillCalls.find((c) => c.style === '#4c1d95')! // REQUIREMENT_OVERLAY.box
    const boxCellLeft = 0 // box sits at root (0,0), screen left edge = 0
    const boxCellCenter = boxCellLeft + (64 / 2) / 2 // half of box's own 32px screen cell
    expect(overlayCall.x).toBeGreaterThan(boxCellCenter)
  })

  it('control: a non-fliph container is not mirrored', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    setRequirement(inside, 0, 0, 'box')
    const world = makeWorld([root, inside], [{ id: 'box', kind: 'container', boardRef: 'inside' }], { box: { board: 'root', x: 0, y: 0 } })
    const ctx = mockContext()
    const fillCalls: { x: number; style: string }[] = []
    ctx.fillRect = (x) => { fillCalls.push({ x: x as number, style: ctx.fillStyle as string }) }
    drawBoardForTest(ctx, root, world, 64)
    const overlayCall = fillCalls.find((c) => c.style === '#4c1d95')!
    const boxCellCenter = 0 + (64 / 2) / 2
    expect(overlayCall.x).toBeLessThan(boxCellCenter)
  })
})

describe('drawBoardRecursive — Transfer', () => {
  it('draws a border on a container with its own linkedTo set', () => {
    const root = makeFloorBoard('root', 2)
    const c1Interior = makeFloorBoard('c1Interior', 2)
    const c2Interior = makeFloorBoard('c2Interior', 2)
    const world = makeWorld(
      [root, c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior', linkedTo: 'C2' },
        { id: 'C2', kind: 'container', boardRef: 'c2Interior' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 1, y: 0 } },
    )
    const ctx = mockContext()
    let linkedBorderDrawn = false
    ctx.strokeRect = () => { if (ctx.strokeStyle === LINKED_BORDER_COLOR) linkedBorderDrawn = true }
    drawBoardForTest(ctx, root, world, 64)
    expect(linkedBorderDrawn).toBe(true)
  })

  it('does NOT draw the border on a target that has no linkedTo of its own', () => {
    const root = makeFloorBoard('root', 2)
    const c1Interior = makeFloorBoard('c1Interior', 2)
    const c2Interior = makeFloorBoard('c2Interior', 2)
    const world = makeWorld(
      [root, c1Interior, c2Interior],
      [
        { id: 'C1', kind: 'container', boardRef: 'c1Interior' }, // C1 is the "target" here, unlinked itself
        { id: 'C2', kind: 'container', boardRef: 'c2Interior', linkedTo: 'C1' },
      ],
      { C1: { board: 'root', x: 0, y: 0 }, C2: { board: 'root', x: 1, y: 0 } },
    )
    const ctx = mockContext()
    let totalStrokeCalls = 0
    const strokeStylesAtC1: string[] = []
    // Board size 2 at cellSize 64 means each root cell is 64px wide; C1 sits at root
    // x=0 (screen x in [0,64)), C2 at root x=1 (screen x in [64,128)).
    ctx.strokeRect = (x) => {
      totalStrokeCalls++
      if ((x as number) < 64) strokeStylesAtC1.push(ctx.strokeStyle as string)
    }
    drawBoardForTest(ctx, root, world, 64)
    expect(totalStrokeCalls).toBe(1) // exactly one border drawn in the whole scene: C2's own
    expect(strokeStylesAtC1).toHaveLength(0) // none of it is in C1's cell region
  })

  it('container border is drawn AFTER its nested content, so it is not painted over', () => {
    const root = makeFloorBoard('root', 2)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: 'C1', kind: 'container', boardRef: 'inside', linkedTo: 'C1' }], // self-linked is fine for this draw-order check
      { C1: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    const callOrder: string[] = []
    ctx.fillRect = () => { callOrder.push('fill') }
    ctx.strokeRect = () => { callOrder.push('stroke') }
    drawBoardForTest(ctx, root, world, 64)
    const lastFillIndex = callOrder.lastIndexOf('fill')
    const linkedStrokeIndex = callOrder.indexOf('stroke')
    expect(linkedStrokeIndex).toBeGreaterThan(lastFillIndex)
  })
})
```

(`LINKED_BORDER_COLOR` needs importing/exporting from `CanvasRenderer.ts` for the test file
— add `export` to its declaration in Step 3.)

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: FAIL — `resolveRecursionTarget`/`combineTint`/`LINKED_BORDER_COLOR` not exported;
recursion still uses the old plain `boardRef` check with no clone/tint/mirror/link support.

- [ ] **Step 3: Implement**

In `src/game/render/CanvasRenderer.ts`, add near `applyTint`:

```ts
export const LINKED_BORDER_COLOR = '#22d3ee' // cyan — distinct from every PIECE_COLORS/CYCLE_PALETTE/LOCKED_RING_COLOR entry

export interface RecursionTarget {
  boardId: BoardId
  tintAmount: number
  mirrorH: boolean
}

export function resolveRecursionTarget(world: World, piece: Piece): RecursionTarget | null {
  if (piece.cloneOf !== undefined) {
    const mainBodyLoc = world.locations[piece.cloneOf]
    const mainBody = world.pieces[piece.cloneOf]
    if (mainBodyLoc === undefined || mainBody === undefined) return null
    // The clone's OWN fliph is inert for gameplay (tryEnter's cloneOf interception
    // returns before into.fliph is ever read) — using it here would render a mirrored
    // peek that lies about a real entry. The main body's own fliph is what actually
    // mirrors its interior.
    return { boardId: mainBodyLoc.board, tintAmount: 0.35, mirrorH: mainBody.fliph ?? false }
  }
  if (piece.boardRef === undefined) return null
  return { boardId: piece.boardRef, tintAmount: 0, mirrorH: piece.fliph ?? false }
}

export function combineTint(parent: number, local: number): number {
  return 1 - (1 - parent) * (1 - local)
}
```

Replace the recursion step at the bottom of `drawBoardRecursive`'s piece loop (the
`if (piece.kind === 'container' && ...)` block from Task 4) with:

```ts
    const target = resolveRecursionTarget(dc.world, piece)
    if (target !== null && screenCellSize >= dc.budget.minCellPixels) {
      const childBoard = dc.world.boards[target.boardId]
      if (childBoard !== undefined) {
        const childT = childTransform(transform, location, childBoard)
        drawBoardRecursive(
          dc, childBoard, childT, recursionDepth + 1,
          combineTint(tintAmount, target.tintAmount),
          mirrorH !== target.mirrorH,
        )
      }
    }

    if (piece.kind === 'container' && piece.linkedTo !== undefined) {
      dc.ctx.save()
      dc.ctx.strokeStyle = LINKED_BORDER_COLOR
      dc.ctx.lineWidth = Math.max(2, screenCellSize / 10)
      const inset = dc.ctx.lineWidth / 2
      dc.ctx.strokeRect(pieceRect.left + inset, pieceRect.top + inset, screenCellSize - inset * 2, screenCellSize - inset * 2)
      dc.ctx.restore()
    }
```

(This sits after the existing Void-lock ring block from Task 4, both still before the end
of the `for (const { pieceId, location } of entries)` loop body — the linked border, like
the lock ring, is drawn after the recursive call, satisfying the "marker last" rule.)

`resolveRecursionTarget`'s signature names `Piece` directly, which is not yet in the
file's import list (it wasn't needed before this task). Add it to the existing
`../engine/types` import line from Task 3, so it reads: `import { Board, BoardId,
Location, Piece, PieceId, PieceKind, World, findContainerFor, VOID_BOARD_ID } from
'../engine/types'`.

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: PASS, every test — including every test from Tasks 3 and 4, unmodified.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/render/CanvasRenderer.ts src/game/render/CanvasRenderer.test.ts
git commit -m "feat(render): Clone, Flip, and Transfer visuals on the recursive renderer"
```

---

### Task 6: `GameScreen.tsx` — fixed viewport, RAF loop, camera-driven (no animation yet)

**Files:**
- Modify: `src/game/GameScreen.tsx`
- Modify: `src/game/GameScreen.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `drawBoardRecursive`, `DrawContext`, `DEFAULT_RENDER_BUDGET`,
  `indexPiecesByBoard` (Tasks 3-5); `cameraForPlayer`, `Viewport` (Task 2);
  `resolveAnchorBoardId` (Task 1).
- This task replaces `GameScreen`'s per-move `useEffect` redraw with a continuous
  `requestAnimationFrame` loop that reads `state.current` fresh every frame and always
  snaps the camera to `cameraForPlayer`'s current target — no tweening/easing yet (Task 7
  adds that). The canvas is a fixed-size viewport now, not resized to `currentBoard.size`.

- [ ] **Step 1: Write the failing tests**

The current `GameScreen.test.tsx` already establishes real conventions this rewrite must
keep: a `beforeEach` mock of `HTMLCanvasElement.prototype.getContext`, `userEvent` +
`screen.getByLabelText('右'|'左')` (the DPad's own accessible labels — see
`src/ui/DPad.tsx`) to drive moves rather than raw `keydown` dispatch, and five real
scenarios (DPad increments the counter, undo decrements it, entering a container used to
resize the canvas, win fires `onWin` once, undo-then-rewin fires it again, pushing into a
self-loop sends the player to the Void without a "lose" notice and play continues). The
new RAF loop calls `ctx.setTransform` and `ctx.clearRect` every frame — **the existing
mock has neither**, so the very first render would throw under the rewritten component
unless the mock is extended. Replace the whole file:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GameScreen } from './GameScreen'
import { makeFloorBoard, makeWorld, setRequirement, setWall } from './engine/testFixtures'
import { PLAYER_ID } from './engine/types'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
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

test('the canvas viewport is unaffected by which board is currently active', async () => {
  // The canvas is now a fixed viewport (this task) — entering a much larger board must
  // NOT resize the canvas element the way the old per-board renderer did (the old test
  // this replaces asserted canvas.width === 5*32 after entering a size-5 board; that
  // behavior is deliberately removed).
  const root = makeFloorBoard('root', 3)
  setWall(root, 2, 1) // block the container from being pushed, forcing entry instead
  const inside = makeFloorBoard('inside', 5)
  const world = makeWorld(
    [root, inside],
    [{ id: PLAYER_ID, kind: 'player' }, { id: 'containerBox', kind: 'container', boardRef: 'inside' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, containerBox: { board: 'root', x: 1, y: 1 } },
  )
  const { container } = render(<GameScreen initialWorld={world} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  const canvasWidthBefore = container.querySelector('canvas')!.width
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 1')).toBeInTheDocument() // the entry move counted normally
  expect(container.querySelector('canvas')!.width).toBe(canvasWidthBefore)
})

test('reaching the win condition calls onWin exactly once', async () => {
  const root = makeFloorBoard('root', 2)
  setRequirement(root, 1, 0, 'player')
  const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
  const onWin = vi.fn()
  render(<GameScreen initialWorld={world} onExit={() => {}} onWin={onWin} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  expect(onWin).toHaveBeenCalledTimes(1)
})

test('undoing out of a won state allows onWin to fire again on re-winning', async () => {
  const root = makeFloorBoard('root', 2)
  setRequirement(root, 1, 0, 'player')
  const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
  const onWin = vi.fn()
  render(<GameScreen initialWorld={world} onExit={() => {}} onWin={onWin} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  expect(onWin).toHaveBeenCalledTimes(1)
  await user.click(screen.getByText('复位上一步'))
  await user.click(screen.getByLabelText('右'))
  expect(onWin).toHaveBeenCalledTimes(2)
})

test('pushing the player into a self-loop sends them to the Void, and play continues', async () => {
  const root = makeFloorBoard('root', 2)
  const world = makeWorld(
    [root],
    [{ id: PLAYER_ID, kind: 'player' }, { id: 'loopBox', kind: 'container', boardRef: 'root' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, loopBox: { board: 'root', x: 0, y: 0 } },
  )
  const onExit = vi.fn()
  render(<GameScreen initialWorld={world} onExit={onExit} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('左'))
  expect(screen.queryByTestId('lose-notice')).not.toBeInTheDocument()
  expect(screen.getByText('步数: 1')).toBeInTheDocument()
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 2')).toBeInTheDocument()
  await user.click(screen.getByText('离开'))
  expect(onExit).toHaveBeenCalledTimes(1)
})

test('runs a requestAnimationFrame loop and cancels it on unmount', () => {
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
  const { unmount } = render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  expect(rafSpy).toHaveBeenCalled()
  unmount()
  expect(cancelSpy).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: FAIL — `GameScreen` still uses the old per-move-redraw, fixed-to-board-size
canvas; the RAF-loop assertions don't hold yet.

- [ ] **Step 3: Implement**

Replace `src/game/GameScreen.tsx` entirely:

```tsx
import { useEffect, useRef, useState } from 'react'
import { GameState } from './engine/GameState'
import { Direction, PLAYER_ID, World } from './engine/types'
import { DrawContext, DEFAULT_RENDER_BUDGET, drawBoardRecursive, indexPiecesByBoard } from './render/CanvasRenderer'
import { CameraTransform, Viewport, cameraForPlayer } from './render/camera'
import { resolveAnchorBoardId } from './render/recursiveTransform'
import { DPad } from '../ui/DPad'
import { SwipeLayer } from '../ui/SwipeLayer'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const wonRef = useRef(false)
  const viewportRef = useRef<Viewport>({ width: 320, height: 320 })

  const handleMove = (direction: Direction) => {
    if (state.move(direction)) setTick((t) => t + 1)
  }

  const handleUndo = () => {
    if (state.undo()) {
      wonRef.current = false
      setTick((t) => t + 1)
    }
  }

  useEffect(() => {
    if (state.isWon && !wonRef.current) {
      wonRef.current = true
      onWin()
    }
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateViewport = () => {
      viewportRef.current = { width: el.clientWidth || 320, height: el.clientHeight || 320 }
    }
    updateViewport()
    // jsdom (this project's test environment) does not implement ResizeObserver at all —
    // the initial size captured above still applies; a real browser gets live resizing.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateViewport)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      const direction = map[e.key]
      if (direction) handleMove(direction)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let rafId: number

    const frame = () => {
      const viewport = viewportRef.current
      const dpr = window.devicePixelRatio || 1
      const targetWidth = Math.round(viewport.width * dpr)
      const targetHeight = Math.round(viewport.height * dpr)
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewport.width, viewport.height)

      const world = state.current
      const camera: CameraTransform = cameraForPlayer(world, { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels })
      const anchorBoardId = resolveAnchorBoardId(world, camera.anchor)
      if (anchorBoardId !== null && world.boards[anchorBoardId] !== undefined) {
        const dc: DrawContext = {
          ctx,
          world,
          camera,
          viewport,
          budget: DEFAULT_RENDER_BUDGET,
          piecesByBoard: indexPiecesByBoard(world),
          cellsDrawnSoFar: { count: 0 },
        }
        drawBoardRecursive(dc, world.boards[anchorBoardId], { boardId: anchorBoardId, originX: 0, originY: 0, scale: 1 }, 0, 0, false)
      }
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [state])

  return (
    <div className="game-screen">
      <div className="hud">
        <span>步数: {state.moveCount}</span>
        <button onClick={handleUndo}>复位上一步</button>
        <button onClick={onExit}>离开</button>
      </div>
      <SwipeLayer onMove={handleMove}>
        <div ref={containerRef} className="game-viewport">
          <canvas ref={canvasRef} />
        </div>
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
```

In `src/index.css`, add a `.game-viewport` rule (near the existing `.game-screen` block)
giving the canvas's container an explicit, responsive size, and remove `image-rendering:
pixelated` from the existing `canvas` rule — that setting hard-edges every pixel, which
looked right for the old instant-snap grid renderer but fights the new continuously
panned/zoomed, fractional-pixel-position recursive scene:

```css
.game-viewport {
  width: 100%;
  max-width: 400px;
  aspect-ratio: 1;
}

canvas {
  max-width: 100%;
  border: 1px solid var(--surface-raised);
  border-radius: 8px;
  display: block;
  width: 100%;
  height: 100%;
}
```

(Remove the old `image-rendering: pixelated;` line from the existing `canvas` rule when
making this edit — don't leave both a `width:100%` block-level and the old rule present
twice.)

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: PASS, every test.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

Run the full suite once: `npx vitest run`
Expected: everything else still passes (`App.test.tsx` may reference `GameScreen` —
confirm it still renders without throwing; fix only if it fails, this task doesn't
otherwise touch `App.tsx`).

- [ ] **Step 5: Commit**

```bash
git add src/game/GameScreen.tsx src/game/GameScreen.test.tsx src/index.css
git commit -m "feat(render): GameScreen drives the recursive renderer from a live RAF loop"
```

---

### Task 7: `GameScreen.tsx` — animation (movement tween, camera easing, Void transition)

**Files:**
- Modify: `src/game/GameScreen.tsx`
- Modify: `src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: `RenderAnimation` (module-private to `GameScreen.tsx`), `getRenderLocation`
  (module-private), extends `DrawContext` (Task 4/5) with an optional
  `getRenderLocation?: (pieceId: PieceId) => Location` field that `drawBoardRecursive`
  consults in place of `piecesByBoard`'s raw location, for both a piece's own draw AND its
  recursive `childTransform` placement (§10.2's "moving container" requirement) — this is
  the one addition this task makes to `CanvasRenderer.ts` itself, everything else is
  `GameScreen.tsx`-local.

**Files (additional):**
- Modify: `src/game/render/CanvasRenderer.ts` (the `getRenderLocation` hook)
- Modify: `src/game/render/CanvasRenderer.test.ts` (one new test for the hook)

- [ ] **Step 1: Write the failing tests**

Add to `src/game/render/CanvasRenderer.test.ts`:

```ts
describe('drawBoardRecursive — getRenderLocation override', () => {
  it('uses getRenderLocation\'s position for both the piece\'s own draw and its recursive placement', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside' }],
      { box: { board: 'root', x: 0, y: 0 } },
    )
    const ctx = mockContext()
    const fillXs: number[] = []
    ctx.fillRect = (x) => { fillXs.push(x as number) }
    const dc = {
      ctx,
      world,
      camera: { anchor: 'root' as const, centerX: 2, centerY: 2, pixelsPerRootUnit: 32 },
      viewport: { width: 128, height: 128 },
      budget: DEFAULT_RENDER_BUDGET,
      piecesByBoard: indexPiecesByBoard(world),
      cellsDrawnSoFar: { count: 0 },
      // pretend box is actually at x=2 this frame (mid-tween), not its stored x=0
      getRenderLocation: (pieceId: string) => (pieceId === 'box' ? { board: 'root', x: 2, y: 0 } : world.locations[pieceId]),
    }
    drawBoardRecursive(dc, root, { boardId: 'root', originX: 0, originY: 0, scale: 1 }, 0, 0, false)
    // box's own fill, and its nested board's cells, must appear at screen x >= 2*32=64,
    // not at x=0 where its stored Location would otherwise place them.
    const boxOwnFillX = fillXs[16] // 16 root cells, then box's own fill
    expect(boxOwnFillX).toBeGreaterThanOrEqual(64)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: FAIL — `getRenderLocation` isn't read by `drawBoardRecursive` yet.

- [ ] **Step 3: Implement the `getRenderLocation` hook**

In `src/game/render/CanvasRenderer.ts`, add the optional field to `DrawContext`:

```ts
export interface DrawContext {
  ctx: CanvasRenderingContext2D
  world: World
  camera: CameraTransform
  viewport: Viewport
  budget: RenderBudget
  piecesByBoard: PiecesByBoard
  cellsDrawnSoFar: { count: number }
  getRenderLocation?: (pieceId: PieceId) => Location | undefined
}
```

In the piece loop inside `drawBoardRecursive`, replace the single line
`for (const { pieceId, location } of entries) {` body's use of `location` at its very
first use with a resolved value:

```ts
  for (const { pieceId, location: storedLocation } of entries) {
    const location = dc.getRenderLocation?.(pieceId) ?? storedLocation
    const piece = dc.world.pieces[pieceId]
    // ...rest of the loop body unchanged — it already only ever reads `location`,
    // never storedLocation, for both the piece's own screen position and the
    // childTransform passed into the recursive call...
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: PASS, every test including the new one and every prior task's tests.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

- [ ] **Step 5: Commit the hook**

```bash
git add src/game/render/CanvasRenderer.ts src/game/render/CanvasRenderer.test.ts
git commit -m "feat(render): drawBoardRecursive accepts a getRenderLocation override for animation"
```

- [ ] **Step 6: Write the failing GameScreen animation tests**

Add to `src/game/GameScreen.test.tsx`:

```tsx
test('captures the exact pre-move and post-move World via state.current, not a history index', async () => {
  // Indirect proof: after one move then one undo, the move counter (driven by
  // GameState.moveCount, itself derived from history.length) is exactly 0 — proves the
  // animation capture never mutated or mis-indexed GameState's own history.
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByText('复位上一步'))
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
})

test('an ordinary move still resolves to the correct final position after its animation settles', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByLabelText('右'))
  await new Promise((resolve) => setTimeout(resolve, 500)) // outlast every animation duration (max 400ms)
  expect(screen.getByText('步数: 2')).toBeInTheDocument()
})

test('undo cancels any in-flight animation and settles on the reverted state', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByText('复位上一步'))
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
  // no throw, no leftover animation referencing a now-stale pre/post pair
})
```

(These are necessarily coarser than the pure-logic tasks' tests — animation timing inside
a mocked jsdom canvas is hard to assert on frame-by-frame without a fake-timer/RAF harness
this codebase doesn't have yet. The three tests above pin the externally-observable
contract: exact pre/post capture doesn't corrupt `GameState`, a move still resolves
correctly once its animation settles, and undo doesn't leave a broken in-flight state.
Manual verification, Step 8, is the real check for the animation *feel*.)

- [ ] **Step 7: Implement animation**

Replace `src/game/GameScreen.tsx`'s RAF `useEffect` block (from Task 6) and add the
animation machinery. Full replacement of the component body:

```tsx
import { useEffect, useRef, useState } from 'react'
import { GameState } from './engine/GameState'
import { Direction, Location, PieceId, PLAYER_ID, VOID_BOARD_ID, World } from './engine/types'
import { DrawContext, DEFAULT_RENDER_BUDGET, drawBoardRecursive, indexPiecesByBoard } from './render/CanvasRenderer'
import { CameraAnchor, CameraTransform, Viewport, cameraForPlayer } from './render/camera'
import { resolveAnchorBoardId } from './render/recursiveTransform'
import { DPad } from '../ui/DPad'
import { SwipeLayer } from '../ui/SwipeLayer'

type AnimationKind = 'move' | 'enter-leave' | 'teleport' | 'void-transition'

interface RenderAnimation {
  preWorld: World
  postWorld: World
  startTimeMs: number
  durationMs: number
  kind: AnimationKind
  sourceCamera: CameraTransform
  targetCamera: CameraTransform
}

const DURATIONS: Record<AnimationKind, number> = {
  move: 120,
  'enter-leave': 250,
  teleport: 400,
  'void-transition': 400,
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function isSimpleContainmentStep(world: World, oldBoard: string, newBoard: string): boolean {
  const newOwner = Object.values(world.pieces).find((p) => p.kind === 'container' && p.boardRef === newBoard)
  if (newOwner !== undefined && world.locations[newOwner.id]?.board === oldBoard) return true
  const oldOwner = Object.values(world.pieces).find((p) => p.kind === 'container' && p.boardRef === oldBoard)
  if (oldOwner !== undefined && world.locations[oldOwner.id]?.board === newBoard) return true
  return false
}

function classifyMove(preWorld: World, postWorld: World): AnimationKind {
  const oldBoard = preWorld.locations[PLAYER_ID]?.board
  const newBoard = postWorld.locations[PLAYER_ID]?.board
  if (oldBoard === undefined || newBoard === undefined || oldBoard === newBoard) return 'move'
  if (oldBoard === VOID_BOARD_ID || newBoard === VOID_BOARD_ID) return 'void-transition'
  if (isSimpleContainmentStep(postWorld, oldBoard, newBoard)) return 'enter-leave'
  return 'teleport'
}

function getRenderLocationFactory(preWorld: World, postWorld: World, t: number) {
  return (pieceId: PieceId): Location | undefined => {
    const pre = preWorld.locations[pieceId]
    const post = postWorld.locations[pieceId]
    if (post === undefined) return pre
    if (pre === undefined || pre.board !== post.board) return post
    return { board: post.board, x: lerp(pre.x, post.x, t), y: lerp(pre.y, post.y, t) }
  }
}

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
  const containerRef = useRef<HTMLDivElement>(null)
  const wonRef = useRef(false)
  const viewportRef = useRef<Viewport>({ width: 320, height: 320 })
  const animationRef = useRef<RenderAnimation | null>(null)

  const handleMove = (direction: Direction) => {
    const preMoveWorld = state.current
    const moved = state.move(direction)
    if (!moved) return
    const postMoveWorld = state.current
    const kind = classifyMove(preMoveWorld, postMoveWorld)
    const budget = { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels }
    animationRef.current = {
      preWorld: preMoveWorld,
      postWorld: postMoveWorld,
      startTimeMs: performance.now(),
      durationMs: DURATIONS[kind],
      kind,
      sourceCamera: cameraForPlayer(preMoveWorld, budget),
      targetCamera: cameraForPlayer(postMoveWorld, budget),
    }
    setTick((t) => t + 1)
  }

  const handleUndo = () => {
    if (state.undo()) {
      wonRef.current = false
      animationRef.current = null // cancel any in-flight animation — undo settles instantly
      setTick((t) => t + 1)
    }
  }

  useEffect(() => {
    if (state.isWon && !wonRef.current) {
      wonRef.current = true
      onWin()
    }
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateViewport = () => {
      viewportRef.current = { width: el.clientWidth || 320, height: el.clientHeight || 320 }
    }
    updateViewport()
    // jsdom (this project's test environment) does not implement ResizeObserver at all —
    // the initial size captured above still applies; a real browser gets live resizing.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateViewport)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      const direction = map[e.key]
      if (direction) handleMove(direction)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let rafId: number

    const frame = () => {
      const viewport = viewportRef.current
      const dpr = window.devicePixelRatio || 1
      const targetWidth = Math.round(viewport.width * dpr)
      const targetHeight = Math.round(viewport.height * dpr)
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewport.width, viewport.height)

      const anim = animationRef.current
      let world = state.current
      let camera: CameraTransform
      let dimAlpha = 0 // Void-transition darken overlay, 0..1

      if (anim !== null) {
        const rawT = (performance.now() - anim.startTimeMs) / anim.durationMs
        if (rawT >= 1) {
          animationRef.current = null
          world = state.current
          camera = cameraForPlayer(world, { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels })
        } else {
          const t = easeOut(Math.max(0, rawT))
          if (anim.kind === 'void-transition' || anim.sourceCamera.anchor !== anim.targetCamera.anchor) {
            // Anchors are never interpolated (§12) — two-phase darken/swap/fade instead.
            if (t < 0.5) {
              world = anim.preWorld
              camera = anim.sourceCamera
              dimAlpha = t / 0.5
            } else {
              world = anim.postWorld
              camera = anim.targetCamera
              dimAlpha = 1 - (t - 0.5) / 0.5
            }
          } else {
            world = anim.postWorld
            camera = {
              anchor: anim.targetCamera.anchor,
              centerX: lerp(anim.sourceCamera.centerX, anim.targetCamera.centerX, t),
              centerY: lerp(anim.sourceCamera.centerY, anim.targetCamera.centerY, t),
              pixelsPerRootUnit: lerp(anim.sourceCamera.pixelsPerRootUnit, anim.targetCamera.pixelsPerRootUnit, t),
            }
          }
        }
      } else {
        camera = cameraForPlayer(world, { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels })
      }

      const anchorBoardId = resolveAnchorBoardId(world, camera.anchor)
      if (anchorBoardId !== null && world.boards[anchorBoardId] !== undefined) {
        const currentAnim = animationRef.current
        const dc: DrawContext = {
          ctx,
          world,
          camera,
          viewport,
          budget: DEFAULT_RENDER_BUDGET,
          piecesByBoard: indexPiecesByBoard(world),
          cellsDrawnSoFar: { count: 0 },
          getRenderLocation:
            currentAnim !== null && currentAnim.kind === 'move'
              ? getRenderLocationFactory(currentAnim.preWorld, currentAnim.postWorld, easeOut(Math.max(0, Math.min(1, (performance.now() - currentAnim.startTimeMs) / currentAnim.durationMs))))
              : undefined,
        }
        drawBoardRecursive(dc, world.boards[anchorBoardId], { boardId: anchorBoardId, originX: 0, originY: 0, scale: 1 }, 0, 0, false)
      }

      if (dimAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${dimAlpha})`
        ctx.fillRect(0, 0, viewport.width, viewport.height)
      }

      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [state])

  return (
    <div className="game-screen">
      <div className="hud">
        <span>步数: {state.moveCount}</span>
        <button onClick={handleUndo}>复位上一步</button>
        <button onClick={onExit}>离开</button>
      </div>
      <SwipeLayer onMove={handleMove}>
        <div ref={containerRef} className="game-viewport">
          <canvas ref={canvasRef} />
        </div>
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
```

- [ ] **Step 8: Run and confirm they pass**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: PASS, every test.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors.

Run the full suite: `npx vitest run`
Expected: every test file passes — this is the last task, so a clean full run here means
the whole plan is done.

**Manual verification** (per the spec's own testing section — not fully automatable for a
continuously-animated canvas scene): `npm run dev`, play `11-clone-box`, `12-flip-box`,
`13-transfer` and confirm each visibly demonstrates its mechanic through the recursive
render (a clone shows a paler live peek of its main body, a fliph container shows mirrored
content, a linkedTo container shows the cyan border); confirm an ordinary push slides
instead of snapping; confirm entering/leaving a container zooms instead of cutting;
confirm a self-loop level shows itself recursively at normal zoom without stuttering or
hanging.

- [ ] **Step 9: Commit**

```bash
git add src/game/GameScreen.tsx src/game/GameScreen.test.tsx
git commit -m "feat(render): animate ordinary moves, camera transitions, and Void entry/exit"
```
