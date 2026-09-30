import { Board, BoardId, Cell, PLAYER_ID, Piece, PieceId, Requirement, World, occupantAt } from '../game/engine/types'

// Pure edit operations for the level editor. Every function returns a NEW World (the input is
// never modified) or an EditError explaining why the edit is not allowed. Unlike the old
// in-app editor (src/editor/worldEdit.ts), nothing here assumes the top board is called
// 'root': any existing level can be loaded and edited.

export class EditError extends Error {}

export type Result = World | EditError

// Deep-enough copy for editing: boards (and their cells), pieces and locations are copied.
function copy(world: World): World {
  return {
    ...world,
    boards: Object.fromEntries(Object.entries(world.boards).map(([id, b]) => [id, { ...b, cells: b.cells.map((r) => r.map((c) => ({ ...c }))) }])),
    pieces: Object.fromEntries(Object.entries(world.pieces).map(([id, p]) => [id, { ...p }])),
    locations: Object.fromEntries(Object.entries(world.locations).map(([id, l]) => [id, { ...l }])),
  }
}

export function uniqueId(taken: Iterable<string>, prefix: string): string {
  const set = new Set(taken)
  for (let i = 1; ; i++) if (!set.has(`${prefix}${i}`)) return `${prefix}${i}`
}

export function makeBoard(id: BoardId, size: number, walled = false): Board {
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x): Cell => ({ type: walled && (x === 0 || y === 0 || x === size - 1 || y === size - 1) ? 'wall' : 'floor' })),
  )
  return { id, size, cells }
}

export function newLevel(size: number, opts: { walled?: boolean; color?: string } = {}): World {
  const root = makeBoard('root', size, opts.walled)
  if (opts.color !== undefined) root.color = opts.color
  const inner = opts.walled ? 1 : 0
  return {
    boards: { root },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } },
    locations: { [PLAYER_ID]: { board: 'root', x: inner, y: inner } },
  }
}

// Boards still part of the level: the start board (where the player begins) and every board
// that some piece standing on an included board leads into. Everything else is garbage.
function reachableBoards(world: World, startBoard: BoardId): Set<BoardId> {
  const reached = new Set<BoardId>([startBoard])
  const queue = [startBoard]
  // Boards that nothing leads into but that float in space (official floatinspace) stay too.
  for (const b of Object.values(world.boards)) if (b.floatInSpace && !reached.has(b.id)) { reached.add(b.id); queue.push(b.id) }
  while (queue.length > 0) {
    const board = queue.shift() as BoardId
    for (const piece of Object.values(world.pieces)) {
      if (world.locations[piece.id]?.board !== board) continue
      const inner = piece.boardRef
      if (inner !== undefined && world.boards[inner] !== undefined && !reached.has(inner)) {
        reached.add(inner)
        queue.push(inner)
      }
    }
  }
  return reached
}

// Removes boards no longer reachable from the start board, with everything on them. Refuses
// when that would remove the player.
function collectGarbage(world: World, startBoard: BoardId): Result {
  const keep = reachableBoards(world, startBoard)
  if (!keep.has(world.locations[PLAYER_ID]?.board)) return new EditError('这样会把玩家一起删掉')
  const next = copy(world)
  for (const id of Object.keys(next.boards)) if (!keep.has(id)) delete next.boards[id]
  for (const [id, loc] of Object.entries(next.locations)) {
    if (!keep.has(loc.board)) {
      delete next.locations[id]
      delete next.pieces[id]
    }
  }
  return next
}

export function deletePiece(world: World, pieceId: PieceId, startBoard: BoardId): Result {
  if (pieceId === PLAYER_ID) return new EditError('玩家不能删除(可以移动)')
  const next = copy(world)
  delete next.pieces[pieceId]
  delete next.locations[pieceId]
  return collectGarbage(next, startBoard)
}

export function paintCell(world: World, boardId: BoardId, x: number, y: number, type: 'floor' | 'wall', startBoard: BoardId): Result {
  let next = copy(world)
  const occupant = occupantAt(next, { board: boardId, x, y })
  if (type === 'wall' && occupant !== undefined) {
    const removed = deletePiece(next, occupant, startBoard)
    if (removed instanceof EditError) return removed
    next = removed
  }
  const cell = next.boards[boardId].cells[y][x]
  cell.type = type
  if (type === 'wall') delete cell.requirement // a wall can never hold a goal
  return next
}

export function toggleGoal(world: World, boardId: BoardId, x: number, y: number, requirement: Requirement): Result {
  const next = copy(world)
  const cell = next.boards[boardId].cells[y][x]
  if (cell.type === 'wall') return new EditError('墙上不能放目标')
  if (cell.requirement === requirement) delete cell.requirement
  else cell.requirement = requirement
  return next
}

