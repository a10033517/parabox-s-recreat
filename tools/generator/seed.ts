import {
  Cell, Direction, PLAYER_ID, World,
  step, opposite,
} from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { GENERATOR_CONFIG, SeedProfile } from './generatorConfig'

const GRID_COLS = 2
// Tried and reverted: bumping this to 7 (root=16) to lengthen moveCount via
// more travel distance made things strictly worse — a 600-attempt
// diagnostic went from 39 solved candidates down to 5, and moveCount
// actually got *shorter* (p50 5 vs 7-10), not longer: a bigger board makes
// completing a full-length reverse walk within its attempt budget harder,
// so only the simplest, shortest-traveling walks survive to become solved
// candidates at all (survivorship bias working against the intended
// effect). Left at 5 (root=12), the value this generator has actually been
// validated against.
const SLOT_SIZE = 5
const ROOT_SIZE = 2 + GRID_COLS * SLOT_SIZE // = 12
// GRID_COLS(2) x 2 rows, matching ROOT_SIZE's own derivation (groupCount is
// always 3 or 4, and ceil(3/2) === ceil(4/2) === 2 rows).
const PLAYER_START_SLOTS = 4
const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function makeFloorCells(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const })))
}

function getSlotOrigin(index: number): { x: number; y: number } {
  const row = Math.floor(index / GRID_COLS)
  const col = index % GRID_COLS
  return { x: 1 + col * SLOT_SIZE, y: 1 + row * SLOT_SIZE }
}

function getSlotCenter(index: number): { x: number; y: number } {
  const origin = getSlotOrigin(index)
  const center = Math.floor(SLOT_SIZE / 2) // = 2
  return { x: origin.x + center, y: origin.y + center }
}

// Picks the player's starting slot. When every slot hosts a group
// (groupCount === PLAYER_START_SLOTS), every slot is a "balanced access"
// candidate. When some slots are inactive (groupCount === 3), balanced
// access normally means "among the active slots" — a small, explicit
// probability instead sends the player to an inactive slot as a
// deliberate remote start, kept distinct from balanced access.
function pickPlayerSlot(rng: () => number, groupCount: number, profile: SeedProfile): number {
  if (groupCount >= PLAYER_START_SLOTS) {
    return Math.floor(rng() * PLAYER_START_SLOTS)
  }
  if (rng() < profile.remoteStartProbability) {
    const inactiveCount = PLAYER_START_SLOTS - groupCount
    return groupCount + Math.floor(rng() * inactiveCount)
  }
  return Math.floor(rng() * groupCount)
}

// A group's identity as constructed by the seed. `boxOriginalPosition` is
// the box's position on its own interior board — this is both the group's
// win condition and the one-way-door pruning check (see
// pruneUntouchedGoals.ts): nothing but a real eat move ever changes it, in
// either direction. `originalPosition` (the container's root position) is
// kept for descriptive completeness but is no longer consulted by pruning.
export interface SeedGroup {
  containerId: string
  boxId: string
  interiorId: string
  originalPosition: { x: number; y: number }
  boxOriginalPosition: { x: number; y: number }
}

export interface SeedResult {
  world: World
  groups: SeedGroup[]
}

export function createSeedWorld(
  rng: () => number = Math.random,
  profile: SeedProfile = GENERATOR_CONFIG.seedProfile,
): SeedResult {
  const groupCount = rng() < profile.fourGroupProbability ? 4 : 3
  const playerSlot = pickPlayerSlot(rng, groupCount, profile)

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
    const { x: containerX, y: containerY } = getSlotCenter(i)

    const wallDir = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]
    const wallPos = step(containerX, containerY, wallDir)
    cells[wallPos.y][wallPos.x] = { type: 'wall' }
    // No requirement on the container's own root cell — Approach A: the
    // container merely occupying its cell must never be sufficient to win.
    cells[containerY][containerX] = { type: 'floor' }

    const interiorSize = rng() < profile.largeInteriorProbability ? 5 : 3
    const interiorId = `goal${i}Inside`
    const containerId = `goal${i}`
    const boxId = `box${i}`

    const interior = { id: interiorId, size: interiorSize, cells: makeFloorCells(interiorSize) }

    const { cell: eatenCell } = getEntryCell(interior, opposite(wallDir), HALF)
    if (eatenCell === null) {
      // Provably unreachable: HALF always maps to an in-bounds
      // center-of-edge cell for any board size >= 1.
      throw new Error(`createSeedWorld: getEntryCell unexpectedly returned null for interior size ${interiorSize}`)
    }
    // The win condition for this group: a non-player piece must occupy this
    // cell. Only the pre-placed box starts here, and it can only leave via
    // a real eat move (see the full design spec's one-way-door argument).
    interior.cells[eatenCell.y][eatenCell.x] = { type: 'floor', requirement: 'box' }
    boards[interiorId] = interior

    pieces[containerId] = { id: containerId, kind: 'container', boardRef: interiorId }
    pieces[boxId] = { id: boxId, kind: 'normal' }
    locations[containerId] = { board: 'root', x: containerX, y: containerY }
    locations[boxId] = { board: interiorId, x: eatenCell.x, y: eatenCell.y }

    groups.push({
      containerId,
      boxId,
      interiorId,
      originalPosition: { x: containerX, y: containerY },
      boxOriginalPosition: { x: eatenCell.x, y: eatenCell.y },
    })
  }

  boards.root = { id: 'root', size: ROOT_SIZE, cells }
  // The player-start candidate for slot k is one cell diagonally inside the
  // slot from its center. This is always plain floor: it can never equal
  // the slot's container cell, nor any of its 4 possible wall cells (all
  // cardinal-adjacent to the center, never diagonal), and since every slot
  // occupies its own disjoint 5x5 coordinate block, it can never collide
  // with another slot's geometry either — true whether or not that slot
  // currently hosts a group.
  const { x: playerX, y: playerY } = getSlotCenter(playerSlot)
  locations[PLAYER_ID] = { board: 'root', x: playerX - 1, y: playerY - 1 }

  return { world: { boards, pieces, locations }, groups }
}
