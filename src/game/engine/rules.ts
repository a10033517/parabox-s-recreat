import { emitEngineEvent, eventMark, isInfiniteEnterDisabled, isMechanicDisabled, rollbackEvents } from './events'
import { Fraction, addInt, divideByInt, multiplyByInt, isZero, fractionDivMod, makeFraction, HALF } from './fraction'
import {
  World, Location, Direction, Board, BoardId, Piece, PieceId,
  DEFAULT_ATTEMPT_ORDER, targetDefinitionOf, inBounds, step, findContainerFor, occupantAt, moveTo,
  ensureInfiniteDestination, findAuthoredInfiniteExitCandidates, ensureEpsilonDestination, isInVoid, opposite, PLAYER_ID, hasInterior } from './types'

// 1 - f: the same position measured from the other side (a horizontal mirror of an x fraction).
function oneMinus(f: Fraction): Fraction {
  return makeFraction(f.denominator - f.numerator, f.denominator)
}

// Passing through a flipped (fliph) box mirrors the piece that passes: an asymmetric box comes
// out mirrored — its interior (and so which side it can be entered / eat from) flips too.
function toggleFlip(world: World, pieceId: PieceId): World {
  emitEngineEvent({ type: 'FlipEvent', pieceId })
  const piece = world.pieces[pieceId]
  const flipped: Piece = { ...piece }
  if (piece.fliph === true) delete flipped.fliph
  else flipped.fliph = true
  return { ...world, pieces: { ...world.pieces, [pieceId]: flipped } }
}

function mirrorHorizontal(dir: Direction): Direction {
  if (dir === 'left') return 'right'
  if (dir === 'right') return 'left'
  return dir
}

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

// ---- Transfer: three isolated stages ---------------------------------------
// Target selection is NOT publicly specified by the official game (how ties between
// several same-position sub-boxes are broken). Each stage is its own function so a
// verified rule replaces only the selector, never the enter/exit engine.

// Stage 1: which pieces could this container transfer to. Today: its explicit `linkedTo`.
export function collectTransferCandidates(_world: World, container: Piece): PieceId[] {
  // A dangling link is still a candidate: resolve then fails the move cleanly instead of
  // silently falling through to an ordinary climb.
  return container.linkedTo === undefined ? [] : [container.linkedTo]
}

// Stage 2: choose one. PROVISIONAL deterministic rule: the first candidate, or none. A
// malformed link (target missing) still selects the link so resolve can fail cleanly.
export function selectTransferTarget(candidates: PieceId[]): PieceId | undefined {
  return candidates[0]
}

// Stage 3: the actual landing cell in the selected target's interior (mirrored offset).
export function resolveTransferTarget(
  world: World,
  fromBoard: Board,
  loc: Location,
  dir: Direction,
  targetId: PieceId,
): Location | null {
  const linked = world.pieces[targetId]
  const linkedBoard = linked?.boardRef !== undefined ? world.boards[linked.boardRef] : undefined
  if (linkedBoard === undefined) return null
  const cell = linkedEntryCell(fromBoard.size, loc.x, loc.y, dir)
  if (!inBounds(linkedBoard, cell.x, cell.y)) return null
  return { board: linked.boardRef as BoardId, x: cell.x, y: cell.y }
}

export type MoveTarget =
  // viaOwner: set when the location was reached by climbing out through a container (the
  // first one climbed) — lets tryMovePiece spot a climb that lands back on the mover itself.
  // dir / flipped: set when the climb passed through fliph boxes — the direction the piece is
  // moving in on arrival (mirrored once per flipped box) and whether it arrives mirrored.
  | { kind: 'location'; location: Location; relativeCoord: Fraction; viaOwner?: PieceId; dir?: Direction; flipped?: boolean }
  | { kind: 'infinite'; board: BoardId; ownerId: PieceId }
  | null // blocked: no owner to climb through (e.g. the true root boundary)

