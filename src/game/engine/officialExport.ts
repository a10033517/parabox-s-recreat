import { Board, BoardId, PLAYER_ID, Piece, VOID_BOARD_ID, World } from './types'

// Exporter to the official Custom Levels text format (version 4): the inverse of
// parseOfficialLevel (officialFormat.ts), covering every field that importer reads — colours,
// Ref exitblock / infexit / infenter, fliph, possessable, a player that is itself a box,
// possessable / player Walls, floating Blocks and the attempt_order header.
//
//   Block x y id w h hue sat val zoom fillwithwalls player possessable playerorder fliph floatinspace specialeffect
//   Ref   x y id exitblock infexit infexitnum infenter infenternum infenterid player possessable playerorder fliph floatinspace specialeffect
//   Wall  x y player possessable playerorder
//
// Things the official format cannot express are reported in `warnings` (and approximated).

export interface OfficialExport {
  text: string
  warnings: string[]
}

const f = (n: number) => String(Math.round(n * 1000) / 1000)

// #rrggbb -> [hue, sat, val] in 0..1 (the inverse of officialFormat's blockColor).
export function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  return [h, max === 0 ? 0 : d / max, max]
}

const hsvOf = (color: string | undefined, fallback: [number, number, number]) => (color === undefined ? fallback : hexToHsv(color))
const DEFAULT_BLOCK_HSV: [number, number, number] = [0.6, 0.8, 1]
const DEFAULT_BOX_HSV: [number, number, number] = [0.1, 0.8, 1]
const DEFAULT_PLAYER_HSV: [number, number, number] = [0.9, 1, 0.7]
const DEFAULT_ROOT_HSV: [number, number, number] = [0.6, 0, 0.8]

// The board the file's top-level Block describes: the one no box leads into (an ordinary
// level), otherwise the player's board (a level that contains itself).
export function exportRootBoard(world: World): BoardId {
  const owned = new Set(Object.values(world.pieces).map((p) => p.boardRef).filter((b): b is BoardId => b !== undefined))
  const orphan = Object.keys(world.boards).find((id) => id !== VOID_BOARD_ID && !owned.has(id))
  return orphan ?? world.locations[PLAYER_ID].board
}

