import { Board, BoardId, Cell, PLAYER_ID, Piece, PieceId, World, occupantAt } from '../../../src/game/engine/types'

// Small building blocks shared by the world profiles' structure generators.

export type Rng = () => number

// Deterministic PRNG (mulberry32): the same seed always rebuilds the same level.
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

export function pick<T>(rng: Rng, items: T[]): T | undefined {
  return items.length === 0 ? undefined : items[randInt(rng, 0, items.length - 1)]
}

// A square room: wall border (optionally with openings at the centre of each side, so the
// board can be entered / left when it is some box's interior) and random inner walls.
export function room(id: BoardId, size: number, wallDensity: number, rng: Rng, opts: { openings?: boolean; border?: boolean } = {}): Board {
  const mid = (size - 1) / 2
  const border = opts.border ?? true
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x): Cell => {
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1
      if (edge && border) {
        // The centre of each side; on an even-sized room that is the middle two cells.
        const centre = (v: number) => v === Math.floor(mid) || v === Math.ceil(mid)
        if (opts.openings && (centre(x) || centre(y))) return { type: 'floor' }
        return { type: 'wall' }
      }
      return { type: rng() < wallDensity ? 'wall' : 'floor' }
    }),
  )
  return { id, size, cells }
}

export function freeCells(world: World, boardId: BoardId): { x: number; y: number }[] {
  const board = world.boards[boardId]
  const out: { x: number; y: number }[] = []
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      const cell = board.cells[y][x]
      if (cell.type !== 'floor' || cell.requirement !== undefined) continue
      if (occupantAt(world, { board: boardId, x, y }) !== undefined) continue
      out.push({ x, y })
    }
  }
  return out
}

// Places a piece on a random free cell of boardId. False when the board is full.
export function place(world: World, rng: Rng, boardId: BoardId, piece: Piece): boolean {
  const cell = pick(rng, freeCells(world, boardId))
  if (cell === undefined) return false
  world.pieces[piece.id] = piece
  world.locations[piece.id] = { board: boardId, x: cell.x, y: cell.y }
  return true
}

// Marks a random free floor cell of boardId as a goal.
export function goal(world: World, rng: Rng, boardId: BoardId, requirement: 'box' | 'player'): boolean {
  const cell = pick(rng, freeCells(world, boardId))
  if (cell === undefined) return false
  world.boards[boardId].cells[cell.y][cell.x] = { type: 'floor', requirement }
  return true
}

export function emptyWorld(): World {
  return { boards: {}, pieces: {}, locations: {} }
}

export function addPlayer(world: World, rng: Rng, boardId: BoardId): boolean {
  return place(world, rng, boardId, { id: PLAYER_ID, kind: 'player' })
}

// A pieceless copy of a board (walls kept, goals and pieces dropped): what a box leads into
// once a mechanic is removed — e.g. a self-loop turned into a box with its own ordinary room.
export function strippedCopy(world: World, boardId: BoardId, newId: BoardId): World {
  const board = world.boards[boardId]
  const copy: Board = {
    ...board,
    id: newId,
    cells: board.cells.map((row) => row.map((c): Cell => ({ type: c.type }))),
  }
  return { ...world, boards: { ...world.boards, [newId]: copy } }
}

export function withPiece(world: World, id: PieceId, patch: Partial<Piece>): World {
  return { ...world, pieces: { ...world.pieces, [id]: { ...world.pieces[id], ...patch } } }
}

// Owner graph cycles: a container whose interior leads (through owners) back to the board it
// stands on. Returns the length of the shortest cycle through each container that is on one.
export function cycleLengthThrough(world: World, containerId: PieceId): number | undefined {
  const start = world.locations[containerId]?.board
  const first = world.pieces[containerId]?.boardRef
  if (start === undefined || first === undefined) return undefined
  // BFS over boards: from a board, step to the interior of every container standing on it.
  const dist = new Map<BoardId, number>([[first, 1]])
  const queue = [first]
  while (queue.length > 0) {
    const board = queue.shift() as BoardId
    if (board === start) return dist.get(board)
    for (const piece of Object.values(world.pieces)) {
      if (piece.boardRef === undefined || world.locations[piece.id]?.board !== board) continue
      if (!dist.has(piece.boardRef)) {
        dist.set(piece.boardRef, (dist.get(board) as number) + 1)
        queue.push(piece.boardRef)
      }
    }
  }
  return undefined
}

// A random ODD size in [min, max]. Every room a box leads into is odd-sized: entering a box
// lands on the centre cell of the side you come in from, and an even side has no centre cell.
export function oddInt(rng: Rng, min: number, max: number): number {
  const odds: number[] = []
  for (let n = min; n <= max; n++) if (n % 2 === 1) odds.push(n)
  return odds[randInt(rng, 0, odds.length - 1)]
}