export function computeTarget(
  world: World,
  loc: Location,
  dir: Direction,
  relativeCoord: Fraction,
  visited: Set<BoardId> = new Set(),
  // The container climbed through FIRST (the first room exited). A paradox is attributed to
  // this seed — not to whichever owner happens to close the cycle, and not to a canonical
  // owner picked afterwards (Patrick: attribution is by the first room entered/exited).
  seedOwner?: PieceId,
  flips = 0, // fliph boxes climbed through so far
): MoveTarget {
  const board = world.boards[loc.board]
  const { x, y } = step(loc.x, loc.y, dir)

  // inBounds MUST be checked before visited — a legitimate "wrap" (the
  // recursive owner position happens to be in bounds) is not a cycle, even
  // if loc.board has been visited before in this climb. Checking visited
  // first would misclassify every ordinary self-loop wrap as infinite.
  if (inBounds(board, x, y)) {
    const result: MoveTarget = { kind: 'location', location: { board: loc.board, x, y }, relativeCoord }
    if (seedOwner !== undefined) result.viaOwner = seedOwner
    if (flips > 0) {
      result.dir = dir
      result.flipped = flips % 2 === 1
    }
    return result
  }

  if (visited.has(loc.board)) {
    // loc.board can only be in `visited` because an earlier step in this same
    // climb already called findContainerFor(world, loc.board) successfully —
    // that's the only way the climb reaches a board at all — so this can
    // never be undefined here.
    return { kind: 'infinite', board: loc.board, ownerId: seedOwner as PieceId }
  }
  visited.add(loc.board)

  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null
  const container = world.pieces[containerId]

  const transferTarget = selectTransferTarget(collectTransferCandidates(world, container))
  if (transferTarget !== undefined) {
    const resolved = resolveTransferTarget(world, board, loc, dir, transferTarget)
    // null = malformed link or size mismatch: fail cleanly, never fall through to a normal climb.
    return resolved === null ? null : { kind: 'location', location: resolved, relativeCoord }
  }

  // Leaving a flipped box: its interior is a mirror image of the outside, so the direction is
  // mirrored, and so is the position along a vertical exit (column x of the interior is column
  // size-1-x seen from outside).
  const climbDir = container.fliph ? mirrorHorizontal(dir) : dir
  const vertical = climbDir === 'up' || climbDir === 'down'
  const offset = vertical ? loc.x : loc.y
  const straight = divideByInt(addInt(relativeCoord, offset), board.size)
  const newRelativeCoord = container.fliph && vertical ? oneMinus(straight) : straight

  const containerLoc = world.locations[containerId]
  return computeTarget(
    world, containerLoc, climbDir, newRelativeCoord, visited, seedOwner ?? containerId,
    flips + (container.fliph ? 1 : 0),
  )
}

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
  const mark = eventMark()
  const result = tryMovePieceImpl(world, pieceId, dir, inMotion, beingEntered)
  if (result === null) rollbackEvents(mark)
  return result
}

