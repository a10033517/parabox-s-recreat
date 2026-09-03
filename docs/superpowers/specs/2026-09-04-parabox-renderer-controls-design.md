# Parabox PWA — Renderer & Controls Update (Sub-project 2)

## Background

Sub-project 1 (see `2026-09-04-parabox-official-engine-design.md`) replaced the game's
core mechanic with a flat multi-board `World` model and shipped a fully tested engine
(`applyMove`, `checkWin`, `GameState`, `levelSchema`) under `src/game/engine/`. It
deliberately left the renderer, `GameScreen`, controls, `App.tsx`, and level loading
untouched — those files still reference the old retired `Grid`/`Box` tree model and
currently fail to compile.

This sub-project makes the game playable again against the new engine, and — for the
first time — actually renders the new "player enters a box" mechanic, which the old
renderer never had (the old MVP never let the player enter boxes at all).

This is the second of five planned sub-projects:

1. Core engine rewrite (shipped — `master@53aa0b1`)
2. **Renderer + controls update** (this spec)
3. Editor rework
4. Solver + level generator rewrite
5. Old-level migration/regeneration

## Scope

**In scope:**
- `CanvasRenderer.ts` — rewritten to render one `Board` at a time (no recursion)
- `GameScreen.tsx` — rewritten against the new `GameState` class, including the
  camera-switch behavior when the player's board changes
- A small, additive `moveCount` getter on the already-shipped `GameState.ts`
- Minimal fixes to `App.tsx` and `src/levels/index.ts` so the game is actually
  runnable end-to-end in a browser (not just unit-testable)
- Two new hand-written `World`-shaped level fixtures, replacing the old
  incompatible builtin level JSON
- `DPad.tsx` / `SwipeLayer.tsx` — verified against the new `Direction` type (expected
  to need zero code changes, since they only ever consumed that type)

**Explicitly out of scope:**
- Any transition animation on board switch (hard cut only)
- Breadcrumb or "where am I" navigation UI
- The editor (`EditorScreen.tsx`) — sub-project 3
- The solver/generator (`tools/generator/*`) — sub-project 4
- A redesigned JSON-file-based level-authoring pipeline, or migrating/regenerating the
  full old level pack — sub-project 5. The two levels this sub-project adds are just
  enough hand-written fixtures to exercise push, enter, and win end-to-end; they are not
  a level pack.
- `loadGeneratedLevels()`/`loadCustomLevels()` producing anything real — both are stubbed
  to return `[]` for now (see "Level loading" below), since generated levels need
  sub-project 4's rebuilt generator and custom levels need sub-project 3's rebuilt editor,
  and both currently only exist in the old incompatible JSON format anyway.

## Architecture: render one board, camera-cut on switch

The old renderer recursively drew a box's entire interior, shrunk, inside the box's own
cell — because the old `Grid`/`Box` model nested Grids as literal objects. The new
`World` model is flat: a `Board` is just `{id, size, cells}`, and "what a piece contains"
is a separate lookup (`Piece.boardRef`), not an embedded structure. There is nothing to
recurse into. Rendering only ever needs to draw **the one board the player is currently
on**, which is directly available as `world.locations[PLAYER_ID].board`.

```ts
// src/game/render/CanvasRenderer.ts
import { Board, Piece, PieceId, World } from '../engine/types'

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  world: World,
  cellSize: number,
): void
```

`renderBoard` draws, for a single `board`:
1. Every cell: `wall` vs `floor` base color; if `cell.requirement` is set, an overlay
   distinguishing `'box'` from `'player'` requirements.
2. Every piece whose `world.locations[pieceId].board === board.id`: the player, `normal`
   boxes, and `container` boxes (a distinct fill color per kind, same two-color scheme
   the old renderer used — no nested drawing for containers, since there's nothing to
   recurse into anymore).

`GameScreen` determines which board to render each frame by reading the player's
current location off `GameState.current`, and re-renders whenever it changes — including
resizing the `<canvas>` to the new board's `size`, since different boards can be
different sizes. There is no transition animation: switching boards is a hard cut,
matching the "keep it simple" call on navigation UI.

## `GameScreen` state management

The old `GameScreen` treated `GameState` as an immutable value threaded through React
state (`setState((s) => move(s, direction))`). The new `GameState` class is inherently
mutable — `.move()`/`.undo()` mutate its internal history in place and return only a
boolean success flag, not a new instance. Fighting that with clones would be needless
work. Instead:

```ts
const stateRef = useRef<GameState>()
if (!stateRef.current) stateRef.current = new GameState(initialWorld)
const [tick, setTick] = useState(0)

const handleMove = (direction: Direction) => {
  if (stateRef.current!.move(direction)) setTick((t) => t + 1)
}
```

`tick` exists purely to force a re-render after a successful mutation; nothing reads its
value. `stateRef.current!.current` (the live `World`) and `.isWon`/`.moveCount` are read
fresh on every render.

## `GameState.moveCount` (small addition to already-shipped code)

The HUD shows a step counter. The shipped `GameState` class has no way to read history
length. Adding one trivial, purely additive getter:

```ts
// src/game/engine/GameState.ts — add alongside the existing getters
get moveCount(): number {
  return this.history.length - 1
}
```

No existing behavior changes; this is the only touch to a sub-project-1-owned file.

