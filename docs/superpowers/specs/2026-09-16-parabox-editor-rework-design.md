# Parabox PWA — Editor Rework (Sub-project 3)

## Background

Sub-project 1 (`2026-09-04-parabox-official-engine-design.md`) replaced the game's core
mechanic with a flat multi-board `World` model (`src/game/engine/types.ts`,
`rules.ts`, `levelSchema.ts`). Sub-project 2 (`2026-09-04-parabox-renderer-controls-design.md`)
made the game itself playable against that model, but deliberately left `EditorScreen.tsx`
untouched — it still imports `Grid`/`Box`/`cloneGrid`/`createEmptyGrid` from
`../game/engine/types` and `renderGrid` from `../game/render/CanvasRenderer`, none of
which exist anymore. `npx tsc --noEmit` currently fails on this file and its test file.
`App.tsx` already lazy-loads it behind an error boundary specifically so this doesn't
crash the rest of the app, with a comment noting "sub-project 3 rebuilds it."

This spec is that sub-project: rebuild the editor against the current `World` model so
it is a normal, working, `tsc`-clean part of the app again.

This work is a prerequisite for a follow-up feature (a self-referencing "loop" container
box, i.e. a box whose interior contains a copy of itself — the classic Parabox trick).
That feature is **out of scope for this spec** and will be designed and specified
separately once the editor is working; nothing here should be built specifically to
anticipate it beyond not making it structurally harder.

## Scope

**In scope:**
- Rewrite `src/editor/EditorScreen.tsx` against `World`/`Board`/`Piece` (`src/game/engine/types.ts`)
- Reuse `renderBoard` (already built for `World`, `src/game/render/CanvasRenderer.ts`) for the canvas
- Rewrite `src/editor/EditorScreen.test.tsx` against the new behavior
- Replace the old `target` cell-tool + per-box `isGoalBox` flag with the new engine's
  single concept (`cell.requirement: 'box' | 'player'`), as two floor-painting tools
- Recursive cleanup when a container box is deleted or overwritten (its owned board,
  and everything transitively inside it, must be removed too)
- Un-lazy `EditorScreen` in `App.tsx` and drop the now-unneeded `EditorErrorBoundary`
  once the editor compiles and works (confirm via the existing `App.test.tsx` coverage
  of the error-boundary path — that test is removed/replaced, not left describing dead
  code)

**Explicitly out of scope:**
- Self-referencing / loop container boxes (separate future spec)
- Any change to `levelSchema.ts` validation rules
- Any change to `rules.ts`, `solver.ts`, or the generator
- Level migration for old custom levels saved by the pre-rewrite editor (they are in
  the old incompatible format and are not readable by `parseLevel`; per sub-project 2's
  spec, `loadCustomLevels()` currently stubs to `[]` — this spec does not change that
  stub or attempt to migrate old saves)
- Any visual/UX redesign beyond what's needed to fit the new tool set (goal tools)

## Data model & state

`EditorScreen` holds a `World` in React state instead of a `Grid`. Because `World` is
flat (boards/pieces/locations keyed by id, not nested), editing is simpler than the old
tree-walk: every edit is "clone the whole world (`cloneWorld`), mutate the clone's
`boards`/`pieces`/`locations` records directly, set state" — no more recursive
`getGridAtPath`/`setGridAtPath`.

Navigation ("which board am I looking at") becomes a stack of board ids instead of a
stack of `{boxId}` entries:

```ts
const [boardPath, setBoardPath] = useState<BoardId[]>(['root'])
const activeBoardId = boardPath[boardPath.length - 1]
const activeBoard = world.boards[activeBoardId]
```

Double-clicking a container box pushes `piece.boardRef` onto `boardPath`. Clicking a
breadcrumb entry truncates `boardPath` back to that index. This mirrors the existing
double-click/breadcrumb UX exactly — only the underlying lookup changes.

Two monotonic id counters persist across edits within a session, same pattern as
today: `box-N` for new pieces, `board-N` for new boards (allocated only when placing a
new container box). `'root'` and `PLAYER_ID` (`'player'`) stay reserved, matching
`levelSchema.ts`'s hard requirements (exactly one player piece keyed `'player'`, exactly
one unowned root board).

## Tool mapping