export function exportOfficialLevel(world: World): OfficialExport {
  const warnings: string[] = []
  const root = exportRootBoard(world)
  const boards = Object.keys(world.boards).filter((id) => id !== VOID_BOARD_ID && !id.startsWith('epsilon:'))

  // Block ids: keep the number of an imported "b<n>" board, number the rest after them.
  const blockId = new Map<BoardId, number>()
  const used = new Set<number>()
  for (const id of boards) {
    const m = /^b(\d+)$/.exec(id)
    if (m && !used.has(Number(m[1]))) {
      blockId.set(id, Number(m[1]))
      used.add(Number(m[1]))
    }
  }
  let next = 0
  const fresh = () => {
    while (used.has(next)) next++
    used.add(next)
    return next
  }
  for (const id of boards) if (!blockId.has(id)) blockId.set(id, fresh())

  // Which piece is written as the Block (the original) of each board; every other piece
  // leading into that board becomes a Ref. The root is the top-level Block itself.
  const instances = (board: BoardId) =>
    Object.values(world.pieces).filter((p) => p.boardRef === board && p.cloneOf === undefined && world.locations[p.id] !== undefined)
  const blockPiece = new Map<BoardId, Piece>()
  for (const board of boards) {
    if (board === root) continue
    const player = world.pieces[PLAYER_ID]
    if (player?.boardRef === board) {
      blockPiece.set(board, player) // a player that is a box is always the Block of its room
      continue
    }
    const candidates = instances(board).filter(
      (p) => world.locations[p.id].board !== board && !p.exitBlock && !p.infExit && !p.infEnter && p.kind === 'container',
    )
    const preferred = candidates.find((p) => p.id === `p${blockId.get(board)}`) ?? candidates.sort((a, b) => a.id.localeCompare(b.id))[0]
    if (preferred !== undefined) blockPiece.set(board, preferred)
  }

  const lines: string[] = ['version 4']
  if (world.attemptOrder !== undefined) lines.push(`attempt_order ${[...world.attemptOrder, 'possess'].join(',')}`)
  lines.push('#')

  const yOf = (board: Board, y: number) => board.size - 1 - y
  const written = new Set<BoardId>()

  const blockLine = (x: number, y: number, board: Board, hsv: [number, number, number], flags: { fill?: boolean; player?: boolean; possessable?: boolean; fliph?: boolean; float?: boolean }) =>
    `Block ${x} ${y} ${blockId.get(board.id)} ${board.size} ${board.size} ${f(hsv[0])} ${f(hsv[1])} ${f(hsv[2])} ${board.zoomFactor ?? 1} ${flags.fill ? 1 : 0} ${flags.player ? 1 : 0} ${flags.possessable ? 1 : 0} 0 ${flags.fliph ? 1 : 0} ${flags.float ? 1 : 0} 0`

  const emitBoardContents = (board: Board, indent: string) => {
    written.add(board.id)
    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const cell = board.cells[y][x]
        if (cell.type === 'wall') lines.push(`${indent}Wall ${x} ${yOf(board, y)} 0 0 0`)
        if (cell.requirement === 'box') lines.push(`${indent}Floor ${x} ${yOf(board, y)} Button`)
        if (cell.requirement === 'player') lines.push(`${indent}Floor ${x} ${yOf(board, y)} PlayerButton`)
      }
    }
    const here = Object.values(world.pieces)
      .filter((p) => world.locations[p.id]?.board === board.id)
      .sort((a, b) => a.id.localeCompare(b.id))
    for (const piece of here) emitPiece(piece, board, indent)
  }

  const emitPiece = (piece: Piece, board: Board, indent: string) => {
    const loc = world.locations[piece.id]
    const x = loc.x
    const y = yOf(board, loc.y)
    if (piece.wall) {
      lines.push(`${indent}Wall ${x} ${y} ${piece.kind === 'player' ? 1 : 0} ${piece.possessable ? 1 : 0} 0`)
      return
    }
    let target = piece.boardRef
    if (piece.cloneOf !== undefined) {
      const source = world.pieces[piece.cloneOf]
      target = source?.boardRef
      if (target === undefined) {
        warnings.push(`${piece.id}: a clone of a plain box has no official equivalent; written as a solid box`)
        lines.push(`${indent}Block ${x} ${y} ${fresh()} 1 1 ${DEFAULT_BOX_HSV.map(f).join(' ')} 1 1 0 0 0 0 0 0`)
        return
      }
    }
    if (target === undefined) {
      // A solid block: a box or a plain player.
      const isPlayer = piece.kind === 'player'
      const hsv = hsvOf(piece.color, isPlayer ? DEFAULT_PLAYER_HSV : DEFAULT_BOX_HSV)
      const m = /^box(\d+)$/.exec(piece.id)
      const id = m && !used.has(Number(m[1])) ? (used.add(Number(m[1])), Number(m[1])) : fresh()
      lines.push(`${indent}Block ${x} ${y} ${id} 1 1 ${f(hsv[0])} ${f(hsv[1])} ${f(hsv[2])} 1 1 ${isPlayer ? 1 : 0} ${piece.possessable ? 1 : 0} 0 ${piece.fliph ? 1 : 0} 0 0`)
      return
    }
    const targetBoard = world.boards[target]
    if (blockPiece.get(target) === piece && !written.has(target)) {
      const hsv = hsvOf(targetBoard.color ?? piece.color, piece.kind === 'player' ? DEFAULT_PLAYER_HSV : DEFAULT_BLOCK_HSV)
      lines.push(`${indent}${blockLine(x, y, targetBoard, hsv, { player: piece.kind === 'player', possessable: piece.possessable, fliph: piece.fliph })}`)
      emitBoardContents(targetBoard, indent + '\t')
      return
    }
    lines.push(
      `${indent}Ref ${x} ${y} ${blockId.get(target)} ${piece.exitBlock ? 1 : 0} ${piece.infExit ? 1 : 0} ${piece.infExitNum ?? 0} ${piece.infEnter ? 1 : 0} ${piece.infEnterNum ?? 0} ${piece.infEnterId ?? -1} ${piece.kind === 'player' ? 1 : 0} ${piece.possessable ? 1 : 0} 0 ${piece.fliph ? 1 : 0} 0 0`,
    )
  }

  const rootBoard = world.boards[root]
  lines.push(blockLine(-1, -1, rootBoard, hsvOf(rootBoard.color, DEFAULT_ROOT_HSV), {}))
  emitBoardContents(rootBoard, '\t')

  // Boards that no Block wrote yet (only reachable through Refs, or floating): written as
  // floating Blocks inside the root, where the format keeps definitions with no outer level.
  for (let pending = boards.filter((b) => !written.has(b)); pending.length > 0; pending = boards.filter((b) => !written.has(b))) {
    const board = world.boards[pending[0]]
    lines.push(`\t${blockLine(0, 0, board, hsvOf(board.color, DEFAULT_BLOCK_HSV), { float: true })}`)
    emitBoardContents(board, '\t\t')
  }

  return { text: lines.join('\n') + '\n', warnings }
}