function tryMovePieceImpl(
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
  if (loc === undefined) return null // the piece is no longer in the world
  if (world.pieces[pieceId].wall === true && pieceId !== PLAYER_ID) return null // a wall block never moves unless you are it
  const target = computeTarget(world, loc, dir, HALF)
  if (target === null) return null
  // The transition can never resolve to a real location — the piece attempting
  // it exits into the Void instead, from the "infinite destination"
  // representing whichever container owns the board the cycle actually broke
  // on (target.ownerId), in the SAME direction it was already moving (see
  // resolveInfiniteExit). Being physically in the Void is itself what makes a
  // piece "locked" (see isInVoid), so nothing more needs to happen here. If
  // pieceId is PLAYER_ID, the player simply ends up standing in the Void —
  // this is no longer a loss (there is no loss state anymore — checkLose is
  // gone). If it's any other piece, resolveBlocked's existing "pushed
  // succeeded" path (moveTo(pushed, pieceId, target.location)) already treats
  // a non-null return as a completed push, so the pusher still ends up at its
  // own target cell while the pushed piece ends up in the Void — no change
  // needed there.
  if (target.kind === 'infinite') return resolveInfiniteExit(world, pieceId, target.ownerId, dir, inMotion)

  // A climb that lands back on the mover's OWN cell:
  // - The mover walks on its own (first in the push chain) and the box it climbs through stays
  //   put — e.g. standing right beside the self-containing box you are inside and walking away
  //   from it: you step out one level and land beside that box, which is exactly where you
  //   already stand. A legal move that changes nothing (user-reported on file_format_example,
  //   2026-09-26: this must not drop you into the Void).
  // - Otherwise it is an infinite exit: e.g. an ∞ box at the edge pushed out while the
  //   self-loop it climbs through is right behind it in the same push — it would come out
  //   beside that self-loop, which is itself on the move (user-reported, 2026-09-24: this must
  //   come out of ∞∞, not overlap).
  if (target.viaOwner !== undefined && occupantAt(world, target.location) === pieceId) {
    if (inMotion.size === 0) return target.flipped === true ? toggleFlip(world, pieceId) : world
    return resolveInfiniteExit(world, pieceId, target.viaOwner, dir, inMotion)
  }

  const targetBoard = world.boards[target.location.board]
  if (targetBoard.cells[target.location.y][target.location.x].type === 'wall') return null
  if (target.viaOwner !== undefined) {
    const through = world.pieces[target.viaOwner]
    emitEngineEvent({
      type: 'ExitEvent', pieceId, throughId: target.viaOwner,
      selfLoop: through.boardRef !== undefined && world.locations[target.viaOwner]?.board === through.boardRef,
    })
  }

  // Out through flipped boxes: the piece arrives mirrored, moving in the mirrored direction.
  const arrivalDir = target.dir ?? dir
  const arrived = target.flipped === true ? toggleFlip(world, pieceId) : world
  const occupant = occupantAt(arrived, target.location)
  if (!occupant) return moveTo(arrived, pieceId, target.location)

  return resolveBlocked(arrived, pieceId, occupant, target, arrivalDir, inMotion, beingEntered)
}

// Ejects pieceId from destinationLoc (an ∞ box's own location, wherever it stands — an
// ordinary level board or the Void), one step further in the SAME direction it was already
// moving (dir) — "pushed up, comes out the top" — not an arbitrary nearby free cell. If that
// exit cell is occupied, the occupant is pushed further in the same direction (reusing
// tryMovePiece — an ordinary push, chaining through as many occupied cells as necessary); if
// that push isn't possible, or the exit cell is out of bounds or a wall, returns null and the
// caller tries the next candidate (or ultimately fails the whole move).
type EjectOutcome = { kind: 'ok'; world: World } | { kind: 'offEdge' } | { kind: 'blocked' }

function tryEjectFrom(
  world: World,
  pieceId: PieceId,
  destinationLoc: Location,
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
): EjectOutcome {
  const destinationBoard = world.boards[destinationLoc.board]
  const { x, y } = step(destinationLoc.x, destinationLoc.y, dir)
  // The ∞ box sits flush against this very edge: coming out of it leaves the board again in the
  // same direction, which loops once more (see resolveInfiniteExit) — reported separately.
  if (!inBounds(destinationBoard, x, y)) return { kind: 'offEdge' }
  if (destinationBoard.cells[y][x].type === 'wall') return { kind: 'blocked' }

  const exitLoc: Location = { board: destinationLoc.board, x, y }
  const occupant = occupantAt(world, exitLoc)
  if (occupant === undefined) return { kind: 'ok', world: moveTo(world, pieceId, exitLoc) }
  // Landing on the escaping piece's own cell, or on a cell a later member of this same push chain
  // is still standing on, would put two pieces in one cell. The chain's FIRST mover (the pusher
  // at the back, e.g. the player) is the one exception: it steps forward in this same move and
  // nothing fills the cell it leaves.
  const firstMover = inMotion.keys().next().value
  if (occupant === pieceId) return { kind: 'blocked' }
  if (inMotion.has(occupant)) {
    return occupant === firstMover ? { kind: 'ok', world: moveTo(world, pieceId, exitLoc) } : { kind: 'blocked' }
  }

  const pushed = tryMovePiece(world, occupant, dir, new Map(inMotion).set(pieceId, dir), new Set())
  if (pushed === null) return { kind: 'blocked' }
  return { kind: 'ok', world: moveTo(pushed, pieceId, exitLoc) }
}