| Old tool | New behavior |
|---|---|
| `wall` / `empty` | Same — sets `activeBoard.cells[y][x].type` |
| `normal-box` | Places a `kind: 'normal'` piece at `(x, y)` on `activeBoardId` |
| `container-box` | Places a `kind: 'container'` piece at `(x, y)`; allocates a fresh `board-N` (default 3x3, all floor) and sets `boardRef` to it |
| `player` | Moves/creates the single `PLAYER_ID` piece's location to `(x, y)` on `activeBoardId` (never allocates a new id) |
| `target` + `toggle-goal` (removed) | Two new tools, **`goal-box`** and **`goal-player`**, each painting `cells[y][x].requirement` on the active board directly (not on a piece). Painting the same requirement again clears it (toggle); painting the other requirement overwrites it. Painting a requirement onto a `wall` cell is rejected client-side (mirrors `levelSchema.ts`'s own rule that a requirement can never be satisfied on a wall) |

The double-click-vs-single-click placement debounce (`DOUBLE_CLICK_WINDOW_MS`) and the
"editing a box in place doesn't destroy its id/interior" behavior (for the old
`toggle-goal` tool) carry over unchanged in spirit; the equivalent case under the new
tools is "painting a wall/box/player onto a cell that already holds a different piece
replaces that piece" (same as today), while painting a goal tool never touches
`pieces`/`locations` at all, so there is no analogous destroy-and-recreate risk to guard
against there anymore.

## Deletion & cleanup

Overwriting a cell that currently holds a `container` piece (placing a wall, a
different piece, or player there) must delete not just that piece but everything it
owns, recursively: its `boardRef` board, every piece located on that board, and (by
induction) their owned boards in turn. Without this, the orphaned board(s) would fail
`levelSchema.ts`'s reachability/ownership checks on save (`Board(s) not reachable from
the root board`) or just leak unreachable data.

```ts
function deletePieceRecursively(world: World, pieceId: PieceId): void {
  const piece = world.pieces[pieceId]
  if (piece.kind === 'container' && piece.boardRef !== undefined) {
    const boardId = piece.boardRef
    for (const [otherId, loc] of Object.entries(world.locations)) {
      if (loc.board === boardId) deletePieceRecursively(world, otherId)
    }
    delete world.boards[boardId]
  }
  delete world.pieces[pieceId]
  delete world.locations[pieceId]
}
```

The player piece is never subject to this (placing a wall/box over the player's current
cell moves the player rather than deleting it — same "exactly one player always exists"
invariant as today's implicit behavior via the reserved `PLAYER_ID`).

If the player is currently viewing (via `boardPath`) a board that gets deleted this way
(e.g. they delete an ancestor container of the board they're standing in from a
breadcrumb click first, then... — actually not reachable in one step since you can only
delete on `activeBoard`, never delete an ancestor of where you're currently looking from
inside it), `boardPath` cannot end up pointing at a deleted board: deletion only ever
targets a piece cell on the *current* board, and a container being deleted is always a
descendant of (or unrelated to) `activeBoardId`, never an ancestor of it. No special
handling needed.

## Save / export

Unchanged: `serializeLevel(world)` (already `World`-shaped, just `structuredClone`) and
`saveCustomLevel`/`listCustomLevels` (id + JSON string, model-agnostic) need no changes.
The save button should reject (or just no-op, matching today's `if (!levelName) return`)
without a name, same as today.

One behavior worth adding: since `parseLevel` will now throw on an invalid world (e.g.
exactly-one-player violated — can't actually happen given the tool constraints above, so
this is a defensive check, not a reachable UI state) — wrap the save path so a thrown
validation error surfaces as a visible message rather than silently failing, per this
codebase's existing pattern of never letting a caught error vanish silently
(`storage/progress.ts`'s own comments on this).

## Testing

`EditorScreen.test.tsx` is rewritten test-by-test against the same *intent* as today's
suite (tool placement, double-click navigation, breadcrumb, debounce behavior, goal
toggling, save-then-reload-through-`parseLevel`), reading results through `World`/
`parseLevel`/`checkWin` instead of `Grid`. The "double-click doesn't destroy the box"
regression test carries over as-is (still applies: placing the same tool twice on an
already-correct cell must no-op, exactly like today's `existing.boxType === desiredType`
early return). A new test covers recursive deletion (place a container with a box in its
interior, then delete the outer container from the root view, then confirm the
interior's board is no longer present in the saved JSON).

`App.tsx`'s lazy-load + `EditorErrorBoundary` are removed once this lands, with
`App.test.tsx`'s existing "broken editor screen fails gracefully" test removed (it
describes behavior that no longer exists) and replaced with a plain "editor screen
loads and is usable" smoke test.
