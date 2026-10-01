import { Attempt, Board, BoardId, Cell, Location, PLAYER_ID, Piece, PieceId, World } from './types'
import { parseLevel } from './levelSchema'

// Importer for the official Custom Levels text format (version 4) — a SUBSET: square
// blocks, Wall / Floor (Button, PlayerButton), solid boxes (fillwithwalls), the player,
// Refs, floatinspace, exitblock and the infexit / infenter metadata.
//
//   official format  ->  loader normalization  ->  this engine's own World
//
// The official file is only a compatibility layer. Two passes: (1) tokenize into a tree,
// keeping every Ref target as a raw id; (2) resolve targets and build the World. Nothing is
// resolved while reading, so a Ref may appear before or after the Block it points at.
//
// Mapping (engine model in parentheses):
//   Block                    -> board "b<id>" (Definition) + a container piece "p<id>" (Ref instance)
//   Block floatinspace=1     -> board only, NO placed piece: it has no outer level
//   Ref -> any Block         -> container sharing board "b<targetId>" (a second instance of that
//                               Definition — includes a Ref to its OWN containing Block: a
//                               self-loop). The official format has no separate "clone" field:
//                               a Ref's `id` always names a Board definition, never a piece, so
//                               this is uniformly "2 Ref -> same Definition", never a cloneOf
//                               redirect (confirmed against real third-party example levels for
//                               iwVerve/Parafox — see officialFormat.test.ts).
//   Block fillwithwalls=1    -> solid box (kind "normal");  player=1 -> the player
//   Ref infenter/exitblock   -> stored on the piece (raw degree / id), matched by the engine's resolver
// y axis: the file counts y UP from the bottom row, so the importer flips it by default (flipY
// defaults to true; verified 2026-09-24 against a real-game screenshot of order_elbow_push).
// UNVERIFIED: how `infenterid` is looked up (only the block id is used).

export interface OfficialImportOptions {
  flipY?: boolean
}

interface Node {
  kind: 'Block' | 'Ref' | 'Wall' | 'Floor'
  f: string[] // raw fields, exactly as written
  children: Node[]
  line: number
}

const KINDS = new Set(['Block', 'Ref', 'Wall', 'Floor'])

// ---- Pass 1: text -> tree ---------------------------------------------------
function tokenize(text: string): { header: string[]; roots: Node[] } {
  const lines = text.split(/\r?\n/)
  const header: string[] = []
  let i = 0
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '#') { i++; break }
    if (lines[i].trim() !== '') header.push(lines[i].trim())
  }
  const roots: Node[] = []
  const stack: { indent: number; node: Node }[] = []
  for (; i < lines.length; i++) {
    const raw = lines[i]
    if (raw.trim() === '') continue
    const indent = raw.length - raw.trimStart().length
    const [kind, ...f] = raw.trim().split(/\s+/)
    if (!KINDS.has(kind)) throw new Error(`Line ${i + 1}: unknown object "${kind}"`)
    const node: Node = { kind: kind as Node['kind'], f, children: [], line: i + 1 }
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].node.children.push(node)
    stack.push({ indent, node })
  }
  return { header, roots }
}

function num(node: Node, index: number, name: string): number {
  const raw = node.f[index]
  const n = Number(raw)
  if (raw === undefined || Number.isNaN(n)) throw new Error(`Line ${node.line}: ${node.kind} field "${name}" is missing or not a number`)
  return n
}
const flag = (node: Node, index: number, name: string) => num(node, index, name) === 1

// Official field positions.
const BLOCK = { x: 0, y: 1, id: 2, w: 3, h: 4, hue: 5, sat: 6, val: 7, zoom: 8, fill: 9, player: 10, possessable: 11, fliph: 13, float: 14 }
const REF = { x: 0, y: 1, id: 2, exit: 3, infExit: 4, infExitNum: 5, infEnter: 6, infEnterNum: 7, infEnterId: 8, possessable: 10, fliph: 12 }
const WALL = { x: 0, y: 1, player: 2, possessable: 3 }
// A flag that older / shorter lines may omit: missing means 0.
const optFlag = (node: Node, index: number) => node.f[index] !== undefined && Number(node.f[index]) === 1

interface BlockInfo { node: Node; id: number; floating: boolean }