// The degree of an Infinite Exit is decided by WHAT is escaping (user correction, 2026-09-23;
// supersedes an earlier per-piece "advance one degree each time" rule that was never verified):
//   an ordinary piece (box, player, plain self-loop)       -> degree 0  (comes out of ∞)
//   an ∞ box of degree d of the same family (authored
//   infExit Ref, or a Void-synthesized ∞)                   -> degree d+1 (comes out of ∞∞, ∞∞∞, ...)
// So an ordinary self-loop pushed off the edge ALWAYS comes out of the degree-0 ∞ box, no matter
// how many times it has done so before.
export function infiniteExitDegreeOf(world: World, pieceId: PieceId, ownerId: PieceId): number {
  const piece = world.pieces[pieceId]
  const owner = world.pieces[ownerId]
  if (piece === undefined || owner === undefined) return 0
  if (piece.infExit === true && targetDefinitionOf(world, piece) === targetDefinitionOf(world, owner)) {
    return (piece.infExitNum ?? 0) + 1
  }
  if (piece.infiniteFor === ownerId) return (piece.infExitNum ?? 0) + 1
  return 0
}

// Resolves an Infinite Exit: the level-authored ∞ box of EXACTLY the required degree (same
// family, see findAuthoredInfiniteExitCandidates) catches it; only when the level has none of
// that degree (or none can accept the piece) is a destination of that degree used/created in
// the Void center — e.g. iiexit_intro has degree 0 and 1, so escaping from ∞∞ needs ∞∞∞, which
// the level lacks, so an ∞∞∞ box is spawned in the Void.
export function resolveInfiniteExit(
  world: World,
  pieceId: PieceId,
  ownerId: PieceId,
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
): World | null {
  if (isMechanicDisabled('infiniteExit')) return null
  emitEngineEvent({ type: 'InfiniteExitEvent', pieceId, ownerId })
  let degree = infiniteExitDegreeOf(world, pieceId, ownerId)
  const family = findAuthoredInfiniteExitCandidates(world, ownerId).filter((id) => id !== pieceId)
  for (;;) {
    const ofDegree = family.filter((id) => (world.pieces[id].infExitNum ?? 0) === degree)
    if (ofDegree.length === 0) break // the level has no box of this degree: the Void supplies one
    // Escalate to the next degree when the piece would go out through an ∞ box that is itself
    // going out: that box is part of this same push chain, or it sits flush against this same
    // edge so coming out of it leaves the board again (user, 2026-09-24: "self-loop and ∞ both
    // pushed to the edge come out of ∞∞"). Which piece lands where in the moving-chain ordering
    // is PROVISIONAL.
    let escalate = ofDegree.every((id) => inMotion.has(id))
    for (const candidateId of ofDegree.filter((id) => !inMotion.has(id))) {
      const outcome = tryEjectFrom(world, pieceId, world.locations[candidateId], dir, inMotion)
      if (outcome.kind === 'ok') return outcome.world
      if (outcome.kind === 'offEdge') escalate = true
    }
    if (!escalate) return null // an ∞ of this degree exists but its exit is walled / jammed: no move
    degree++
  }

  const destination = ensureInfiniteDestination(world, ownerId, degree)
  if (destination === null) return null
  const outcome = tryEjectFrom(destination.world, pieceId, destination.location, dir, inMotion)
  return outcome.kind === 'ok' ? outcome.world : null
}

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
  // occupant is always mainBodyId (occupantAt never consults world.boards — it's
  // tautologically standing at its own reported location). The real guard here is
  // the board-presence check: without it, the push below would crash trying to walk
  // a nonexistent board — a structurally odd but not unsafe shape (see the
  // missing-mainBodyId case above), so the entrant just teleports directly there.
  if (occupant === undefined || world.boards[targetLoc.board] === undefined) {
    return moveTo(world, pieceId, targetLoc)
  }
  if (occupant === pieceId) return null // degenerate: pieceId IS the main body

  const pushed = tryMovePiece(world, occupant, dir, new Map(inMotion).set(pieceId, dir), new Set())
  if (pushed === null) return null
  return moveTo(pushed, pieceId, targetLoc)
}

