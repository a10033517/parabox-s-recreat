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
  // Official Custom Levels fields, stored RAW and given no gameplay meaning yet (their
  // matching / camera semantics are unverified — see docs/engine-official-audit.md):
  zoomFactor?: number      // `zoomfactor`: camera zoom while inside this block (render only)
  floatInSpace?: boolean   // `floatinspace`: block has no outer level (spaceMode "floating")
  color?: string           // #rrggbb, from the official block's hue/sat/val (render only)
}

export type PieceKind = 'player' | 'normal' | 'container'

export interface Piece {
  id: PieceId
  kind: PieceKind
  color?: string        // #rrggbb (render only); a container without one shows its board's color
  boardRef?: BoardId    // the interior: required on a container (unless cloneOf), optional on the player
                        // (a player that is itself a box — official `player=1` Block without fillwithwalls)
  infiniteFor?: PieceId // present only on an infinite (∞) destination
  epsilonFor?: PieceId  // present only on an epsilon (ε) destination — names the SEED piece (first entered room)
  cloneOf?: PieceId     // present only on a clone — names its main body
  fliph?: boolean       // persistent horizontal-flip property
  linkedTo?: PieceId    // present only on a container linked directly to another
  possessable?: boolean // the player can take control of it (official `possessable`; see possess in rules.ts)
  wall?: boolean        // a wall block (official possessable Wall): immovable unless it is the player
  // Official Ref fields, stored RAW, no gameplay meaning yet. Do NOT assume "same number ==
  // same destination" or that infEnterId is a definition id — both unverified.
  infExit?: boolean        // `infexit`
  infExitNum?: number      // `infexitnum` (degree)
  infEnter?: boolean       // `infenter`
  infEnterNum?: number     // `infenternum` (degree)
  infEnterId?: number      // `infenterid` (which level is infenter; lookup layer undecided)
  exitBlock?: boolean      // `exitblock`: this Ref is the level's exit block (the infenter destination Ref)
}

export interface Location {
  board: BoardId
  x: number
  y: number
}

// Official level format header "attempt_order" (push,enter,eat,possess). Only
// the first three exist in this engine. Default when absent: push, enter, eat.
export type Attempt = 'push' | 'enter' | 'eat'
export const DEFAULT_ATTEMPT_ORDER: readonly Attempt[] = ['push', 'enter', 'eat']