export function clearCell(world: World, boardId: BoardId, x: number, y: number, startBoard: BoardId): Result {
  let next: Result = world
  const occupant = occupantAt(world, { board: boardId, x, y })
  if (occupant !== undefined && occupant !== PLAYER_ID) next = deletePiece(world, occupant, startBoard)
  if (next instanceof EditError) return next
  const out = copy(next)
  out.boards[boardId].cells[y][x] = { type: 'floor' }
  return out
}

// Puts `piece` at the cell, replacing whatever piece was there (never the player). A container
// whose boardRef names a board that does not exist yet gets a fresh empty one of `newBoardSize`.
export function placePiece(world: World, boardId: BoardId, x: number, y: number, piece: Piece, startBoard: BoardId, newBoardSize = 5): Result {
  let next: Result = copy(world)
  if (next.boards[boardId].cells[y][x].type === 'wall') next.boards[boardId].cells[y][x] = { type: 'floor' }
  const occupant = occupantAt(next, { board: boardId, x, y })
  if (occupant === PLAYER_ID) return new EditError('这里是玩家,先把玩家移走')
  if (occupant !== undefined) {
    next = deletePiece(next, occupant, startBoard)
    if (next instanceof EditError) return next
    next = copy(next)
  }
  if (piece.boardRef !== undefined && next.boards[piece.boardRef] === undefined) next.boards[piece.boardRef] = makeBoard(piece.boardRef, newBoardSize)
  next.pieces[piece.id] = piece
  next.locations[piece.id] = { board: boardId, x, y }
  return next
}

export function movePlayer(world: World, boardId: BoardId, x: number, y: number, startBoard: BoardId): Result {
  let next: Result = copy(world)
  const occupant = occupantAt(next, { board: boardId, x, y })
  if (occupant === PLAYER_ID) return next
  if (occupant !== undefined) {
    next = deletePiece(next, occupant, startBoard)
    if (next instanceof EditError) return next
    next = copy(next)
  }
  if (next.boards[boardId].cells[y][x].type === 'wall') next.boards[boardId].cells[y][x] = { type: 'floor' }
  next.locations[PLAYER_ID] = { board: boardId, x, y }
  return collectGarbage(next, startBoard)
}

// Changes a piece's properties. `undefined` values remove the property.
export function updatePiece(world: World, pieceId: PieceId, patch: Partial<Piece>, startBoard: BoardId): Result {
  const next = copy(world)
  const piece: Piece = { ...next.pieces[pieceId], ...patch }
  for (const key of Object.keys(piece) as (keyof Piece)[]) if (piece[key] === undefined) delete piece[key]
  if (piece.kind === 'normal') delete piece.boardRef
  if (piece.boardRef !== undefined && next.boards[piece.boardRef] === undefined) next.boards[piece.boardRef] = makeBoard(piece.boardRef, 5)
  next.pieces[pieceId] = piece
  return collectGarbage(next, startBoard)
}

export function updateBoard(world: World, boardId: BoardId, patch: Partial<Pick<Board, 'color' | 'floatInSpace'>>): Result {
  const next = copy(world)
  const board = { ...next.boards[boardId], ...patch }
  if (board.color === undefined) delete board.color
  if (!board.floatInSpace) delete board.floatInSpace
  next.boards[boardId] = board
  return next
}

// Grows or shrinks a board, keeping its top-left corner. Pieces outside the new size are
// removed (refused if that includes the player).
export function resizeBoard(world: World, boardId: BoardId, size: number, startBoard: BoardId): Result {
  if (size < 1 || size > 30) return new EditError('大小要在 1 到 30 之间')
  let next: Result = copy(world)
  for (const [id, loc] of Object.entries(next.locations)) {
    if (loc.board !== boardId || (loc.x < size && loc.y < size)) continue
    if (id === PLAYER_ID) return new EditError('玩家会在新范围外面,先移动玩家')
    next = deletePiece(next, id, startBoard)
    if (next instanceof EditError) return next
  }
  next = copy(next)
  const old = next.boards[boardId]
  next.boards[boardId] = {
    ...old,
    size,
    cells: Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x): Cell => (y < old.size && x < old.size ? old.cells[y][x] : { type: 'floor' }))),
  }
  return next
}

export function setAttemptOrder(world: World, order: World['attemptOrder']): World {
  const next = copy(world)
  if (order === undefined) delete next.attemptOrder
  else next.attemptOrder = order
  return next
}
