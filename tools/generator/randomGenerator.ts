import { Board, Cell, Direction, PLAYER_ID, World, inBounds, occupantAt, step } from '../../src/game/engine/types'

// Every randomizable range/probability the design spec's §4/§9 calls for.
// Starting values live in generatorConfig.ts, not here — this module is
// pure generation logic, agnostic to what the numbers actually are.
export interface RandomGeneratorConfig {
  widthRange: [number, number]
  heightRange: [number, number]
  wallDensityRange: [number, number]
  boxCountRange: [number, number]
  containerProbability: number
  crossBoardGoalProbability: number
  interiorSizeRange: [number, number]
  maxNestingDepth: number
}

export interface GeneratedCandidate {
  world: World
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

function randFloat(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

function makeBoard(id: string, size: number, wallDensity: number, rng: () => number): Board {
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x): Cell => {
      const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1
      if (isBorder) return { type: 'wall' }
      return { type: rng() < wallDensity ? 'wall' : 'floor' }
    }),
  )
  return { id, size, cells }
}

// Every floor cell on a board, with no occupancy/requirement filtering —
// the raw building block unoccupiedFloorCells filters down from. Not used
// directly for placement decisions (see unoccupiedFloorCells's own
// comment for why both pieces and goals need the filtered version).
function floorCells(board: Board): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = []
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      if (board.cells[y][x].type === 'floor') cells.push({ x, y })
    }
  }
  return cells
}

// Floor cells with no current piece occupant AND no existing requirement —
// used for placing BOTH a PIECE (player/box/container: so two pieces don't
// land on the same cell, and a new piece never spawns already sitting on
// an earlier box's goal) AND a GOAL (so a goal never lands on a cell some
// piece already occupies, which would trivially pre-satisfy it — a box
// spawning on its own designated goal is one instance of this, but a box
// spawning on any OTHER already-placed piece's cell, or a goal landing on
// an already-placed different goal's cell, are the same "wasted, does
// nothing" problem — caught by hand-verifying a shipped level whose
// container turned out to be pure decoration for exactly this reason).
// This is a generator-side quality improvement, not a correctness
// requirement (basicValidator.ts still catches an overlap or a goal/box
// count mismatch if one ever slips through), matching the design brief's
// own §4 Step 4 goal of not generating "obviously illegal overlaps" even
// before validation.
function unoccupiedFloorCells(world: World, board: Board): { x: number; y: number }[] {
  return floorCells(board).filter(
    (c) =>
      occupantAt(world, { board: board.id, x: c.x, y: c.y }) === undefined &&
      board.cells[c.y][c.x].requirement === undefined,
  )
}

interface BoardEntry {
  id: string
  board: Board
  depth: number
}

export function randomGenerate(config: RandomGeneratorConfig, rng: () => number): GeneratedCandidate | null {
  const width = randInt(rng, config.widthRange[0], config.widthRange[1])
  const height = randInt(rng, config.heightRange[0], config.heightRange[1])
  const wallDensity = randFloat(rng, config.wallDensityRange[0], config.wallDensityRange[1])
  // Every board in this engine is square (Board.size) — use the larger of
  // width/height, since the design brief's own independent width/height
  // assumes a rectangular-grid engine this codebase doesn't have.
  const size = Math.max(width, height)
  const root = makeBoard('root', size, wallDensity, rng)

  const world: World = { boards: { root }, pieces: {}, locations: {} }
  world.pieces[PLAYER_ID] = { id: PLAYER_ID, kind: 'player' }

  const rootPlacementCells = unoccupiedFloorCells(world, root)
  if (rootPlacementCells.length === 0) return null
  const playerCell = rootPlacementCells[randInt(rng, 0, rootPlacementCells.length - 1)]
  world.locations[PLAYER_ID] = { board: 'root', x: playerCell.x, y: playerCell.y }

  const boards: BoardEntry[] = [{ id: 'root', board: root, depth: 0 }]
  let interiorCounter = 0
  let containerCounter = 0
  const boxCount = randInt(rng, config.boxCountRange[0], config.boxCountRange[1])

  for (let i = 0; i < boxCount; i++) {
    const boxId = `box${i}`
    const belowMaxDepth = boards.filter((b) => b.depth < config.maxNestingDepth)
    let homeBoardId: string

    if (belowMaxDepth.length > 0 && rng() < config.containerProbability) {
      const parent = belowMaxDepth[randInt(rng, 0, belowMaxDepth.length - 1)]
      const parentCells = unoccupiedFloorCells(world, parent.board)
      if (parentCells.length === 0) return null
      const containerCell = parentCells[randInt(rng, 0, parentCells.length - 1)]

      // Container-blockability fact (see the design spec §3/§5): a
      // container with open floor on all 4 sides can only ever be pushed,
      // never entered (resolveBlocked tries pushing the container further
      // BEFORE trying to enter it). Force a wall directly behind it in one
      // random direction so it's always enterable from at least that side.
      const blockDir = DIRECTIONS[randInt(rng, 0, DIRECTIONS.length - 1)]
      const behind = step(containerCell.x, containerCell.y, blockDir)
      if (inBounds(parent.board, behind.x, behind.y)) {
        parent.board.cells[behind.y][behind.x] = { type: 'wall' }
      } // else: the board edge already blocks it, nothing to do

      const interiorSize = randInt(rng, config.interiorSizeRange[0], config.interiorSizeRange[1])
      const interiorId = `interior${interiorCounter++}`
      const interior = makeBoard(interiorId, interiorSize, wallDensity, rng)
      world.boards[interiorId] = interior
      boards.push({ id: interiorId, board: interior, depth: parent.depth + 1 })

      const interiorCells = unoccupiedFloorCells(world, interior)
      if (interiorCells.length === 0) return null
      const boxCell = interiorCells[randInt(rng, 0, interiorCells.length - 1)]

      const containerId = `container${containerCounter++}`
      world.pieces[containerId] = { id: containerId, kind: 'container', boardRef: interiorId }
      world.locations[containerId] = { board: parent.id, x: containerCell.x, y: containerCell.y }

      world.pieces[boxId] = { id: boxId, kind: 'normal' }
      world.locations[boxId] = { board: interiorId, x: boxCell.x, y: boxCell.y }
      homeBoardId = interiorId
    } else {
      const home = boards[randInt(rng, 0, boards.length - 1)]
      const homeCells = unoccupiedFloorCells(world, home.board)
      if (homeCells.length === 0) return null
      const boxCell = homeCells[randInt(rng, 0, homeCells.length - 1)]
      world.pieces[boxId] = { id: boxId, kind: 'normal' }
      world.locations[boxId] = { board: home.id, x: boxCell.x, y: boxCell.y }
      homeBoardId = home.id
    }

    const otherBoards = boards.filter((b) => b.id !== homeBoardId)
    const goalBoardEntry =
      otherBoards.length > 0 && rng() < config.crossBoardGoalProbability
        ? otherBoards[randInt(rng, 0, otherBoards.length - 1)]
        : (boards.find((b) => b.id === homeBoardId) as BoardEntry)
    // unoccupiedFloorCells excludes every currently-occupied cell (not
    // just this box's own) and every already-placed requirement cell —
    // see its own comment for why both matter here.
    const goalCells = unoccupiedFloorCells(world, goalBoardEntry.board)
    if (goalCells.length === 0) return null
    const goalCell = goalCells[randInt(rng, 0, goalCells.length - 1)]
    goalBoardEntry.board.cells[goalCell.y][goalCell.x] = { type: 'floor', requirement: 'box' }
  }

  return { world }
}