// ---- Pass 2: tree -> World ------------------------------------------------------
export function parseOfficialLevel(text: string, options: OfficialImportOptions = {}): World {
  const { header, roots } = tokenize(text)
  if (!header.some((h) => h === 'version 4')) throw new Error('Only official level format "version 4" is supported')
  const rootBlocks = roots.filter((n) => n.kind === 'Block')
  if (rootBlocks.length !== 1) throw new Error(`Expected exactly one top-level Block, found ${rootBlocks.length}`)

  // Index every Block by its official id (first pass over the whole tree).
  const blocks = new Map<number, BlockInfo>()
  const index = (node: Node) => {
    if (node.kind === 'Block') {
      const id = num(node, BLOCK.id, 'id')
      if (blocks.has(id)) throw new Error(`Line ${node.line}: duplicate Block id ${id}`)
      blocks.set(id, { node, id, floating: flag(node, BLOCK.float, 'floatinspace') })
    }
    node.children.forEach(index)
  }
  roots.forEach(index)

  const world: World = { boards: {}, pieces: {}, locations: {} }
  const attempt = header.find((h) => h.startsWith('attempt_order '))
  if (attempt !== undefined) {
    const order = attempt.slice('attempt_order '.length).split(',').map((s) => s.trim()).filter((s) => s !== 'possess')
    const valid = order.length === 3 && new Set(order).size === 3 && order.every((a) => a === 'push' || a === 'enter' || a === 'eat')
    if (!valid) throw new Error(`Unsupported attempt_order "${attempt}"`)
    world.attemptOrder = order as Attempt[]
  }

  let refCounter = 0
  let wallCounter = 0
  const yOf = (size: number, y: number) => (options.flipY ?? true ? size - 1 - y : y)

  const emitBoard = (info: BlockInfo) => {
    const width = num(info.node, BLOCK.w, 'width')
    const height = num(info.node, BLOCK.h, 'height')
    if (width !== height) throw new Error(`Line ${info.node.line}: Block ${info.id} is ${width}x${height}; this engine only supports square blocks`)
    const size = width
    const boardId: BoardId = `b${info.id}`
    const cells: Cell[][] = Array.from({ length: size }, () => Array.from({ length: size }, (): Cell => ({ type: 'floor' })))
    const board: Board = { id: boardId, size, cells, color: blockColor(info.node) }
    const zoom = num(info.node, BLOCK.zoom, 'zoomfactor')
    if (zoom !== 1) board.zoomFactor = zoom
    if (info.floating) board.floatInSpace = true
    world.boards[boardId] = board

    const place = (id: PieceId, piece: Piece, node: Node) => {
      const x = num(node, 0, 'x')
      const y = yOf(size, num(node, 1, 'y'))
      const loc: Location = { board: boardId, x, y }
      world.pieces[id] = piece
      world.locations[id] = loc
    }

    for (const child of info.node.children) {
      if (child.kind === 'Wall') {
        const isPlayer = optFlag(child, WALL.player)
        const possessable = optFlag(child, WALL.possessable)
        if (isPlayer || possessable) {
          // A possessable (or player) Wall is a wall BLOCK: it stays put like a wall until the
          // player possesses it, then it moves as the player.
          const id = isPlayer ? PLAYER_ID : `wall${wallCounter++}`
          const piece: Piece = { id, kind: isPlayer ? 'player' : 'normal', wall: true }
          if (possessable) piece.possessable = true
          place(id, piece, child)
        } else {
          cells[yOf(size, num(child, 1, 'y'))][num(child, 0, 'x')] = { type: 'wall' }
        }
      } else if (child.kind === 'Floor') {
        const type = child.f[2]
        const x = num(child, 0, 'x')
        const y = yOf(size, num(child, 1, 'y'))
        if (type === 'Button') cells[y][x] = { ...cells[y][x], requirement: 'box' }
        else if (type === 'PlayerButton') cells[y][x] = { ...cells[y][x], requirement: 'player' }
        else throw new Error(`Line ${child.line}: unsupported Floor type "${type}"`)
      } else if (child.kind === 'Block') {
        const childInfo = blocks.get(num(child, BLOCK.id, 'id')) as BlockInfo
        if (flag(child, BLOCK.player, 'player')) {
          const player: Piece = { id: PLAYER_ID, kind: 'player', color: blockColor(child) }
          if (optFlag(child, BLOCK.possessable)) player.possessable = true
          // A player Block WITHOUT fillwithwalls is itself a box: it has an interior that other
          // blocks can be pushed into / eaten into, like any container.
          if (!flag(child, BLOCK.fill, 'fillwithwalls')) {
            player.boardRef = `b${childInfo.id}`
            emitBoard(childInfo)
          }
          place(PLAYER_ID, player, child)
        } else if (flag(child, BLOCK.fill, 'fillwithwalls')) {
          const box: Piece = { id: `box${childInfo.id}`, kind: 'normal', color: blockColor(child) }
          if (optFlag(child, BLOCK.possessable)) box.possessable = true
          place(box.id, box, child)
        } else if (childInfo.floating) {
          emitBoard(childInfo) // no outer level: a definition with no placed instance
        } else {
          const id = `p${childInfo.id}`
          const piece: Piece = { id, kind: 'container', boardRef: `b${childInfo.id}` }
          if (flag(child, BLOCK.fliph, 'fliph')) piece.fliph = true
          if (optFlag(child, BLOCK.possessable)) piece.possessable = true
          place(id, piece, child)
          emitBoard(childInfo)
        }
      } else if (child.kind === 'Ref') {
        const targetId = num(child, REF.id, 'id')
        const infEnter = flag(child, REF.infEnter, 'infenter')
        const target = blocks.get(targetId)
        if (target === undefined) {
          throw new Error(`Line ${child.line}: Ref points at Block ${targetId}, which is not defined${infEnter ? ' (an infenter Ref needs a target)' : ''}`)
        }
        if (infEnter && !target.floating) {
          throw new Error(`Line ${child.line}: infenter Ref must target a floating Block (floatinspace=1); Block ${targetId} is not floating`)
        }
        const id = `ref${refCounter++}`
        // The official format has no separate "clone" field: a Ref's own `id` always names a
        // Block/Board DEFINITION (never a placed piece), so it is always modeled as sharing that
        // definition's board — exactly the "2 Ref -> same Definition" shape the Definition/
        // Instance layer already supports (instancesOf / findContainerFor's canonical exit).
        // This also covers a Ref targeting its OWN containing Block (self-loop): the target's
        // board is `b<targetId>` regardless of whether targetId is the root, which never has a
        // placed piece of its own (cloneOf: 'p<rootId>' would point at a piece that never
        // exists — confirmed broken against a real self-loop/infinite-exit example file from
        // the Parafox editor's own test levels, see officialFormat.test.ts).
        const piece: Piece = { id, kind: 'container', boardRef: `b${targetId}` }
        if (flag(child, REF.fliph, 'fliph')) piece.fliph = true
        if (optFlag(child, REF.possessable)) piece.possessable = true
        if (flag(child, REF.exit, 'exitblock')) piece.exitBlock = true
        if (flag(child, REF.infExit, 'infexit')) { piece.infExit = true; piece.infExitNum = num(child, REF.infExitNum, 'infexitnum') }
        if (infEnter) {
          piece.infEnter = true
          piece.infEnterNum = num(child, REF.infEnterNum, 'infenternum')
          piece.infEnterId = num(child, REF.infEnterId, 'infenterid') // raw: lookup layer is VERIFY
        }
        place(id, piece, child)
      }
    }
  }

  // A block's hue / sat / val (each 0..1, HSV) -> #rrggbb.
  const blockColor = (node: Node): string => {
    const h = num(node, BLOCK.hue, 'hue'), sat = num(node, BLOCK.sat, 'sat'), v = num(node, BLOCK.val, 'val')
    const f = (n: number) => {
      const k = (n + h * 6) % 6
      return v - v * sat * Math.max(0, Math.min(k, 4 - k, 1))
    }
    const hex = (c: number) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')
    return '#' + hex(f(5)) + hex(f(3)) + hex(f(1))
  }

  emitBoard(blocks.get(num(rootBlocks[0], BLOCK.id, 'id')) as BlockInfo)
  return parseLevel(world) // structural validation with the engine's own rules
}

// ---- Infinite Enter registry ------------------------------------------------------
export interface InfiniteEnterEntry {
  refId: PieceId
  degree: number | undefined
  levelId: number | undefined // raw `infenterid`
  floatingBoard: BoardId | undefined // the floating Block the Ref leads into
  isExitBlock: boolean
}

// The one place that lists a level's authored Infinite Enter destinations, so the generator,
// the simulation and the renderer never scan the whole world for them.
export function infiniteEnterRegistry(world: World): InfiniteEnterEntry[] {
  return Object.values(world.pieces)
    .filter((p) => p.infEnter === true)
    .map((p) => ({
      refId: p.id,
      degree: p.infEnterNum,
      levelId: p.infEnterId,
      floatingBoard: p.boardRef !== undefined && world.boards[p.boardRef]?.floatInSpace === true ? p.boardRef : undefined,
      isExitBlock: p.exitBlock === true,
    }))
    .sort((a, b) => a.refId.localeCompare(b.refId))
}