## Level loading (minimal fix, not a redesign)

`levelSchema.ts`'s `parseLevel(data: unknown): World` takes a parsed value now, not a
raw JSON string (the old `levels/index.ts` called `parseLevel(rawString)` directly,
matching the old engine's now-gone string-parsing signature) — every call site needs
`JSON.parse(raw)` first. `LevelMeta.grid: Grid` becomes `LevelMeta.world: World`.

```ts
// src/levels/index.ts
import { parseLevel } from '../game/engine/levelSchema'
import { World } from '../game/engine/types'
import level01 from './builtin/01-first-push.json?raw'
import level02 from './builtin/02-enter-container.json?raw'

export interface LevelMeta {
  id: string
  name: string
  world: World
}

export const BUILTIN_LEVELS: LevelMeta[] = [
  { id: '01-first-push', name: '第一次推動', world: parseLevel(JSON.parse(level01)) },
  { id: '02-enter-container', name: '進入箱子', world: parseLevel(JSON.parse(level02)) },
]

export function loadGeneratedLevels(): LevelMeta[] {
  return [] // sub-project 4 rebuilds the generator; nothing in the new format exists yet
}

export const CUSTOM_LEVEL_ID_PREFIX = 'custom:'

export function loadCustomLevels(): LevelMeta[] {
  return [] // sub-project 3 rebuilds the editor; old custom levels are old-format
}
```

The three old builtin JSON files (`01-first-push.json`, `02-single-nest.json`,
`03-chain-nest.json`) and the `builtin/generated/` directory are deleted — they're in the
old, incompatible format, nothing will load them once `levels/index.ts` is rewritten, and
leaving them around as dead data was already flagged as an unaddressed gap from
sub-project 1's final review. Two new files replace them:

**`01-first-push.json`** — a 3×3 open board, no containers. Player at `(0,1)`, a
`normal` box at `(1,1)`, a `box`-requirement cell at `(2,1)`. One push (`right`) wins.
Exercises: basic push, `checkWin`, win detection, no camera switch.

**`02-enter-container.json`** — `root` (3×3) containing a `container` piece at `(1,1)`
whose interior is `inside` (3×3, all floor, `player`-requirement at `(2,1)`), with a
**wall at `root(2,1)`** — directly behind the container in the push direction. That wall
is load-bearing for the level's design, not decoration: the algorithm always tries
`push` before `enter`, so without something blocking the container from simply sliding
over, the player would push it instead of ever entering it. With the wall there, `push`
fails (nowhere for the container to go), so `resolveBlocked` falls through to `enter`.
Player starts at `root(0,1)`. Moving `right` walks the player into the container
(landing at `inside(0,1)`, per `getEntryCell`'s center-of-edge rule), then two more
`right` presses reach the win cell. Exercises: entry via a blocked push (camera switch
fires), multi-step movement inside a nested board, `player`-kind requirement.

Both files follow `levelSchema.ts`'s exact JSON shape (`{boards, pieces, locations}`,
`Cell = {type, requirement?}`, `Board = {id, size, cells}`) — the same shape
`serializeLevel`/`parseLevel` round-trip in sub-project 1's tests, just written by hand.

`App.tsx` changes to match: `initialGrid={cloneGrid(activeLevel.grid)}` becomes
`initialWorld={activeLevel.world}` (no clone needed — `GameState`'s constructor already
never mutates what it's given; only `applyMove`'s cloned results ever get pushed onto its
history). `GameScreen`'s prop is renamed `initialGrid` → `initialWorld` to match.

## Testing strategy

- `CanvasRenderer.test.ts`: rewritten against `renderBoard` using a mock 2D context
  (same mocking pattern the old test file used) and hand-built `World` fixtures via
  `testFixtures.ts` — verify wall vs floor fill calls, a requirement-cell overlay call,
  and one call per piece located on the rendered board (including that a piece on a
  *different* board is NOT drawn).
- `GameScreen.test.tsx`: rewritten against the new state-management pattern — a push
  updates the rendered board, entering a container swaps which board is rendered (canvas
  resizes to the new board's `size`), undo reverts, win fires `onWin` once.
- Manual verification: both new builtin levels playable start-to-finish in the actual
  browser (`npm run dev`) — this is the acceptance bar for "the game runs again," which
  no automated test alone can confirm for a canvas-rendered, touch-controlled PWA.

## Migration note

Files rewritten, not patched: `src/game/render/CanvasRenderer.ts`,
`src/game/GameScreen.tsx`, `src/game/render/CanvasRenderer.test.ts`,
`src/game/GameScreen.test.tsx`. Files minimally edited: `src/App.tsx`,
`src/levels/index.ts`, `src/game/engine/GameState.ts` (one additive getter). Files
expected to need zero changes (verify, don't rewrite): `src/ui/DPad.tsx`,
`src/ui/SwipeLayer.tsx`. Files deleted:
`src/levels/builtin/{01-first-push,02-single-nest,03-chain-nest}.json`,
`src/levels/builtin/generated/` (contents). Files created:
`src/levels/builtin/{01-first-push,02-enter-container}.json`. `src/editor/EditorScreen.tsx`
and `tools/generator/*` remain untouched and non-compiling — sub-projects 3 and 4's job.