const SEED_PREFIX = 'seed:'

// The FIRST piece entered in this movement resolution — the paradox's attribution seed
// (Patrick: attribution follows the first room entered/exited, not the room that closes the loop).
function seedOfEnterChain(beingEntered: Set<PieceId>): PieceId | undefined {
  for (const key of beingEntered) if (key.startsWith(SEED_PREFIX)) return key.slice(SEED_PREFIX.length)
  return undefined
}

// The numeric official block id behind a board id: the official importer names boards "b<id>".
function officialBlockId(boardId: BoardId): number | undefined {
  const m = /^b([0-9]+)$/.exec(boardId)
  return m === null ? undefined : Number(m[1])
}

// Authored destination (official floating Block + exitblock Ref + infenter metadata): a Ref
// piece with infEnter whose infEnterId names the seed's definition. MATCHING = VERIFY: only
// the id is compared (degree is stored, not matched); ties break by piece id.
export function findAuthoredInfiniteEnter(world: World, seedId: PieceId): PieceId | undefined {
  const seed = world.pieces[seedId]
  if (seed === undefined) return undefined
  const definition = targetDefinitionOf(world, seed)
  const wanted = definition === undefined ? undefined : officialBlockId(definition)
  if (wanted === undefined) return undefined
  return Object.values(world.pieces)
    .filter((p) => p.infEnter === true && p.infEnterId === wanted && world.locations[p.id] !== undefined)
    .map((p) => p.id)
    .sort()[0]
}

// Infinite Enter resolution, separate steps (detect happens in tryEnter):
// match an authored destination, else an existing ε for this seed, else create a null-space
// ε, then let the actor enter it.
// "Enter" is literal: the actor lands in the ε's walless 1x1 space. Occupant of that single
// cell (if any) is pushed out along the movement direction like any other blocked move.
// PROVISIONAL (VERIFY): the landing cell inside ε and how an occupant is displaced.
export function resolveInfiniteEnter(
  world: World,
  pieceId: PieceId,
  seedId: PieceId,
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
): World | null {
  if (isInVoid(world, pieceId)) return null // Void residents are locked: never enter anything
  if (isInfiniteEnterDisabled()) return null // mechanic-removal analysis

  const authoredId = findAuthoredInfiniteEnter(world, seedId)
  if (authoredId !== undefined) {
    // Enter the authored destination Ref like any container; its floating Block is the ε space.
    const entered = tryEnter(world, pieceId, authoredId, dir, HALF, inMotion, new Set([seedId, `${SEED_PREFIX}${seedId}`]))
    if (entered === null) return null
    emitEngineEvent({
      type: 'SpawnEpsilonEvent', seedId, destinationId: authoredId, created: false, authored: true,
      board: entered.locations[pieceId].board, degree: world.pieces[authoredId].infEnterNum,
    })
    return entered
  }

  const destination = ensureEpsilonDestination(world, seedId)
  if (destination === null) return null
  const eps = destination.world.pieces[destination.epsilonId]
  // Entering an ε is an ORDINARY enter — the direction of entry picks the landing cell, exactly
  // as for any box (moving right lands on the middle of the ε's left edge; the mover is then
  // pushed on to the right by whoever follows). Only the paradox may put a piece inside a Void
  // ε: the ε is locked in the Void, so nothing else can enter it. A piece that later leaves the
  // ε ends up in the Void and is locked there too (isInVoid is derived from where it stands).
  const entered = tryEnter(
    destination.world, pieceId, destination.epsilonId, dir, HALF, inMotion,
    new Set([seedId, `${SEED_PREFIX}${seedId}`]),
  )
  if (entered === null) return null
  emitEngineEvent({
    type: 'SpawnEpsilonEvent', seedId, destinationId: destination.epsilonId,
    board: eps.boardRef as BoardId, created: destination.created, authored: false,
  })
  return entered
}

