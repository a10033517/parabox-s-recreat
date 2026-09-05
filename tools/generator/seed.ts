import {
  Cell, Direction, PLAYER_ID, World,
  step, opposite,
} from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'

// A 2x2 grid of slots (square, so GRID_COLS alone determines ROOT_SIZE —
// groupCount is always 3 or 4, and ceil(3/GRID_COLS) === ceil(4/GRID_COLS)
// === 2 rows for GRID_COLS=2, so the board never needs to vary in size).
const GRID_COLS = 2
const SLOT_SIZE = 5
const ROOT_SIZE = 2 + GRID_COLS * SLOT_SIZE // = 12
const INTERIOR_SIZES = [3, 5]
const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function makeFloorCells(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const })))
}

// A group's identity as constructed by the seed. `boxId` is needed (not
// just `containerId`) so computeTouchedGroups can recognize the group as
// touched via either piece. `interiorId` is needed so removeGroup knows
// which board (and everything located on it) to delete when a group
// turns out to be untouched.
export interface SeedGroup {
  containerId: string
  boxId: string
  interiorId: string
  originalPosition: { x: number; y: number }
}

export interface SeedResult {
  world: World
  groups: SeedGroup[]
}

export function createSeedWorld(rng: () => number = Math.random): SeedResult {
  const groupCount = 3 + Math.floor(rng() * 2) // 3 or 4

  const cells: Cell[][] = Array.from({ length: ROOT_SIZE }, (_, y) =>
    Array.from({ length: ROOT_SIZE }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === ROOT_SIZE - 1 || y === ROOT_SIZE - 1
      return { type: isBorder ? 'wall' : 'floor' } as Cell
    }),
  )

  const boards: World['boards'] = {}
  const pieces: World['pieces'] = { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } }
  const locations: World['locations'] = {}
  const groups: SeedGroup[] = []

  for (let i = 0; i < groupCount; i++) {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS
    const slotOriginX = 1 + col * SLOT_SIZE
    const slotOriginY = 1 + row * SLOT_SIZE
    const center = Math.floor(SLOT_SIZE / 2) // = 2
    const containerX = slotOriginX + center
    const containerY = slotOriginY + center

    const wallDir = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]
    const wallPos = step(containerX, containerY, wallDir)
    cells[wallPos.y][wallPos.x] = { type: 'wall' }
    cells[containerY][containerX] = { type: 'floor', requirement: 'box' }

    const interiorSize = INTERIOR_SIZES[Math.floor(rng() * INTERIOR_SIZES.length)]
    const interiorId = `goal${i}Inside`
    const containerId = `goal${i}`
    const boxId = `box${i}`

    boards[interiorId] = { id: interiorId, size: interiorSize, cells: makeFloorCells(interiorSize) }
    pieces[containerId] = { id: containerId, kind: 'container', boardRef: interiorId }
    pieces[boxId] = { id: boxId, kind: 'normal' }
    locations[containerId] = { board: 'root', x: containerX, y: containerY }

    const { cell: eatenCell } = getEntryCell(boards[interiorId], opposite(wallDir), HALF)
    if (eatenCell === null) {
      // Provably unreachable: HALF always maps to an in-bounds
      // center-of-edge cell for any board size >= 1. A loud failure here
      // is a construction-time bug, not a runtime condition to swallow.
      throw new Error(`createSeedWorld: getEntryCell unexpectedly returned null for interior size ${interiorSize}`)
    }
    locations[boxId] = { board: interiorId, x: eatenCell.x, y: eatenCell.y }

    groups.push({ containerId, boxId, interiorId, originalPosition: { x: containerX, y: containerY } })
  }

  boards.root = { id: 'root', size: ROOT_SIZE, cells }
  // Slot (0,0)'s container sits at (1+2, 1+2) = (3,3); the player goes at
  // (2,2) — 2 cells from every board edge and off the diagonal from the
  // container, so it never coincides with that group's wall regardless
  // of which of the 4 directions was randomly chosen for it.
  locations[PLAYER_ID] = { board: 'root', x: 2, y: 2 }

  return { world: { boards, pieces, locations }, groups }
}
