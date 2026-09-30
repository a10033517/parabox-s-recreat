import { BoardId, PieceId } from './types'

// Engine -> presentation events. The simulation decides that a paradox happened and says so
// here; the renderer only consumes these (it never infers a paradox itself). An event is a
// one-shot fact about ONE move; the ε itself is persistent World state, so restart / replay /
// undo need no renderer-side bookkeeping.
export interface SpawnEpsilonEvent {
  type: 'SpawnEpsilonEvent'
  seedId: PieceId // first piece entered: the paradox attribution seed
  destinationId: PieceId // the ε container (spawned, existing, or authored)
  board: BoardId // the ε's interior space the actor entered
  created: boolean // true only when this move materialized a NEW null-space ε
  authored: boolean // true when the destination came from an authored infenter Ref
  degree?: number // infenternum of the authored Ref, when there is one
}

// The player took control of another block (possess): the two swapped identities, nothing moved.
export interface PossessEvent {
  type: 'PossessEvent'
  targetId: PieceId // the id the player's OLD body now has
}

// A piece went into a box (walked / pushed in, or eaten into it). intoId is the box it moved
// into (a clone instance keeps its own id here); selfLoop: that box leads into the very board it
// stands on; clone: the box is not the canonical instance of its board (a clone / 2nd Ref).
export interface EnterEvent {
  type: 'EnterEvent'
  pieceId: PieceId
  intoId: PieceId
  selfLoop: boolean
  clone: boolean
}

// A piece left a board, climbing out through the box that owns it.
export interface ExitEvent {
  type: 'ExitEvent'
  pieceId: PieceId
  throughId: PieceId
  selfLoop: boolean
}

// The mover could not push the box it hit, so that box went into the mover.
export interface EatEvent {
  type: 'EatEvent'
  eaterId: PieceId
  eatenId: PieceId
}

// A piece passed through a flipped box and came out mirrored.
export interface FlipEvent {
  type: 'FlipEvent'
  pieceId: PieceId
}

// A piece left a board along an exit chain that never ends (Infinite Exit / ∞ paradox).
export interface InfiniteExitEvent {
  type: 'InfiniteExitEvent'
  pieceId: PieceId
  ownerId: PieceId
}

export type EngineEvent = SpawnEpsilonEvent | PossessEvent | EnterEvent | ExitEvent | EatEvent | FlipEvent | InfiniteExitEvent

// Mechanics that can be switched off, for the level generator's necessity ("ablation") test:
// is the level still solvable without this mechanic?
export type Mechanic = 'enter' | 'eat' | 'possess' | 'infiniteExit'

export interface EngineContext {
  events?: EngineEvent[] // collected when present
  disableInfiniteEnter?: boolean // mechanic-removal analysis: Infinite Enter resolves to "blocked"
  disabledMechanics?: ReadonlySet<Mechanic> // mechanic-removal analysis: these never happen
}

// A module-scoped context (not World state, never serialized): applyMove stays a pure
// World -> World function for every existing caller; only code that opts in via
// withEngineContext sees events or changes engine options.
let current: EngineContext | null = null

export function withEngineContext<T>(context: EngineContext, fn: () => T): T {
  const previous = current
  current = context
  try {
    return fn()
  } finally {
    current = previous
  }
}

export function emitEngineEvent(event: EngineEvent): void {
  current?.events?.push(event)
}

// Event bookkeeping for speculative branches: the engine tries alternatives (push, enter, eat)
// and throws failed ones away; events emitted inside a failed branch are rolled back so the
// log only ever holds what really happened.
export function eventMark(): number {
  return current?.events?.length ?? 0
}

export function rollbackEvents(mark: number): void {
  if (current?.events !== undefined && current.events.length > mark) current.events.length = mark
}

export function isMechanicDisabled(mechanic: Mechanic): boolean {
  return current?.disabledMechanics?.has(mechanic) === true
}

export function isInfiniteEnterDisabled(): boolean {
  return current?.disableInfiniteEnter === true
}