export interface World {
  attemptOrder?: Attempt[]
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

// ---- Definition / Instance layer -------------------------------------------
// A Board is a BLOCK DEFINITION: immutable geometry (cells never change during
// play), identified by BoardId. A container Piece is a REF INSTANCE: it has its
// own runtime identity (PieceId) and placement (locations[id]) and points at a
// definition via boardRef; a clone is a Ref whose target is its source's
// definition (cloneOf). Several Refs may target one definition — they share the
// one interior (its pieces live once, in world.locations), like the official
// game's Ref-to-Block.

export type BlockDefinition = Board
export type RefInstance = Piece

export function getDefinition(world: World, boardId: BoardId): BlockDefinition | undefined {
  return world.boards[boardId]
}

// The definition a Ref instance leads into: its own boardRef, or, for a clone,
// its source's. Undefined for anything that is not a Ref with an interior.
export function targetDefinitionOf(world: World, piece: Piece): BoardId | undefined {
  if (piece.kind !== 'container' && piece.kind !== 'player') return undefined
  if (piece.cloneOf !== undefined) {
    const source = world.pieces[piece.cloneOf]
    return source !== undefined && hasInterior(source) ? source.boardRef : undefined
  }
  return piece.boardRef
}

// A piece with a board of its own that things can enter / be eaten into: every container
// (clones aside), and the player when the player is itself a box.
export function hasInterior(piece: Piece): boolean {
  return (piece.kind === 'container' || piece.kind === 'player') && piece.boardRef !== undefined
}

// Every Ref instance (clones included) whose interior is this definition,
// sorted by id so callers are deterministic.
export function instancesOf(world: World, boardId: BoardId): PieceId[] {
  return Object.values(world.pieces)
    .filter((p) => targetDefinitionOf(world, p) === boardId)
    .map((p) => p.id)
    .sort()
}

// The instance the climb out of a definition's interior goes through. With one Ref this is
// that Ref. With several sharing a definition: the official Custom Levels editor
// (Zygahedron/Parabox-Editor, level.py) enforces "at most one Ref may hold exitblock=1 per
// Block id" — assigning it to a new Ref clears the flag on whichever Ref held it before
// (`if block.exit: block.exit.exitblock = False; block.exit = self`) — and on load, the
// non-infenter exitblock Ref for an id becomes that Block's single recognized `exit`
// (`if exitblock and not infenter: block.exit = ref`). That is a real editor's own encoded
// understanding of the format (not official source, but a strong, deliberate, non-accidental
// invariant), so an exitBlock-flagged instance (that is not itself an infEnter catcher) is
// preferred as the canonical exit here. When no candidate is flagged (unauthored levels,
// or the generator's own output), the smallest-id instance is used — a deterministic
// placeholder still awaiting a differential test against the original for that case.
export function findContainerFor(world: World, boardId: BoardId): PieceId | undefined {
  const owners = Object.values(world.pieces)
    .filter((p) => hasInterior(p) && p.cloneOf === undefined && p.boardRef === boardId)
    .sort((a, b) => a.id.localeCompare(b.id))
  const exit = owners.find((p) => p.exitBlock === true && p.infEnter !== true)
  return (exit ?? owners[0])?.id
}

export function cloneWorld(world: World): World {
  return structuredClone(world)
}

// The engine never mutates a World in place: a move builds a new one, sharing every part it
// does not change (boards, pieces) — only locations are replaced here. (A deep clone per move
// was the solver's main cost.)
export function moveTo(world: World, pieceId: PieceId, location: Location): World {
  return { ...world, locations: { ...world.locations, [pieceId]: location } }
}

// A new World whose top-level maps can be modified (entries replaced / added) without touching
// the original; nested boards / pieces / cells stay shared and must not be mutated.
function copyWorldMaps(world: World): World {
  return { ...world, boards: { ...world.boards }, pieces: { ...world.pieces }, locations: { ...world.locations } }
}

export const VOID_BOARD_ID: BoardId = 'void'

// A plain 5x5 floor board, same as any other board — its boundary is just the array
// edge, not an explicit ring of wall cells, so all 25 cells are usable. Ordinary levels
// never reach it (they are walled in); only an undefined Infinite Exit sends a piece here,
// with the Infinite box at the center.
export const VOID_SIZE = 7
export const VOID_CENTER = 3

function makeVoidBoard(): Board {
  const cells: Cell[][] = Array.from({ length: VOID_SIZE }, () =>
    Array.from({ length: VOID_SIZE }, () => ({ type: 'floor' as CellType })),
  )
  return { id: VOID_BOARD_ID, size: VOID_SIZE, cells }
}

// Fixed search order for a free cell for a NEW Infinite destination: the center
// first, then the ring of 8 cells one step out, then the ring of 16 two steps out
// (25 cells around the center). Deterministic so tests can predict exactly where a
// given destination lands.
const VOID_CELL_ORDER: Array<{ x: number; y: number }> = []
for (const [dx, dy] of [
  [0, 0],
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
  [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2],
  [-2, -1], [2, -1], [-2, 0], [2, 0], [-2, 1], [2, 1],
  [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2],
]) VOID_CELL_ORDER.push({ x: VOID_CENTER + dx, y: VOID_CENTER + dy })

// A piece "is locked" exactly when it's physically standing in the Void —
// this is a derived fact, not a separately-tracked flag, so it can never
// drift out of sync: anything that ends up on VOID_BOARD_ID through ANY path
// (sendToVoid below, or e.g. walking out of a container that itself got
// voided) is locked, with no risk of a missed flag assignment. resolveBlocked
// reads this to keep a locked piece pushable but never enterable/mergeable
// again; CanvasRenderer reads it to draw the locked ring.
export function isInVoid(world: World, pieceId: PieceId): boolean {
  return world.locations[pieceId]?.board === VOID_BOARD_ID
}

function infiniteDestinationIdFor(ownerId: PieceId, degree: number): PieceId {
  return degree === 0 ? `void-infinite:${ownerId}` : `void-infinite:${ownerId}:${degree}`
}

// Level-authored ∞ boxes for ownerId's family, ascending by degree (infExitNum) — confirmed by
// direct testing (see docs/engine-official-audit.md): pushing a self-loop container off its own
// board's edge, when the level ALREADY contains infExit-flagged Refs targeting that same board,
// must never fall to the Void as long as at least one of them can accept the piece. There is no
// per-owner id field for infExit (unlike infEnter's infEnterId) — an infExit Ref belongs to
// ownerId's family purely by targeting the SAME board ownerId itself targets (the recursive
// definition that's overflowing). Trying them in ascending-degree order and using the first
// whose eject cell actually succeeds (rules.ts's resolveInfiniteExit) is what realizes the
// user-described chain (∞ then ∞∞ then ...) without any unverifiable "already used" bookkeeping:
// once a low-degree box's landing cell is blocked, the next call naturally tries the next degree.
export function findAuthoredInfiniteExitCandidates(world: World, ownerId: PieceId): PieceId[] {
  const owner = world.pieces[ownerId]
  if (owner === undefined) return []
  const family = targetDefinitionOf(world, owner)
  if (family === undefined) return []
  return Object.values(world.pieces)
    .filter((p) => p.infExit === true && p.id !== ownerId && world.locations[p.id] !== undefined && targetDefinitionOf(world, p) === family)
    .sort((a, b) => (a.infExitNum ?? 0) - (b.infExitNum ?? 0))
    .map((p) => p.id)
}

// A valid destination for ownerId is either the real ownerId piece itself, if
// it's already sitting in the Void (once the real piece is there, later
// arrivals through the same cycle use it directly, no separate placeholder),
// or any piece — synthesized below, or hand-authored in a level — whose
// infiniteFor names ownerId.
function findInfiniteDestination(world: World, ownerId: PieceId, degree: number): PieceId | undefined {
  if (degree === 0 && isInVoid(world, ownerId)) return ownerId
  for (const [pieceId, piece] of Object.entries(world.pieces)) {
    if (piece.infiniteFor === ownerId && (piece.infExitNum ?? 0) === degree && world.locations[pieceId] !== undefined) return pieceId
  }
  return undefined
}

// ---- Epsilon (ε): the finite representation of an Infinite Enter ------------
// Unlike ∞ (which cannot be entered), ε IS enterable: it is a walless 1x1 space owned by
// a container that lives in the Void. It is real World state (undo / canonicalKey / replay
// all see it), and it is keyed to the SEED — the first piece whose entry started the
// unbounded chain (first-room attribution), not to whichever piece closed the chain.
// Whether a board is the Void or lives inside a Void resident (e.g. an ε's interior): the
// camera anchors on the Void for these.
export function isInVoidSpace(world: World, boardId: BoardId): boolean {
  const seen = new Set<BoardId>()
  let current = boardId
  while (!seen.has(current)) {
    if (current === VOID_BOARD_ID) return true
    seen.add(current)
    const owner = findContainerFor(world, current)
    if (owner === undefined) return false
    current = world.locations[owner].board
  }
  return false
}

// Default interior size for a NULL-SPACE ε (no authored floating Block to read a size from).
// Like any Block's width/height, this is a free per-level choice, not a fixed official value —
// ensureEpsilonDestination's caller may override it (e.g. per generator archetype).
export const DEFAULT_EPSILON_SIZE = 5

export function epsilonBoardIdFor(seedId: PieceId): BoardId {
  return `epsilon:${seedId}`
}

function findEpsilonDestination(world: World, seedId: PieceId): PieceId | undefined {
  for (const [pieceId, piece] of Object.entries(world.pieces)) {
    if (piece.epsilonFor === seedId && world.locations[pieceId] !== undefined) return pieceId
  }
  return undefined
}

// Existing matching ε first (MATCHING = VERIFY: today only seed identity is compared, not
// infenternum / infenterid). Only when there is none is a null-space ε created, lazily, at the
// CENTER of the Void (first free cell of the placement order). Being a Void resident it is
// locked: nothing can walk or be pushed into it — only the paradox itself puts a piece inside.
export function ensureEpsilonDestination(
  world: World,
  seedId: PieceId,
  size: number = DEFAULT_EPSILON_SIZE,
): { world: World; epsilonId: PieceId; created: boolean } | null {
  const next = copyWorldMaps(world)
  const existing = findEpsilonDestination(next, seedId)
  if (existing !== undefined) return { world: next, epsilonId: existing, created: false }

  if (next.boards[VOID_BOARD_ID] === undefined) next.boards[VOID_BOARD_ID] = makeVoidBoard()
  const cell = VOID_CELL_ORDER.find(
    ({ x, y }) => occupantAt(next, { board: VOID_BOARD_ID, x, y }) === undefined,
  )
  if (cell === undefined) return null

  const epsilonId = `void-epsilon:${seedId}`
  const board = epsilonBoardIdFor(seedId)
  // Observed in the original (case 6): the mover ends up INSIDE the ε, small, on the middle of
  // its entry edge — an ordinary interior entered like any box. It has no walls of its own;
  // the ε box itself sits in the Void, so like every Void box it cannot be entered by others.
  next.boards[board] = {
    id: board,
    size,
    cells: Array.from({ length: size }, () => Array.from({ length: size }, (): Cell => ({ type: 'floor' }))),
  }
  next.pieces[epsilonId] = { id: epsilonId, kind: 'container', boardRef: board, epsilonFor: seedId }
  next.locations[epsilonId] = { board: VOID_BOARD_ID, x: cell.x, y: cell.y }
  return { world: next, epsilonId, created: true }
}

// Finds (or synthesizes) the infinite destination representing ownerId,
// returning the resulting world and the destination's location. This is the
// data half of resolving an infinite exit — deciding WHERE the exiting piece
// actually lands, by moving in the original push direction from this
// location and (if blocked) chaining a push, lives in rules.ts, since that
// needs tryMovePiece. Returns null only when a brand-new destination is
// needed but the Void is full (no free cell for it).
// `degree`: 0 = ∞, 1 = ∞∞, 2 = ∞∞∞ ... (see infiniteExitDegreeOf in rules.ts). A Void destination
// is keyed per (owner, degree), and a synthesized one of degree > 0 carries infExitNum so the
// renderer draws degree+1 stacked glyphs, exactly like an authored box of that degree.
export function ensureInfiniteDestination(world: World, ownerId: PieceId, degree = 0): { world: World; location: Location } | null {
  const next = copyWorldMaps(world)

  // An existing destination catches the paradox: no second ∞ and no Void is materialized.
  const existingDestinationId = findInfiniteDestination(next, ownerId, degree)
  if (existingDestinationId !== undefined) {
    return { world: next, location: next.locations[existingDestinationId] }
  }

  // No finite destination: only now does the Void come into existence (lazily).
  if (next.boards[VOID_BOARD_ID] === undefined) {
    next.boards[VOID_BOARD_ID] = makeVoidBoard()
  }

  const destinationCell = VOID_CELL_ORDER.find(
    ({ x, y }) => occupantAt(next, { board: VOID_BOARD_ID, x, y }) === undefined,
  )
  if (destinationCell === undefined) return null
  const destinationId = infiniteDestinationIdFor(ownerId, degree)
  next.pieces[destinationId] = degree === 0
    ? { id: destinationId, kind: 'normal', infiniteFor: ownerId }
    : { id: destinationId, kind: 'normal', infiniteFor: ownerId, infExitNum: degree }
  next.locations[destinationId] = { board: VOID_BOARD_ID, x: destinationCell.x, y: destinationCell.y }
  return { world: next, location: next.locations[destinationId] }
}
