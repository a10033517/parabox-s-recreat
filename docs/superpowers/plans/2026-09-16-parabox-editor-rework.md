# Parabox Editor Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `src/editor/EditorScreen.tsx` against the current flat `World`/`Board`/`Piece` engine model so the level editor compiles and works again, and levels it saves are actually playable in-game.

**Architecture:** A new pure-function module (`src/editor/worldEdit.ts`) holds every world-mutating operation (place/delete/toggle) as `(World, ...) => World`, built on `cloneWorld`/`occupantAt` from `src/game/engine/types.ts`. `EditorScreen.tsx` becomes a thin React shell: canvas rendering (reusing the already-`World`-shaped `renderBoard`), tool selection, the double-click-into-a-container navigation, and wiring `worldEdit.ts`'s functions to clicks. Deleting a container box always cascades to everything it owns via one recursive helper, so the editor can never produce a world that fails `levelSchema.ts`'s ownership/reachability checks. `src/levels/index.ts`'s `loadCustomLevels()` stub is replaced with a real implementation, and `App.tsx` stops lazy-loading the editor behind an error boundary now that it actually compiles.

**Tech Stack:** TypeScript (strict), React 18, Vitest, @testing-library/react + @testing-library/user-event, HTML Canvas.

**Spec:** `docs/superpowers/specs/2026-09-16-parabox-editor-rework-design.md`

## Global Constraints

- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true` in `tsconfig.json` — every import and parameter must be used, or `npx tsc --noEmit` fails on any file this plan touches.
- The root board's id is always the literal string `'root'` (see `tools/generator/seed.ts`, existing level fixtures) — not a generated id.
- `PLAYER_ID` (`'player'`, from `src/game/engine/types.ts`) is the one reserved, fixed piece id. Every valid `World` has exactly one piece with this id and `kind: 'player'` (enforced by `levelSchema.ts`'s `parseLevel`).
- Never let a caught error vanish silently — `src/storage/progress.ts`'s `readJson`/`writeJson` (`console.warn` + safe fallback) is this codebase's established pattern for "don't let corrupt persisted data crash rendering."
- Test files in this repo mock `HTMLCanvasElement.prototype.getContext` and `getBoundingClientRect` in `beforeEach` rather than using a real canvas (see `src/editor/EditorScreen.test.tsx`, `src/App.test.tsx`).
- Existing files this plan does NOT touch: `src/game/engine/*` (engine/rules/schema), `tools/generator/*`, `src/game/render/CanvasRenderer.ts`, `src/game/GameScreen.tsx`.

---

### Task 1: `worldEdit.ts` — pure world-editing helpers

**Files:**
- Create: `src/editor/worldEdit.ts`
- Test: `src/editor/worldEdit.test.ts`

**Interfaces:**
- Consumes: `Board, BoardId, Cell, CellType, cloneWorld, occupantAt, Piece, PieceId, PLAYER_ID, Requirement, World` from `../game/engine/types` (all already exported there).
- Produces (used by Task 2):
  - `createEmptyBoard(id: BoardId, size: number): Board`
  - `createEmptyWorld(rootSize: number): World`
  - `deletePieceRecursively(world: World, pieceId: PieceId): World`
  - `setCellType(world: World, boardId: BoardId, x: number, y: number, type: CellType): World`
  - `setRequirement(world: World, boardId: BoardId, x: number, y: number, requirement: Requirement): World`
  - `interface EditorIds { nextBoxId: number; nextBoardId: number }`
  - `placeNormalBox(world: World, boardId: BoardId, x: number, y: number, ids: EditorIds): { world: World; ids: EditorIds } | null`
  - `placeContainerBox(world: World, boardId: BoardId, x: number, y: number, ids: EditorIds, interiorSize: number): { world: World; ids: EditorIds } | null`
  - `movePlayer(world: World, boardId: BoardId, x: number, y: number): World`
  - Piece ids are `box-${n}`, interior board ids are `board-${n}` (matches the existing editor's id-naming convention).
  - `placeNormalBox`/`placeContainerBox` return `null` (no-op) when the target cell is currently occupied by the player — the player is never deleted by a placement tool.
  - `createEmptyWorld` places the player in the board's bottom-right corner (`x: rootSize - 1, y: rootSize - 1`), not `(0, 0)`, specifically so that placing other tools at the natural top-left test coordinate `(0, 0)` never collides with the default player position.

- [ ] **Step 1: Write the failing test file**

```ts
// src/editor/worldEdit.test.ts
import { PLAYER_ID } from '../game/engine/types'
import {
  createEmptyBoard,
  createEmptyWorld,
  deletePieceRecursively,
  movePlayer,
  placeContainerBox,
  placeNormalBox,
  setCellType,
  setRequirement,
} from './worldEdit'

test('createEmptyBoard returns an all-floor square board of the given size', () => {
  const board = createEmptyBoard('b', 3)
  expect(board.id).toBe('b')
  expect(board.size).toBe(3)
  expect(board.cells).toHaveLength(3)
  expect(board.cells.every((row) => row.every((cell) => cell.type === 'floor'))).toBe(true)
})

test('createEmptyWorld has exactly one player, placed in the bottom-right corner of root', () => {
  const world = createEmptyWorld(6)
  expect(Object.keys(world.pieces)).toEqual([PLAYER_ID])
  expect(world.locations[PLAYER_ID]).toEqual({ board: 'root', x: 5, y: 5 })
  expect(world.boards.root.size).toBe(6)
})

test("setCellType changes a cell's type without mutating the original world", () => {
  const world = createEmptyWorld(6)
  const next = setCellType(world, 'root', 1, 1, 'wall')
  expect(next.boards.root.cells[1][1].type).toBe('wall')
  expect(world.boards.root.cells[1][1].type).toBe('floor')
})

test('setCellType clears a normal box occupying the cell', () => {
  let world = createEmptyWorld(6)
  const placed = placeNormalBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 })!
  world = placed.world
  const next = setCellType(world, 'root', 1, 1, 'wall')
  expect(next.pieces['box-0']).toBeUndefined()
  expect(next.locations['box-0']).toBeUndefined()
})

test('setCellType never deletes the player', () => {
  const world = createEmptyWorld(6)
  const next = setCellType(world, 'root', 5, 5, 'wall')
  expect(next.pieces[PLAYER_ID]).toBeDefined()
  expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 5, y: 5 })
})

test('setRequirement toggles a requirement on and off', () => {
  const world = createEmptyWorld(6)
  const once = setRequirement(world, 'root', 2, 2, 'box')
  expect(once.boards.root.cells[2][2].requirement).toBe('box')
  const twice = setRequirement(once, 'root', 2, 2, 'box')
  expect(twice.boards.root.cells[2][2].requirement).toBeUndefined()
})

test('setRequirement switches from one requirement straight to the other', () => {
  const world = createEmptyWorld(6)
  const boxGoal = setRequirement(world, 'root', 2, 2, 'box')
  const playerGoal = setRequirement(boxGoal, 'root', 2, 2, 'player')
  expect(playerGoal.boards.root.cells[2][2].requirement).toBe('player')
})

test('placeNormalBox adds a piece and increments the id counter', () => {
  const world = createEmptyWorld(6)
  const result = placeNormalBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 })!
  expect(result.world.pieces['box-0']).toEqual({ id: 'box-0', kind: 'normal' })
  expect(result.world.locations['box-0']).toEqual({ board: 'root', x: 1, y: 1 })
  expect(result.ids).toEqual({ nextBoxId: 1, nextBoardId: 0 })
})

test('placeNormalBox is blocked when the target cell holds the player', () => {
  const world = createEmptyWorld(6)
  const result = placeNormalBox(world, 'root', 5, 5, { nextBoxId: 0, nextBoardId: 0 })
  expect(result).toBeNull()
})

test('placeContainerBox creates a piece and a fresh interior board, and advances both counters', () => {
  const world = createEmptyWorld(6)
  const result = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  expect(result.world.pieces['box-0']).toEqual({ id: 'box-0', kind: 'container', boardRef: 'board-0' })
  expect(result.world.boards['board-0'].size).toBe(3)
  expect(result.ids).toEqual({ nextBoxId: 1, nextBoardId: 1 })
})

test('deletePieceRecursively removes a container, its board, and everything inside it', () => {
  let world = createEmptyWorld(6)
  const outer = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  world = outer.world
  const inner = placeNormalBox(world, 'board-0', 0, 0, outer.ids)!
  world = inner.world

  const next = deletePieceRecursively(world, 'box-0')

  expect(next.pieces['box-0']).toBeUndefined()
  expect(next.pieces['box-1']).toBeUndefined()
  expect(next.boards['board-0']).toBeUndefined()
  expect(Object.keys(next.boards)).toEqual(['root'])
})

test('movePlayer relocates the player and clears whatever piece was there, recursively', () => {
  let world = createEmptyWorld(6)
  const outer = placeContainerBox(world, 'root', 1, 1, { nextBoxId: 0, nextBoardId: 0 }, 3)!
  world = outer.world
  const inner = placeNormalBox(world, 'board-0', 0, 0, outer.ids)!
  world = inner.world

  const next = movePlayer(world, 'root', 1, 1)

  expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
  expect(next.pieces['box-0']).toBeUndefined()
  expect(next.pieces['box-1']).toBeUndefined()
  expect(next.boards['board-0']).toBeUndefined()
})
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/editor/worldEdit.test.ts`
Expected: FAIL — `Cannot find module './worldEdit'` (the module doesn't exist yet).

- [ ] **Step 3: Implement `worldEdit.ts`**

```ts
// src/editor/worldEdit.ts
import {
  Board,
  BoardId,
  Cell,
  CellType,
  Piece,
  PieceId,
  PLAYER_ID,
  Requirement,
  World,
  cloneWorld,
  occupantAt,
} from '../game/engine/types'

export function createEmptyBoard(id: BoardId, size: number): Board {
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'floor' as CellType })),
  )
  return { id, size, cells }
}

export function createEmptyWorld(rootSize: number): World {
  const root = createEmptyBoard('root', rootSize)
  return {
    boards: { root },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } },
    locations: { [PLAYER_ID]: { board: 'root', x: rootSize - 1, y: rootSize - 1 } },
  }
}

// Deletes a piece and, if it's a container, recursively deletes its owned
// board and every piece located on that board (and so on down). Without
// this, deleting a container that owns non-empty interiors would leave
// orphaned boards that fail levelSchema.ts's reachability/ownership checks.
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

export function setCellType(world: World, boardId: BoardId, x: number, y: number, type: CellType): World {
  const next = cloneWorld(world)
  next.boards[boardId].cells[y][x].type = type
  const occupantId = occupantAt(next, { board: boardId, x, y })
  if (occupantId && occupantId !== PLAYER_ID) return deletePieceRecursively(next, occupantId)
  return next
}

export function setRequirement(
  world: World,
  boardId: BoardId,
  x: number,
  y: number,
  requirement: Requirement,
): World {
  const next = cloneWorld(world)
  const cell = next.boards[boardId].cells[y][x]
  cell.requirement = cell.requirement === requirement ? undefined : requirement
  return next
}

export interface EditorIds {
  nextBoxId: number
  nextBoardId: number
}

function placePiece(world: World, boardId: BoardId, x: number, y: number, piece: Piece): World | null {
  const occupantId = occupantAt(world, { board: boardId, x, y })
  if (occupantId === PLAYER_ID) return null
  const next = occupantId ? deletePieceRecursively(world, occupantId) : cloneWorld(world)
  next.pieces[piece.id] = piece
  next.locations[piece.id] = { board: boardId, x, y }
  return next
}

export function placeNormalBox(
  world: World,
  boardId: BoardId,
  x: number,
  y: number,
  ids: EditorIds,
): { world: World; ids: EditorIds } | null {
  const id = `box-${ids.nextBoxId}`
  const placed = placePiece(world, boardId, x, y, { id, kind: 'normal' })
  if (!placed) return null
  return { world: placed, ids: { ...ids, nextBoxId: ids.nextBoxId + 1 } }
}

export function placeContainerBox(
  world: World,
  boardId: BoardId,
  x: number,
  y: number,
  ids: EditorIds,
  interiorSize: number,
): { world: World; ids: EditorIds } | null {
  const id = `box-${ids.nextBoxId}`
  const interiorId = `board-${ids.nextBoardId}`
  const placed = placePiece(world, boardId, x, y, { id, kind: 'container', boardRef: interiorId })
  if (!placed) return null
  placed.boards[interiorId] = createEmptyBoard(interiorId, interiorSize)
  return { world: placed, ids: { nextBoxId: ids.nextBoxId + 1, nextBoardId: ids.nextBoardId + 1 } }
}

export function movePlayer(world: World, boardId: BoardId, x: number, y: number): World {
  const occupantId = occupantAt(world, { board: boardId, x, y })
  const next = occupantId && occupantId !== PLAYER_ID ? deletePieceRecursively(world, occupantId) : cloneWorld(world)
  next.locations[PLAYER_ID] = { board: boardId, x, y }
  return next
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/editor/worldEdit.test.ts`
Expected: PASS — all 12 tests green.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json` — confirm no new errors from these two files (the pre-existing `EditorScreen.tsx`/`.test.tsx` errors are still expected at this point; Task 2 fixes those).

```bash
git add src/editor/worldEdit.ts src/editor/worldEdit.test.ts
git commit -m "feat(editor): add pure World-editing helpers"
```

---

### Task 2: Rewrite `EditorScreen.tsx` against the `World` model

**Files:**
- Modify: `src/editor/EditorScreen.tsx` (full rewrite)
- Modify: `src/editor/EditorScreen.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: everything from Task 1 (`worldEdit.ts`), plus `renderBoard` (`../game/render/CanvasRenderer`), `parseLevel`/`serializeLevel` (`../game/engine/levelSchema`), `saveCustomLevel` (`../storage/progress`), and `BoardId, PieceId, PieceKind, World, occupantAt` from `../game/engine/types`.
- Produces: `export function EditorScreen({ onBack }: { onBack: () => void }): JSX.Element` — same public signature as before, still consumed by `App.tsx` (Task 4).

- [ ] **Step 1: Write the failing test file**

```tsx
// src/editor/EditorScreen.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorScreen } from './EditorScreen'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({ left: 0, top: 0 }) as unknown as typeof HTMLCanvasElement.prototype.getBoundingClientRect
})

const waitPastClickWindow = () => act(() => new Promise((resolve) => setTimeout(resolve, 260)))
const waitLongerThanAnyDebounceWindow = () => act(() => new Promise((resolve) => setTimeout(resolve, 500)))

test('selecting the wall tool then clicking the canvas places a wall cell', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('墙'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 32 + 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('cell-type-1-0')).toHaveTextContent('wall')
})

test('selecting the container box tool then clicking places a container box', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('box-at-0-0')).toHaveTextContent('container')
  expect(screen.getByTestId('board-ids')).toHaveTextContent('board-0,root')
})

test('double-clicking a container box enters its interior, breadcrumb shows the path', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByText('外层 > box-0')).toBeInTheDocument()
})

test('double-clicking with a different tool selected still enters the box instead of destroying it', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitLongerThanAnyDebounceWindow()
  await user.click(screen.getByLabelText('墙'))
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByText('外层 > box-0')).toBeInTheDocument()
})

test('clicking the breadcrumb root returns to the outer grid', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })
  await user.click(screen.getByText('外层'))
  expect(screen.queryByText(/外层 > /)).not.toBeInTheDocument()
})

test('clicking two different cells in quick succession places on both, not just the second', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('墙'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  fireEvent.click(canvas, { clientX: 32 + 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('cell-type-0-0')).toHaveTextContent('wall')
  expect(screen.getByTestId('cell-type-1-0')).toHaveTextContent('wall')
})

test('the first box placed on a fresh mount gets id box-0', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('普通箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('box-id-at-0-0')).toHaveTextContent('box-0')
})

test('the player tool moves the single player piece instead of creating a new one', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('玩家起点'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('box-id-at-0-0')).toHaveTextContent('player')
  expect(screen.getByTestId('piece-ids')).toHaveTextContent('player')
})

test('the goal-box tool paints a requirement on the cell and toggles it off on a second click', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('目标(箱)'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('cell-requirement-0-0')).toHaveTextContent('box')

  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('cell-requirement-0-0')).toHaveTextContent('none')
})

test('painting a box-goal on an empty cell does not create a box, and the level does not start won', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('目标(箱)'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.queryByTestId('box-at-0-0')).not.toBeInTheDocument()

  const { parseLevel } = await import('../game/engine/levelSchema')
  const { checkWin } = await import('../game/engine/rules')

  localStorage.clear()
  await user.type(screen.getByLabelText('关卡名称'), 'goal-level')
  await user.click(screen.getByText('储存'))
  const { listCustomLevels } = await import('../storage/progress')
  const world = parseLevel(JSON.parse(listCustomLevels().find((l) => l.id === 'goal-level')!.json))
  expect(checkWin(world)).toBe(false)
})

test('deleting a container box recursively deletes its interior board and everything inside it', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  fireEvent.dblClick(canvas, { clientX: 5, clientY: 5 })

  await user.click(screen.getByLabelText('普通箱'))
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()
  expect(screen.getByTestId('piece-ids')).toHaveTextContent('box-1')

  await user.click(screen.getByText('外层'))
  await user.click(screen.getByLabelText('墙'))
  fireEvent.click(canvas, { clientX: 5, clientY: 5 })
  await waitPastClickWindow()

  expect(screen.getByTestId('board-ids')).toHaveTextContent('root')
  expect(screen.getByTestId('board-ids')).not.toHaveTextContent('board-0')
  expect(screen.getByTestId('piece-ids')).not.toHaveTextContent('box-0')
  expect(screen.getByTestId('piece-ids')).not.toHaveTextContent('box-1')
})

test('clicking save stores the level in localStorage', async () => {
  localStorage.clear()
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('关卡名称'), 'my-level')
  await user.click(screen.getByText('储存'))
  const { listCustomLevels } = await import('../storage/progress')
  expect(listCustomLevels().map((l) => l.id)).toEqual(['my-level'])
})
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: FAIL — the existing `EditorScreen.tsx` doesn't export a component matching this test's expectations (and currently fails to even compile, per the known pre-existing `tsc` errors).

- [ ] **Step 3: Implement `EditorScreen.tsx`**

```tsx
// src/editor/EditorScreen.tsx
import { useEffect, useRef, useState } from 'react'
import { BoardId, PieceId, PieceKind, World, occupantAt } from '../game/engine/types'
import { parseLevel, serializeLevel } from '../game/engine/levelSchema'
import { renderBoard } from '../game/render/CanvasRenderer'
import { saveCustomLevel } from '../storage/progress'
import {
  EditorIds,
  createEmptyWorld,
  movePlayer,
  placeContainerBox,
  placeNormalBox,
  setCellType,
  setRequirement,
} from './worldEdit'

const CELL_SIZE = 32
// A double-click always dispatches `click`, `click`, `dblclick` in that order. To
// tell a genuine single click apart from the first click of a double-click, every
// click's placement is delayed behind a short timer; the double-click handler
// cancels that pending timer before it ever fires, so placeAt runs at most once
// per gesture and never runs at all for a double-click.
const DOUBLE_CLICK_WINDOW_MS = 250
const DEFAULT_ROOT_SIZE = 6
const DEFAULT_INTERIOR_SIZE = 3

type Tool = 'wall' | 'empty' | 'normal-box' | 'container-box' | 'player' | 'goal-box' | 'goal-player'

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'empty', label: '空地' },
  { tool: 'wall', label: '墙' },
  { tool: 'normal-box', label: '普通箱' },
  { tool: 'container-box', label: '容器箱' },
  { tool: 'goal-box', label: '目标(箱)' },
  { tool: 'goal-player', label: '目标(玩家)' },
  { tool: 'player', label: '玩家起点' },
]

export function EditorScreen({ onBack }: { onBack: () => void }) {
  const [world, setWorld] = useState<World>(() => createEmptyWorld(DEFAULT_ROOT_SIZE))
  // Path of container piece ids entered via double-click; the active board is
  // derived from the last entry's boardRef (or 'root' if empty), so there is
  // only one source of truth for "where am I" instead of tracking board ids
  // separately from the pieces that own them.
  const [path, setPath] = useState<PieceId[]>([])
  const [tool, setTool] = useState<Tool>('wall')
  const [levelName, setLevelName] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const idsRef = useRef<EditorIds>({ nextBoxId: 0, nextBoardId: 0 })
  const pendingPlaceRef = useRef<{ x: number; y: number; timer: number } | null>(null)

  const activeBoardId: BoardId =
    path.length === 0 ? 'root' : (world.pieces[path[path.length - 1]].boardRef as BoardId)
  const activeBoard = world.boards[activeBoardId]

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderBoard(ctx, activeBoard, world, CELL_SIZE)
  }, [world, activeBoard])

  useEffect(() => {
    return () => {
      if (pendingPlaceRef.current) window.clearTimeout(pendingPlaceRef.current.timer)
    }
  }, [])

  const placeAt = (x: number, y: number) => {
    if (tool === 'wall' || tool === 'empty') {
      setWorld(setCellType(world, activeBoardId, x, y, tool === 'wall' ? 'wall' : 'floor'))
      return
    }
    if (tool === 'goal-box' || tool === 'goal-player') {
      if (activeBoard.cells[y][x].type === 'wall') return
      setWorld(setRequirement(world, activeBoardId, x, y, tool === 'goal-box' ? 'box' : 'player'))
      return
    }
    if (tool === 'player') {
      setWorld(movePlayer(world, activeBoardId, x, y))
      return
    }
    // normal-box / container-box: re-placing the same kind on a cell that
    // already holds it is a no-op, so a double-click's first click can't
    // destroy-and-recreate a box right before the double-click handler
    // enters it.
    const desiredKind: PieceKind = tool === 'container-box' ? 'container' : 'normal'
    const existingId = occupantAt(world, { board: activeBoardId, x, y })
    if (existingId && world.pieces[existingId].kind === desiredKind) return

    // The id is allocated here, in the plain event-handler body, rather than
    // inside a setState updater: React 18 StrictMode double-invokes updater
    // functions in dev to surface impurity, which would burn two ids per click.
    const result =
      tool === 'container-box'
        ? placeContainerBox(world, activeBoardId, x, y, idsRef.current, DEFAULT_INTERIOR_SIZE)
        : placeNormalBox(world, activeBoardId, x, y, idsRef.current)
    if (!result) return
    idsRef.current = result.ids
    setWorld(result.world)
  }

  const cellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.floor((e.clientX - rect.left) / CELL_SIZE),
      y: Math.floor((e.clientY - rect.top) / CELL_SIZE),
    }
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = cellFromEvent(e)
    if (x < 0 || y < 0 || x >= activeBoard.size || y >= activeBoard.size) return
    const pending = pendingPlaceRef.current
    if (pending) {
      window.clearTimeout(pending.timer)
      if (pending.x !== x || pending.y !== y) placeAt(pending.x, pending.y)
    }
    pendingPlaceRef.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        pendingPlaceRef.current = null
        placeAt(x, y)
      }, DOUBLE_CLICK_WINDOW_MS),
    }
  }

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (pendingPlaceRef.current) {
      window.clearTimeout(pendingPlaceRef.current.timer)
      pendingPlaceRef.current = null
    }
    const { x, y } = cellFromEvent(e)
    const pieceId = occupantAt(world, { board: activeBoardId, x, y })
    const piece = pieceId ? world.pieces[pieceId] : undefined
    if (piece?.kind === 'container' && piece.boardRef !== undefined) {
      setPath((p) => [...p, piece.id])
    }
  }

  const breadcrumb = ['外层', ...path]

  const handleSave = () => {
    if (!levelName) return
    try {
      const serialized = serializeLevel(world)
      parseLevel(serialized) // defensive: catch an invalid world before it's persisted
      saveCustomLevel(levelName, JSON.stringify(serialized))
      setSaveError(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(serializeLevel(world))], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${levelName || 'level'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="editor-screen">
      <button onClick={onBack}>返回</button>
      <div className="breadcrumb">
        {breadcrumb.map((_, i) => (
          <button key={i} onClick={() => setPath(path.slice(0, i))}>
            {breadcrumb.slice(0, i + 1).join(' > ')}
          </button>
        ))}
      </div>
      <div className="tool-palette">
        {TOOLS.map(({ tool: t, label }) => (
          <button key={t} aria-label={label} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {label}
          </button>
        ))}
      </div>
      <canvas
        data-testid="editor-canvas"
        ref={canvasRef}
        width={CELL_SIZE * activeBoard.size}
        height={CELL_SIZE * activeBoard.size}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
      />
      <label>
        关卡名称
        <input aria-label="关卡名称" value={levelName} onChange={(e) => setLevelName(e.target.value)} />
      </label>
      <button onClick={handleSave}>储存</button>
      {saveError && <p role="alert">{saveError}</p>}
      <button onClick={handleExport}>汇出 JSON</button>
      <div style={{ display: 'none' }}>
        {activeBoard.cells.map((row, y) =>
          row.map((cell, x) => (
            <span key={`type-${x}-${y}`} data-testid={`cell-type-${x}-${y}`}>
              {cell.type}
            </span>
          )),
        )}
        {activeBoard.cells.map((row, y) =>
          row.map((cell, x) => (
            <span key={`req-${x}-${y}`} data-testid={`cell-requirement-${x}-${y}`}>
              {cell.requirement ?? 'none'}
            </span>
          )),
        )}
        {Object.entries(world.locations)
          .filter(([, loc]) => loc.board === activeBoardId)
          .map(([pieceId, loc]) => (
            <span key={`piece-${pieceId}`} data-testid={`box-at-${loc.x}-${loc.y}`}>
              {world.pieces[pieceId].kind}
            </span>
          ))}
        {Object.entries(world.locations)
          .filter(([, loc]) => loc.board === activeBoardId)
          .map(([pieceId, loc]) => (
            <span key={`piece-id-${pieceId}`} data-testid={`box-id-at-${loc.x}-${loc.y}`}>
              {pieceId}
            </span>
          ))}
        <span data-testid="board-ids">{Object.keys(world.boards).sort().join(',')}</span>
        <span data-testid="piece-ids">{Object.keys(world.pieces).sort().join(',')}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json` — expect zero errors under `src/editor/`.

```bash
git add src/editor/EditorScreen.tsx src/editor/EditorScreen.test.tsx
git commit -m "feat(editor): rebuild EditorScreen against the World engine model"
```

---

### Task 3: Un-stub `loadCustomLevels()`

**Files:**
- Modify: `src/levels/index.ts`
- Modify: `src/levels/index.test.ts`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `listCustomLevels` (`../storage/progress`, already exists — `CustomLevelEntry { id: string; json: string }`), `parseLevel` (`../game/engine/levelSchema`), `CUSTOM_LEVEL_ID_PREFIX` (already declared in this same file).
- Produces: `loadCustomLevels(): LevelMeta[]` — same exported signature as the current stub, now returning real entries.

- [ ] **Step 1: Write the failing tests**

Replace the existing `describe('loadCustomLevels', ...)` block in `src/levels/index.test.ts` (currently asserting the stub returns `[]`) with:

```ts
describe('loadCustomLevels', () => {
  it('parses saved custom levels, prefixing the id and keeping the saved name', async () => {
    localStorage.clear()
    const { saveCustomLevel } = await import('../storage/progress')
    const json = JSON.stringify({
      boards: { root: { id: 'root', size: 1, cells: [[{ type: 'floor' }]] } },
      pieces: { player: { id: 'player', kind: 'player' } },
      locations: { player: { board: 'root', x: 0, y: 0 } },
    })
    saveCustomLevel('my-level', json)

    const levels = loadCustomLevels()
    expect(levels).toHaveLength(1)
    expect(levels[0].id).toBe(`${CUSTOM_LEVEL_ID_PREFIX}my-level`)
    expect(levels[0].name).toBe('my-level')
    expect(checkWin(levels[0].world)).toBe(false)
  })

  it('skips a corrupt saved level instead of throwing', async () => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { saveCustomLevel } = await import('../storage/progress')
    saveCustomLevel('broken', 'not valid json')
    expect(loadCustomLevels()).toEqual([])
  })

  it('returns an empty array when nothing has been saved', () => {
    localStorage.clear()
    expect(loadCustomLevels()).toEqual([])
  })
})
```

Also add, to `src/App.test.tsx`, replacing the existing `'a saved custom level does not appear yet (loading is deferred to a future sub-project)'` test:

```ts
test('a saved custom level appears in level select', async () => {
  const { saveCustomLevel } = await import('./storage/progress')
  const json = JSON.stringify({
    boards: { root: { id: 'root', size: 1, cells: [[{ type: 'floor' }]] } },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 0, y: 0 } },
  })
  saveCustomLevel('我的关卡', json)
  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.getByText('我的关卡')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run both test files and confirm they fail**

Run: `npx vitest run src/levels/index.test.ts src/App.test.tsx`
Expected: FAIL — `loadCustomLevels()` still returns `[]` unconditionally.

- [ ] **Step 3: Implement the un-stub**

In `src/levels/index.ts`, add the import and replace the stubbed function body:

```ts
import { listCustomLevels } from '../storage/progress'
```

```ts
// Sub-project 3's editor now produces valid World-format saves, so this can
// load them for real. One corrupt entry (hand-edited localStorage, a save
// from an even older format) must not white-screen the app, which calls
// this during render — mirrors storage/progress.ts's readJson guard.
export function loadCustomLevels(): LevelMeta[] {
  const levels: LevelMeta[] = []
  for (const entry of listCustomLevels()) {
    try {
      const world = parseLevel(JSON.parse(entry.json))
      levels.push({ id: `${CUSTOM_LEVEL_ID_PREFIX}${entry.id}`, name: entry.id, world })
    } catch (error) {
      console.warn(`Ignoring corrupt custom level "${entry.id}":`, error)
    }
  }
  return levels
}
```

(Remove the now-resolved "Sub-project 3 rebuilds..." comment that previously sat above the stub.)

- [ ] **Step 4: Run both test files and confirm they pass**

Run: `npx vitest run src/levels/index.test.ts src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`

```bash
git add src/levels/index.ts src/levels/index.test.ts src/App.test.tsx
git commit -m "feat(levels): load real custom levels saved by the rebuilt editor"
```

---

### Task 4: `App.tsx` — un-lazy the editor, drop the error boundary

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `EditorScreen` (`./editor/EditorScreen`, Task 2's rebuilt component).
- No new exports — `App.tsx`'s default export signature is unchanged.

- [ ] **Step 1: Write the failing test**

Replace the existing `'the broken editor screen fails gracefully instead of crashing the whole app'` test in `src/App.test.tsx` with:

```ts
test('the level editor screen loads and shows its tool palette', async () => {
  render(<App />)
  await userEvent.setup().click(screen.getByText('关卡编辑器'))
  expect(await screen.findByLabelText('墙')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test and check its starting state**

Run: `npx vitest run src/App.test.tsx`
Expected: this test can already PASS at this point — Task 2 made `EditorScreen` genuinely work, and the current `App.tsx` still lazy-loads it successfully (`Suspense` just resolves once the dynamic import succeeds). That's expected, not a problem: this task isn't adding new user-visible behavior, it's removing now-unnecessary complexity (the lazy-load + error boundary that existed only to contain the old, broken editor). Step 3 makes the simplification; Step 4 re-confirms the whole suite, including this test, still passes afterward.

- [ ] **Step 3: Simplify `App.tsx`**

Replace the whole file:

```tsx
// src/App.tsx
import { useState } from 'react'
import { MenuScreen } from './ui/MenuScreen'
import { LevelSelect } from './ui/LevelSelect'
import { GameScreen } from './game/GameScreen'
import { EditorScreen } from './editor/EditorScreen'
import { BUILTIN_LEVELS, loadCustomLevels, loadGeneratedLevels, LevelMeta } from './levels'
import { isLevelComplete, listCompletedLevels, markLevelComplete } from './storage/progress'

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
        key={activeLevel.id}
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
    return <EditorScreen onBack={() => setScreen('menu')} />
  }

  return null
}
```

- [ ] **Step 4: Run the full test suite and confirm it passes**

Run: `npx vitest run`
Expected: PASS — every test file, including `App.test.tsx`, `EditorScreen.test.tsx`, and `worldEdit.test.ts`.

- [ ] **Step 5: Full typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: zero errors across the whole project (this is the point at which the editor's pre-existing, previously-excused `tsc` failures are fully resolved).

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): stop lazy-loading the editor now that it compiles and works"
```