export function tryEnter(
  world: World,
  pieceId: PieceId,
  intoId: PieceId,
  dir: Direction,
  relativeCoord: Fraction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const mark = eventMark()
  const result = tryEnterImpl(world, pieceId, intoId, dir, relativeCoord, inMotion, beingEntered)
  if (result === null) {
    rollbackEvents(mark)
    return null
  }
  const clicked = world.pieces[intoId]
  const source = clicked.cloneOf !== undefined ? world.pieces[clicked.cloneOf] ?? clicked : clicked
  const board = source.boardRef
  emitEngineEvent({
    type: 'EnterEvent', pieceId, intoId,
    selfLoop: board !== undefined && world.locations[intoId]?.board === board,
    clone: clicked.cloneOf !== undefined || (board !== undefined && findContainerFor(world, board) !== intoId),
  })
  return result
}

function tryEnterImpl(
  world: World,
  pieceId: PieceId,
  intoId: PieceId,
  dir: Direction,
  relativeCoord: Fraction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const clicked: Piece = world.pieces[intoId]
  // A clone is a reference to its source block, not a portal: entering it enters
  // the SOURCE's interior, exactly as entering the source itself would (official
  // Clone rule; the clone's own position and fliph are irrelevant). Only when the
  // source has no interior of its own (a plain piece — the legacy shape used by
  // 11-clone-box) does it fall back to redirecting onto the source's location.
  let into: Piece = clicked
  if (clicked.cloneOf !== undefined) {
    const source = world.pieces[clicked.cloneOf]
    if (source !== undefined && hasInterior(source) && world.boards[source.boardRef as string] !== undefined) {
      into = source
    } else {
      if (beingEntered.has(intoId)) return null
      return resolveCloneTeleport(world, pieceId, clicked.cloneOf, dir, inMotion)
    }
  }
  if (!hasInterior(into)) return null // a player that is itself a box can be entered too
  // An infExit-flagged piece is an ∞ box: the RESULT of being pushed out of an infinite chain,
  // never a destination to walk into — confirmed by direct user correction (2026-09-22; see
  // docs/engine-official-audit.md). It can still be pushed or (per attempt_order) eaten; only
  // entering it is categorically disallowed, regardless of whether it's in the Void or an
  // ordinary level board. (An infEnter-flagged piece is the opposite case — an authored ε
  // destination — and remains ordinarily enterable; that's the whole point of it.)
  if (into.infExit === true) return null
  if (world.pieces[pieceId].wall === true && pieceId !== PLAYER_ID) return null // a wall block cannot be eaten

  const board = world.boards[into.boardRef as string]
  // Into a flipped box: mirrored direction, and a vertical entry lands in the mirrored column.
  const entryDir = into.fliph ? mirrorHorizontal(dir) : dir
  const entryCoord = into.fliph && (dir === 'up' || dir === 'down') ? oneMinus(relativeCoord) : relativeCoord
  const { cell, newRelativeCoord } = getEntryCell(board, entryDir, entryCoord)
  if (cell === null) return null
  if (board.cells[cell.y][cell.x].type === 'wall') return null

  // Infinite Enter detection (kept SEPARATE from the recursion guard below). beingEntered
  // also carries structural transition signatures. Re-entering the same instance, from the
  // same direction, landing on the same entry cell means the chain is a pure inward loop:
  // no finite terminator exists, so it is unbounded — not merely a graph cycle.
  const sig = `enter:${intoId}:${dir}:${cell.x},${cell.y}`
  if (beingEntered.has(sig)) {
    return resolveInfiniteEnter(world, pieceId, seedOfEnterChain(beingEntered) ?? intoId, dir, inMotion)
  }
  // Same instance again but at a different entry cell: ordinary recursion guard (blocked).
  if (beingEntered.has(intoId)) return null

  const target: Location = { board: board.id, x: cell.x, y: cell.y }
  const nextBeingEntered = new Set(beingEntered).add(intoId).add(sig)
  if (seedOfEnterChain(beingEntered) === undefined) nextBeingEntered.add(`${SEED_PREFIX}${intoId}`)

  // The entering piece comes out mirrored inside a flipped box, and keeps moving in entryDir.
  const entered = into.fliph ? toggleFlip(world, pieceId) : world
  const occupant = occupantAt(entered, target)
  if (!occupant) return moveTo(entered, pieceId, target)

  return resolveBlocked(
    entered, pieceId, occupant,
    { location: target, relativeCoord: newRelativeCoord },
    entryDir, inMotion, nextBeingEntered,
  )
}

