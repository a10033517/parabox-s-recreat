import { Board, BoardId, PLAYER_ID, Piece, World, findContainerFor, instancesOf, targetDefinitionOf } from '../../src/game/engine/types'

// Exports a World to the official Custom Levels text format (version 4) so the same
// scenario can be loaded in the ORIGINAL game and replayed with the same inputs.
// Format source: https://www.patricksparabox.com/custom-levels/ (field lists only).
//
// UNVERIFIED against the game (the doc does not state them): the y axis direction
// (use flipY), how a player block must be shaped, and tab-vs-space child
// indentation. Load case 1 first and confirm before trusting the rest.

export interface ExportOptions {
  flipY?: boolean
}

// Distinct palette-B..F style hues so each definition is recognizable on screen.
const HUES = [0.6, 0.4, 0.55, 0.1, 0.9, 0.75, 0.25]

export function exportOfficial(world: World, rootBoardId: BoardId, options: ExportOptions = {}): string {
  const blockIds = new Map<BoardId, number>()
  Object.keys(world.boards).forEach((id, i) => blockIds.set(id, i))
  let nextBlockId = blockIds.size
  const lines: string[] = ['version 4', '#']

  const yOf = (board: Board, y: number) => (options.flipY ?? true ? board.size - 1 - y : y)
  const hueOf = (boardId: BoardId) => HUES[(blockIds.get(boardId) as number) % HUES.length]

  function emitPiece(piece: Piece, board: Board, indent: string) {
    const loc = world.locations[piece.id]
    const x = loc.x
    const y = yOf(board, loc.y)
    const target = targetDefinitionOf(world, piece)
    if (piece.kind === 'container' && target !== undefined) {
      const isCanonicalBlock =
        piece.cloneOf === undefined && target !== rootBoardId && findContainerFor(world, target) === piece.id
      const id = blockIds.get(target) as number
      const flip = piece.fliph ? 1 : 0
      if (isCanonicalBlock) {
        const inner = world.boards[target]
        lines.push(`${indent}Block ${x} ${y} ${id} ${inner.size} ${inner.size} ${hueOf(target)} 0.8 1 1 0 0 0 0 ${flip} 0 0`)
        emitBoard(inner, indent + '\t')
      } else {
        lines.push(`${indent}Ref ${x} ${y} ${id} 0 0 0 0 0 -1 0 0 0 ${flip} 0 0`)
      }
      return
    }
    const id = nextBlockId++
    if (piece.kind === 'player') {
      lines.push(`${indent}Block ${x} ${y} ${id} 1 1 0.9 0.8 1 1 0 1 0 0 0 0 0`)
    } else {
      lines.push(`${indent}Block ${x} ${y} ${id} 1 1 0.1 0.8 1 1 1 0 0 0 0 0 0`) // solid box (fillwithwalls)
    }
  }

  function emitBoard(board: Board, indent: string) {
    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const cell = board.cells[y][x]
        if (cell.type === 'wall') lines.push(`${indent}Wall ${x} ${yOf(board, y)} 0 0 0`)
        if (cell.requirement === 'box') lines.push(`${indent}Floor ${x} ${yOf(board, y)} Button`)
        if (cell.requirement === 'player') lines.push(`${indent}Floor ${x} ${yOf(board, y)} PlayerButton`)
      }
    }
    for (const piece of Object.values(world.pieces).sort((a, b) => a.id.localeCompare(b.id))) {
      if (world.locations[piece.id].board === board.id) emitPiece(piece, board, indent)
    }
  }

  const root = world.boards[rootBoardId]
  const rootId = blockIds.get(rootBoardId)
  // The engine treats the edge of a board that NO Ref owns (the root) as solid: nothing lies
  // beyond it. The original has no such implicit boundary — an unwalled root edge opens onto
  // the Void — so a sealed root is wrapped in a walled 3x3 Block with the root box in the
  // middle cell: leaving the root's edge then hits a wall (blocked), like a real level.
  // A root that some Ref owns (self-loop) keeps open edges: leaving it climbs, as in the engine.
  if (instancesOf(world, rootBoardId).length === 0) {
    const wrapperId = nextBlockId++
    lines.push(`Block 0 0 ${wrapperId} 3 3 0 0 1 1 0 0 0 0 0 0 0`)
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (x !== 1 || y !== 1) lines.push(`\tWall ${x} ${y} 0 0 0`)
    lines.push(`\tBlock 1 1 ${rootId} ${root.size} ${root.size} 0 0 1 1 0 0 0 0 0 0 0`)
    emitBoard(root, '\t\t')
  } else {
    lines.push(`Block 0 0 ${rootId} ${root.size} ${root.size} 0 0 1 1 0 0 0 0 0 0 0`)
    emitBoard(root, '\t')
  }
  return lines.join('\n') + '\n'
}

export { PLAYER_ID }
