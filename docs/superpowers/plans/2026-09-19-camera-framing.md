# Camera Framing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `cameraForPlayer`'s targeting formula with `cameraForFocus`, which only
reframes when the player's board changes and always shows the player's current
container as seen from one level up, with a fixed 1-cell margin (root and Void included,
via the same rule).

**Architecture:** `camera.ts` gains a new formula with two cases decided by comparing
the player's current board to the resolved anchor board — Case 1 (not the anchor) zooms
out to the container piece's own parent board; Case 2 (is the anchor) frames the whole
anchor board plus margin. `CanvasRenderer.ts`'s shared budget constant drops its old
per-cell-pixel field in favor of `marginCells`. `GameScreen.tsx`'s three call sites are
updated to the new signature; no animation-loop or classification logic changes, since
the new formula produces identical source/target cameras for same-board moves on its
own.

**Tech Stack:** TypeScript, Vitest, React (existing project stack — no new dependencies).

**Spec:** `docs/superpowers/specs/2026-09-18-camera-framing-design.md`

## Global Constraints

- `marginCells` default is `1` (confirmed design decision — spec "Design decisions").
- `cameraForFocus(world, viewport, budget, cachedRootAnchorBoardId?)` — `viewport` is
  required, not optional (spec "Interface changes").
- Branch condition is `focusBoardId === anchorBoardId`, never "does `findContainerFor`
  return a piece" — a pure-cycle level's cached anchor board can have a real structural
  owner through the cycle and must still hit Case 2 (spec "What 'current container'
  means", corrected).
- Zoom always divides by `Math.min(viewport.width, viewport.height)` (the viewport's
  shorter side), never a fixed pixel constant (spec "Interface changes").
- `clampCameraZoom`'s existing `MIN_ZOOM`/`MAX_ZOOM` bounds (`4`/`4096`) are unchanged
  and still wrap every computed zoom, including the fallback.
- `RenderBudget`'s `minCellPixels`, `maxCellsPerFrame`, `maxRecursionDepth` fields, and
  the recursive draw's own cutoff logic in `CanvasRenderer.ts`, are untouched by this
  plan — only the camera-specific field changes.

---

### Task 1: `cameraForFocus` — new targeting formula in `camera.ts`

**Files:**
- Modify: `src/game/render/camera.ts` (full rewrite of `CameraBudget`,
  `cameraFallbackForAnchor`, and the exported camera function; `Viewport`,
  `CameraTransform`, `clampCameraZoom`, `worldToScreen` are unchanged)
- Test: `src/game/render/camera.test.ts` (full rewrite of the `cameraForPlayer`
  describe block and the `cameraFallbackForAnchor` describe block; `clampCameraZoom`
  and `worldToScreen` describe blocks at the top of the file are unchanged, keep them
  as-is)

**Interfaces:**
- Consumes: `findContainerFor(world: World, boardId: BoardId): PieceId | undefined` and
  `isInVoid(world: World, pieceId: PieceId): boolean` from `../engine/types` (both
  already exist, unchanged). `resolveAnchorBoardId(world: World, anchor: CameraAnchor):
  BoardId | null` and `resolveCanonicalBoardTransform(world: World, boardId: BoardId,
  anchor: CameraAnchor, cachedRootAnchorBoardId?: BoardId): BoardTransform | null` from
  `./recursiveTransform` (both already exist, unchanged — `resolveAnchorBoardId` is a
  new import to this file; `resolveCanonicalBoardTransform` was already imported).
- Produces: `export function cameraForFocus(world: World, viewport: Viewport, budget:
  CameraBudget, cachedRootAnchorBoardId?: BoardId): CameraTransform` — this is the name
  Task 3 imports and calls. `export interface CameraBudget { marginCells: number }` —
  this is the shape Task 2's `DEFAULT_RENDER_BUDGET.marginCells` must match when Task 3
  builds a `CameraBudget` from it. `export function cameraFallbackForAnchor(anchor:
  CameraAnchor, viewport: Viewport, budget: CameraBudget): CameraTransform` — signature
  change (was `(anchor, targetPlayerCellPixels: number)`); nothing outside this file
  calls it directly today, but keep it exported (existing tests exercise it directly).

- [ ] **Step 1: Write the failing tests**

Replace the entire `describe('cameraForPlayer', ...)` and `describe('cameraFallbackForAnchor', ...)` blocks in `src/game/render/camera.test.ts` (everything from line 35 to the end of the file) with:

```ts
describe('cameraForFocus', () => {
  const viewport = { width: 300, height: 300 } // shortSide 300, chosen for clean division by 3/4/6/7

  it('centers on the containing piece\'s own cell on its parent board, with a 1-cell margin, when the player is inside a container', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'container', boardRef: 'inside' }],
      { [PLAYER_ID]: { board: 'inside', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 1 } },
    )
    const camera = cameraForFocus(world, viewport, { marginCells: 1 })
    expect(camera.anchor).toBe('root')
    // 'box' sits at (2,1) on 'root' (scale 1, since 'root' is the anchor) -> center (2.5, 1.5)
    expect(camera.centerX).toBeCloseTo(2.5)
    expect(camera.centerY).toBeCloseTo(1.5)
    // span = 1 (box's own cell) + 2*1 (margin) = 3 parent-units; zoom = shortSide / (3 * scale 1)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(100)
  })

  it('does not move as the player walks around inside the same board (only the containing piece\'s position matters)', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const makeAt = (x: number, y: number) => makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'container', boardRef: 'inside' }],
      { [PLAYER_ID]: { board: 'inside', x, y }, box: { board: 'root', x: 2, y: 1 } },
    )
    const cameraA = cameraForFocus(makeAt(0, 0), viewport, { marginCells: 1 })
    const cameraB = cameraForFocus(makeAt(1, 1), viewport, { marginCells: 1 })
    expect(cameraB).toEqual(cameraA)
  })

  it('frames the whole anchor board plus a 1-cell margin when the player stands directly on it, regardless of their own position', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 1, y: 2 } })
    const camera = cameraForFocus(world, viewport, { marginCells: 1 })
    expect(camera.anchor).toBe('root')
    // board midpoint (4/2, 4/2), NOT the player's own (1,2)
    expect(camera.centerX).toBeCloseTo(2)
    expect(camera.centerY).toBeCloseTo(2)
    // span = boardSize(4) + 2*marginCells(1) = 6; zoom = 300/6
    expect(camera.pixelsPerRootUnit).toBeCloseTo(50)
  })

  it('applies the same whole-board-plus-margin framing in the Void', () => {
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 5)
    const world = makeWorld([voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: VOID_BOARD_ID, x: 2, y: 2 } })
    const camera = cameraForFocus(world, viewport, { marginCells: 1 })
    expect(camera.anchor).toBe('void')
    expect(camera.centerX).toBeCloseTo(2.5) // 5/2
    expect(camera.centerY).toBeCloseTo(2.5)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(300 / 7) // span = 5 + 2
  })

  it('falls back to a defined default instead of NaN when the player has no location', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [], {})
    const camera = cameraForFocus(world, viewport, { marginCells: 1 })
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.centerY)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })

  it('falls back to a defined default when the containing piece\'s parent board has no reachable canonical transform', () => {
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
    const camera = cameraForFocus(world, viewport, { marginCells: 1 })
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })

  it('I3 regression, corrected for the new branch: a pure-cycle level\'s cached anchor board frames itself (Case 2), even though it has a structural owner through the cycle', () => {
    // Same pure-cycle 'start'/'redInterior' shape as recursiveTransform.test.ts's I3
    // regression: no zero-owner board exists, so the anchor's fallback is the player's
    // own board at level load ('start', cached below). 'start' is itself owned by
    // yellowPiece (which sits on 'redInterior') through the cycle — proving the branch
    // must compare focusBoardId to the anchor board id directly, not ask whether
    // findContainerFor(focusBoardId) is defined.
    const start = makeFloorBoard('start', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const makePieces = () => [
      { id: PLAYER_ID, kind: 'player' as const },
      { id: 'redPiece', kind: 'container' as const, boardRef: 'redInterior' },
      { id: 'yellowPiece', kind: 'container' as const, boardRef: 'start' },
    ]
    const preWorld = makeWorld(
      [start, redInterior], makePieces(),
      { [PLAYER_ID]: { board: 'start', x: 0, y: 0 }, redPiece: { board: 'start', x: 1, y: 0 }, yellowPiece: { board: 'redInterior', x: 0, y: 0 } },
    )
    const postWorld = makeWorld(
      [start, redInterior], makePieces(),
      { [PLAYER_ID]: { board: 'redInterior', x: 0, y: 0 }, redPiece: { board: 'start', x: 1, y: 0 }, yellowPiece: { board: 'redInterior', x: 0, y: 0 } },
    )
    const budget = { marginCells: 1 }
    const cachedRootAnchorBoardId = 'start'

    const preCamera = cameraForFocus(preWorld, viewport, budget, cachedRootAnchorBoardId)
    const postCamera = cameraForFocus(postWorld, viewport, budget, cachedRootAnchorBoardId)
    expect(preCamera.anchor).toBe('root')
    expect(postCamera.anchor).toBe('root')
    // preWorld: player on 'start', which IS the cached anchor -> Case 2, frame the
    // whole 2x2 'start' board: midpoint (1,1), span = 2 + 2*1 = 4, zoom = 300/4 = 75.
    expect(preCamera.centerX).toBeCloseTo(1)
    expect(preCamera.centerY).toBeCloseTo(1)
    expect(preCamera.pixelsPerRootUnit).toBeCloseTo(75)
    // postWorld: player on 'redInterior' (not the anchor) -> Case 1. Owner is
    // 'redPiece', sitting on 'start' (the anchor, scale 1) at (1,0) -> center (1.5,0.5).
    // span = 1 + 2*1 = 3, zoom = 300/3 = 100.
    expect(postCamera.centerX).toBeCloseTo(1.5)
    expect(postCamera.centerY).toBeCloseTo(0.5)
    expect(postCamera.pixelsPerRootUnit).toBeCloseTo(100)
  })

  it('self-loop worked example: a self-loop nested inside an outer container does not change which piece the camera frames on', () => {
    // 'outer' (boardRef: 'interior') sits on 'root' at (2,1). 'loop' is a self-loop
    // nested INSIDE 'interior' (boardRef: 'interior', sits ON 'interior' itself) —
    // worldEdit.test.ts's "self-loop inside board-0" shape. Both 'outer' and 'loop'
    // have boardRef === 'interior'; findContainerFor returns the first match by
    // insertion order, so 'outer' (registered first, as any normal level authors it)
    // wins over 'loop's own self-reference.
    const root = makeFloorBoard('root', 4)
    const interior = makeFloorBoard('interior', 2)
    const world = makeWorld(
      [root, interior],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'outer', kind: 'container', boardRef: 'interior' },
        { id: 'loop', kind: 'container', boardRef: 'interior' },
      ],
      {
        [PLAYER_ID]: { board: 'interior', x: 1, y: 1 },
        outer: { board: 'root', x: 2, y: 1 },
        loop: { board: 'interior', x: 0, y: 0 },
      },
    )
    const camera = cameraForFocus(world, viewport, { marginCells: 1 })
    // Centers on 'outer's own cell on 'root' (2.5, 1.5), not on the player's position on
    // 'interior' (1,1) and not on 'loop's position — same numbers as the basic Case 1 test.
    expect(camera.centerX).toBeCloseTo(2.5)
    expect(camera.centerY).toBeCloseTo(1.5)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(100)
  })
})

describe('cameraFallbackForAnchor', () => {
  it('returns a finite camera for the given anchor, zoomed to the viewport shortSide over the margin span', () => {
    const camera = cameraFallbackForAnchor('void', { width: 300, height: 300 }, { marginCells: 1 })
    expect(camera.anchor).toBe('void')
    expect(camera.centerX).toBeCloseTo(0.5)
    expect(camera.centerY).toBeCloseTo(0.5)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(100) // 300 / (1 + 2*1)
  })

  it('uses the shorter of width/height for a non-square viewport', () => {
    const camera = cameraFallbackForAnchor('root', { width: 400, height: 300 }, { marginCells: 1 })
    expect(camera.pixelsPerRootUnit).toBeCloseTo(100) // min(400,300)=300 / 3
  })
})
```

Also update the top import line (line 2) from:

```ts
import { cameraForPlayer, clampCameraZoom, worldToScreen, cameraFallbackForAnchor } from './camera'
```

to:

```ts
import { cameraForFocus, clampCameraZoom, worldToScreen, cameraFallbackForAnchor } from './camera'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/render/camera.test.ts`
Expected: FAIL — `cameraForFocus` is not exported from `./camera` (the module still only exports `cameraForPlayer` with the old signature).

- [ ] **Step 3: Rewrite `camera.ts`**

Replace the entire contents of `src/game/render/camera.ts` with:

```ts
import { BoardId, PLAYER_ID, World, findContainerFor, isInVoid } from '../engine/types'
import { CameraAnchor, resolveAnchorBoardId, resolveCanonicalBoardTransform } from './recursiveTransform'

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
  marginCells: number
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

export function cameraFallbackForAnchor(anchor: CameraAnchor, viewport: Viewport, budget: CameraBudget): CameraTransform {
  const spanUnits = 1 + 2 * budget.marginCells
  const shortSide = Math.min(viewport.width, viewport.height)
  return { anchor, centerX: 0.5, centerY: 0.5, pixelsPerRootUnit: clampCameraZoom(shortSide / spanUnits) }
}

// cachedRootAnchorBoardId: see resolveCanonicalBoardTransform's own doc — thread through
// the same anchor board id resolved once per level load, so pre-move/post-move cameras
// computed for one animated move stay in the same coordinate space (final-review I3).
export function cameraForFocus(
  world: World,
  viewport: Viewport,
  budget: CameraBudget,
  cachedRootAnchorBoardId?: BoardId,
): CameraTransform {
  const anchor: CameraAnchor = isInVoid(world, PLAYER_ID) ? 'void' : 'root'
  const playerLoc = world.locations[PLAYER_ID]
  if (playerLoc === undefined) return cameraFallbackForAnchor(anchor, viewport, budget)

  const focusBoardId = playerLoc.board
  const shortSide = Math.min(viewport.width, viewport.height)
  const anchorBoardId =
    anchor === 'root' && cachedRootAnchorBoardId !== undefined
      ? cachedRootAnchorBoardId
      : resolveAnchorBoardId(world, anchor)
  if (anchorBoardId === null) return cameraFallbackForAnchor(anchor, viewport, budget)

  // focusBoardId !== anchorBoardId: zoom out to the piece that owns focusBoardId,
  // framed on THAT piece's own parent board.
  //
  // focusBoardId === anchorBoardId: focusBoardId is the anchor board itself (root, the
  // Void board, or a pure-cycle level's cached anchor — which can still have a real
  // structural owner through the cycle; that's irrelevant here, mirroring
  // resolveCanonicalBoardTransform's own boardId === anchorBoardId short-circuit, which
  // never climbs to that owner either).
  if (focusBoardId !== anchorBoardId) {
    const containerPieceId = findContainerFor(world, focusBoardId)
    const containerLoc = containerPieceId !== undefined ? world.locations[containerPieceId] : undefined
    if (containerLoc !== undefined) {
      const parentTransform = resolveCanonicalBoardTransform(world, containerLoc.board, anchor, cachedRootAnchorBoardId)
      if (parentTransform !== null) {
        const centerX = parentTransform.originX + (containerLoc.x + 0.5) * parentTransform.scale
        const centerY = parentTransform.originY + (containerLoc.y + 0.5) * parentTransform.scale
        const spanUnits = 1 + 2 * budget.marginCells
        const targetZoom = shortSide / (spanUnits * parentTransform.scale)
        return { anchor, centerX, centerY, pixelsPerRootUnit: clampCameraZoom(targetZoom) }
      }
    }
    return cameraFallbackForAnchor(anchor, viewport, budget)
  }

  const anchorTransform = resolveCanonicalBoardTransform(world, focusBoardId, anchor, cachedRootAnchorBoardId)
  const boardSize = world.boards[focusBoardId]?.size
  if (anchorTransform === null || boardSize === undefined) return cameraFallbackForAnchor(anchor, viewport, budget)

  const centerX = anchorTransform.originX + (boardSize / 2) * anchorTransform.scale
  const centerY = anchorTransform.originY + (boardSize / 2) * anchorTransform.scale
  const spanUnits = boardSize + 2 * budget.marginCells
  const targetZoom = shortSide / (spanUnits * anchorTransform.scale)
  return { anchor, centerX, centerY, pixelsPerRootUnit: clampCameraZoom(targetZoom) }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/render/camera.test.ts`
Expected: PASS, all tests in the file (including the untouched `clampCameraZoom` and `worldToScreen` blocks).

- [ ] **Step 5: Commit**

```bash
git add src/game/render/camera.ts src/game/render/camera.test.ts
git commit -m "feat(render): cameraForFocus replaces cameraForPlayer with margin-based framing"
```

---

### Task 2: `RenderBudget`'s shared constant — `marginCells` replaces `targetPlayerCellPixels`

**Files:**
- Modify: `src/game/render/CanvasRenderer.ts:31-43` (the `RenderBudget` interface and
  `DEFAULT_RENDER_BUDGET` constant only — nothing else in this file changes)
- Test: `src/game/render/CanvasRenderer.test.ts:712-721` (the `DEFAULT_RENDER_BUDGET`
  describe block only)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DEFAULT_RENDER_BUDGET.marginCells === 1`, read by Task 3 to build the
  `CameraBudget` object it passes to `cameraForFocus`.

- [ ] **Step 1: Write the failing test**

In `src/game/render/CanvasRenderer.test.ts`, replace the `describe('DEFAULT_RENDER_BUDGET', ...)` block (lines 712-721) with:

```ts
describe('DEFAULT_RENDER_BUDGET', () => {
  it('matches the spec\'s exact default values', () => {
    expect(DEFAULT_RENDER_BUDGET).toEqual({
      minCellPixels: 4,
      maxCellsPerFrame: 4000,
      maxRecursionDepth: 48,
      marginCells: 1,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts -t "DEFAULT_RENDER_BUDGET"`
Expected: FAIL — actual value still has `targetPlayerCellPixels: 64` instead of `marginCells: 1`.

- [ ] **Step 3: Update `RenderBudget` and `DEFAULT_RENDER_BUDGET`**

In `src/game/render/CanvasRenderer.ts`, replace:

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
```

with:

```ts
export interface RenderBudget {
  minCellPixels: number
  maxCellsPerFrame: number
  maxRecursionDepth: number
  marginCells: number
}

export const DEFAULT_RENDER_BUDGET: RenderBudget = {
  minCellPixels: 4,
  maxCellsPerFrame: 4000,
  maxRecursionDepth: 48,
  marginCells: 1,
}
```

- [ ] **Step 4: Run the full `CanvasRenderer.test.ts` file to verify nothing else broke**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: PASS. `targetPlayerCellPixels` was never read anywhere else in this file (it
only fed the camera, which this file does not compute) — confirm this by searching the
file for `targetPlayerCellPixels` before running; there should be no remaining match
after Step 3.

- [ ] **Step 5: Commit**

```bash
git add src/game/render/CanvasRenderer.ts src/game/render/CanvasRenderer.test.ts
git commit -m "feat(render): DEFAULT_RENDER_BUDGET.marginCells replaces targetPlayerCellPixels"
```

---

### Task 3: Wire `GameScreen.tsx` to `cameraForFocus`

**Files:**
- Modify: `src/game/GameScreen.tsx` (import line, `handleMove`, the two live-camera
  computations inside the `frame()` closure)
- Test: `src/game/GameScreen.test.tsx` (new `describe('camerasForMove', ...)` block;
  everything else in this file is unchanged)

**Interfaces:**
- Consumes: `cameraForFocus(world: World, viewport: Viewport, budget: CameraBudget,
  cachedRootAnchorBoardId?: BoardId): CameraTransform` and `export interface
  CameraBudget { marginCells: number }` from `./render/camera` (Task 1).
  `DEFAULT_RENDER_BUDGET.marginCells: number` from `./render/CanvasRenderer` (Task 2).
- Produces: `export function camerasForMove(preWorld: World, postWorld: World, viewport:
  Viewport, budget: CameraBudget, cachedRootAnchorBoardId?: BoardId): { sourceCamera:
  CameraTransform; targetCamera: CameraTransform }` — a small pure helper extracted so
  the "same-board move produces identical cameras" property (spec "Interaction with
  animation") can be unit-tested directly, the same way `classifyMove` and
  `getRenderLocationFactory` are already exported from this file for direct testing.

- [ ] **Step 1: Write the failing test**

Add this to `src/game/GameScreen.test.tsx`. First, add `camerasForMove` to the existing import block at the top of the file (currently `import { GameScreen, classifyMove, isSimpleContainmentStep, getRenderLocationFactory, easeOut, lerp } from './GameScreen'`) — add `camerasForMove` to that list. Then append this new describe block (anywhere after the existing describes, e.g. after the `describe('lerp', ...)` block at the end of the file):

```ts
describe('camerasForMove', () => {
  it('produces identical source and target cameras for a same-board move (no reframe)', () => {
    const root = makeFloorBoard('root', 4)
    const preWorld = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 1, y: 1 } })
    const postWorld = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 2, y: 1 } })
    const viewport = { width: 300, height: 300 }
    const budget = { marginCells: 1 }
    const { sourceCamera, targetCamera } = camerasForMove(preWorld, postWorld, viewport, budget)
    expect(targetCamera).toEqual(sourceCamera)
  })

  it('produces different source and target cameras when the player enters a container', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const pieces = [{ id: PLAYER_ID, kind: 'player' as const }, { id: 'box', kind: 'container' as const, boardRef: 'inside' }]
    const preWorld = makeWorld([root, inside], pieces, { [PLAYER_ID]: { board: 'root', x: 2, y: 1 }, box: { board: 'root', x: 2, y: 1 } })
    const postWorld = makeWorld([root, inside], pieces, { [PLAYER_ID]: { board: 'inside', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 1 } })
    const viewport = { width: 300, height: 300 }
    const budget = { marginCells: 1 }
    const { sourceCamera, targetCamera } = camerasForMove(preWorld, postWorld, viewport, budget)
    expect(targetCamera).not.toEqual(sourceCamera)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/game/GameScreen.test.tsx -t "camerasForMove"`
Expected: FAIL — `camerasForMove` is not exported from `./GameScreen` yet.

- [ ] **Step 3: Update `GameScreen.tsx`**

Change the import line (currently line 5):

```ts
import { CameraTransform, Viewport, cameraForPlayer } from './render/camera'
```

to:

```ts
import { CameraBudget, CameraTransform, Viewport, cameraForFocus } from './render/camera'
```

Add this exported helper right after `getRenderLocationFactory` (after line 66, before `export function GameScreen`):

```ts
export function camerasForMove(
  preWorld: World,
  postWorld: World,
  viewport: Viewport,
  budget: CameraBudget,
  cachedRootAnchorBoardId?: BoardId,
): { sourceCamera: CameraTransform; targetCamera: CameraTransform } {
  return {
    sourceCamera: cameraForFocus(preWorld, viewport, budget, cachedRootAnchorBoardId),
    targetCamera: cameraForFocus(postWorld, viewport, budget, cachedRootAnchorBoardId),
  }
}
```

In `handleMove`, replace:

```ts
    const kind = classifyMove(preMoveWorld, postMoveWorld)
    const budget = { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels }
    animationRef.current = {
      preWorld: preMoveWorld,
      postWorld: postMoveWorld,
      startTimeMs: performance.now(),
      durationMs: DURATIONS[kind],
      kind,
      sourceCamera: cameraForPlayer(preMoveWorld, budget, rootAnchorBoardId),
      targetCamera: cameraForPlayer(postMoveWorld, budget, rootAnchorBoardId),
    }
```

with:

```ts
    const kind = classifyMove(preMoveWorld, postMoveWorld)
    const budget: CameraBudget = { marginCells: DEFAULT_RENDER_BUDGET.marginCells }
    const { sourceCamera, targetCamera } = camerasForMove(preMoveWorld, postMoveWorld, viewportRef.current, budget, rootAnchorBoardId)
    animationRef.current = {
      preWorld: preMoveWorld,
      postWorld: postMoveWorld,
      startTimeMs: performance.now(),
      durationMs: DURATIONS[kind],
      kind,
      sourceCamera,
      targetCamera,
    }
```

Inside the `frame()` closure (the `useEffect` starting at line 159), add one `cameraBudget` constant right after the `let dimAlpha = 0` line, and use it at both remaining `cameraForPlayer` call sites. Replace:

```ts
      const anim = animationRef.current
      let world = state.current
      let camera: CameraTransform
      let dimAlpha = 0 // Void-transition darken overlay, 0..1

      if (anim !== null) {
        const rawT = (performance.now() - anim.startTimeMs) / anim.durationMs
        if (rawT >= 1) {
          animationRef.current = null
          world = state.current
          camera = cameraForPlayer(world, { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels }, rootAnchorBoardId)
        } else {
```

with:

```ts
      const anim = animationRef.current
      let world = state.current
      let camera: CameraTransform
      let dimAlpha = 0 // Void-transition darken overlay, 0..1
      const cameraBudget: CameraBudget = { marginCells: DEFAULT_RENDER_BUDGET.marginCells }

      if (anim !== null) {
        const rawT = (performance.now() - anim.startTimeMs) / anim.durationMs
        if (rawT >= 1) {
          animationRef.current = null
          world = state.current
          camera = cameraForFocus(world, viewport, cameraBudget, rootAnchorBoardId)
        } else {
```

and replace the final `else` branch:

```ts
      } else {
        camera = cameraForPlayer(world, { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels }, rootAnchorBoardId)
      }
```

with:

```ts
      } else {
        camera = cameraForFocus(world, viewport, cameraBudget, rootAnchorBoardId)
      }
```

(`viewport` here is the `const viewport = viewportRef.current` already declared at the top of `frame()` — reuse it, don't call `viewportRef.current` again.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: PASS, all tests in the file (the new `camerasForMove` block and every
pre-existing `classifyMove`/`isSimpleContainmentStep`/`getRenderLocationFactory`/
`easeOut`/`lerp`/component-render test).

- [ ] **Step 5: Run the full project test suite**

Run: `npx vitest run`
Expected: PASS, 0 failures. This is the first point where every file touched across all
three tasks is exercised together — in particular, confirm no other file in the project
still imports `cameraForPlayer` or references `targetPlayerCellPixels`:

Run: `grep -rn "cameraForPlayer\|targetPlayerCellPixels" src/`
Expected: no output (both names fully removed from the codebase).

- [ ] **Step 6: Commit**

```bash
git add src/game/GameScreen.tsx src/game/GameScreen.test.tsx
git commit -m "feat(render): wire GameScreen to cameraForFocus"
```

---

## Manual verification (after all tasks)

Run `npm run dev`, load a level with at least one container, and confirm against the
spec's Goal section:

1. Walking around inside the same board does not move or rezoom the camera.
2. Entering a container zooms out to show it framed against its parent board, with a
   visible ring of neighboring cells, not just the container's own bare interior.
3. Standing at the literal top level shows a thin margin of black Void around the whole
   board, not the board filling the viewport edge-to-edge.

This is a genuine visual check the automated test suite above cannot substitute for —
report the result rather than asserting success from green tests alone.