export function resolveBlocked(
  world: World,
  pieceId: PieceId,
  occupantId: PieceId,
  target: { location: Location; relativeCoord: Fraction },
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const mark = eventMark()
  const result = resolveBlockedImpl(world, pieceId, occupantId, target, dir, inMotion, beingEntered)
  if (result === null) rollbackEvents(mark)
  return result
}

function resolveBlockedImpl(
  world: World,
  pieceId: PieceId,
  occupantId: PieceId,
  target: { location: Location; relativeCoord: Fraction },
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const nextInMotion = new Map(inMotion).set(pieceId, dir)

  // Push is ALWAYS tried first: a box with room behind it is pushed, never entered or eaten,
  // even when a custom attempt_order lists enter/eat before push (observed in the real game on
  // order_elbow_push, user-reported 2026-09-24). attempt_order therefore only decides the order
  // of the fallbacks (enter vs eat) once the push has failed.
  // The push path is also the only legal way a locked piece — on either side — may take part
  // in a blocked move: enter / eat are skipped when either side is in the Void (see isInVoid).
  const pushed = tryMovePiece(world, occupantId, dir, nextInMotion, new Set())
  if (pushed) return moveTo(pushed, pieceId, target.location)
  if (isInVoid(world, pieceId) || isInVoid(world, occupantId)) return null
  for (const attempt of world.attemptOrder ?? DEFAULT_ATTEMPT_ORDER) {
    if (attempt === 'push') {
      continue
    } else if (attempt === 'enter') {
      if (isMechanicDisabled('enter')) continue
      const entered = tryEnter(
        world, pieceId, occupantId, dir, target.relativeCoord,
        nextInMotion, beingEntered,
      )
      if (entered) return entered
    } else {
      if (isMechanicDisabled('eat')) continue
      const eaten = tryEnter(
        world, occupantId, pieceId, opposite(dir), HALF,
        nextInMotion, new Set(),
      )
      if (eaten) {
        emitEngineEvent({ type: 'EatEvent', eaterId: pieceId, eatenId: occupantId })
        return moveTo(eaten, pieceId, target.location)
      }
    }
  }

  // Possess, always last (official default order push, enter, eat, possess): when nothing
  // else works, the player takes control of a possessable block — or wall — it walked into.
  // So a possessable box that can still be pushed is pushed; only a stuck one is possessed.
  if (pieceId === PLAYER_ID && world.pieces[occupantId]?.possessable === true && !isMechanicDisabled('possess')) {
    emitEngineEvent({ type: 'PossessEvent', targetId: occupantId })
    return possess(world, occupantId)
  }
  return null
}

// The player takes control of targetId: the two pieces swap identities — the possessed block
// becomes the player (keeping its own look, place and interior) and the old body stays where
// it was as an ordinary block (a box, or a container if it has an interior). Nothing moves.
export function possess(world: World, targetId: PieceId): World {
  const oldBody = world.pieces[PLAYER_ID]
  const target = world.pieces[targetId]
  const swapId = (id: PieceId | undefined) => (id === PLAYER_ID ? targetId : id === targetId ? PLAYER_ID : id)
  const pieces: World['pieces'] = {}
  for (const [id, piece] of Object.entries(world.pieces)) {
    let next: Piece
    if (id === PLAYER_ID) next = { ...target, id: PLAYER_ID, kind: 'player' }
    else if (id === targetId) next = { ...oldBody, id: targetId, kind: oldBody.boardRef !== undefined ? 'container' : 'normal' }
    else next = piece
    for (const key of ['cloneOf', 'infiniteFor', 'epsilonFor', 'linkedTo'] as const) {
      if (next[key] !== undefined && swapId(next[key]) !== next[key]) next = { ...next, [key]: swapId(next[key]) }
    }
    pieces[id] = next
  }
  const locations = { ...world.locations, [PLAYER_ID]: world.locations[targetId], [targetId]: world.locations[PLAYER_ID] }
  return { ...world, pieces, locations }
}

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
