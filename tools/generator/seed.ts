import {
  Cell, Direction, PLAYER_ID, World,
  step, opposite,
} from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { GENERATOR_CONFIG, SeedProfile, assertFillerBoxCount } from './generatorConfig'

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

// Picks 1 or 2 *distinct* wall directions. The 2-direction case uses a
// nonzero offset instead of a reshuffle or rejection loop, specifically so
// its RNG-call count is fixed (exactly 2 calls) and the single-direction
// case's call count (exactly 1) never changes regardless of `count` — see
// the multi-box groups spec §5.2-§5.3 for the exact RNG contract this
// generator now depends on.
export function pickWallDirs(rng: () => number, count: 1 | 2): Direction[] {
  const first = Math.floor(rng() * DIRECTIONS.length)
  if (count === 1) return [DIRECTIONS[first]]
  const offset = 1 + Math.floor(rng() * (DIRECTIONS.length - 1))
  const second = (first + offset) % DIRECTIONS.length
  return [DIRECTIONS[first], DIRECTIONS[second]]
}

// A single box belonging to a group. `originalPosition` is the box's
// position on its own interior board — this is both part of the group's
// win condition and the one-way-door pruning check (see
// pruneUntouchedGoals.ts): nothing but a real eat move ever changes it, in
// either direction. See the multi-box groups spec
// (2026-09-11-parabox-generator-multibox-groups.md) for the full design.
export interface GroupBox {
  boxId: string
  originalPosition: { x: number; y: number }
}

// A group's identity as constructed by the seed. `boxes` has length 1
// (ordinary group) or 2 (multi-box group, per the spec above) — never 0 or
// more than 2. `originalPosition` (the container's root position) is kept
// for descriptive completeness and is used by generateLevel.ts's
// direction-seeking bias; it is not consulted by pruning.
export interface SeedGroup {
  containerId: string
  interiorId: string
  originalPosition: { x: number; y: number }
  boxes: GroupBox[]
}

export function assertValidSeedGroup(group: SeedGroup): void {
  if (group.boxes.length !== 1 && group.boxes.length !== 2) {
    throw new Error(`Invalid box count for group ${group.containerId}: ${group.boxes.length}`)
  }
  const ids = new Set(group.boxes.map((box) => box.boxId))
  if (ids.size !== group.boxes.length) {
    throw new Error(`Duplicate box id in group ${group.containerId}`)
  }
}

// The 4 corners of a SLOT_SIZE x SLOT_SIZE block, in local (offset-from-
// origin) coordinates. Always safe regardless of that slot's wall
// direction(s), container position, or whether the player starts there:
// the container sits at local (center,center), its wall cells are
// cardinal-adjacent to that (local (center±1,center) or (center,center±1)),
// and the player candidate is local (center-1,center-1) — none of these
// are ever a corner (0,0)/(0,SLOT_SIZE-1)/(SLOT_SIZE-1,0)/(SLOT_SIZE-1,SLOT_SIZE-1)
// for any SLOT_SIZE >= 3, so a corner is always plain, unclaimed floor.
function getSlotCorner(slotIndex: number, cornerIndex: number): { x: number; y: number } {
  const origin = getSlotOrigin(slotIndex)
  const corners: [number, number][] = [[0, 0], [0, SLOT_SIZE - 1], [SLOT_SIZE - 1, 0], [SLOT_SIZE - 1, SLOT_SIZE - 1]]
  const [cx, cy] = corners[cornerIndex % corners.length]
  return { x: origin.x + cx, y: origin.y + cy }
}

export interface SeedResult {
  world: World
  groups: SeedGroup[]
  // Plain, goal-less pushable boxes (see generatorConfig.ts's own comment
  // on SeedProfile.fillerBoxCount) — extra reverse-walk material, not
  // tied to any win condition. Never consulted by pruning.
  fillerBoxIds: string[]
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

    // RNG contract (multi-box groups spec §5.3), fixed per group:
    // 1. isMultiBox  2. wall direction(s) — 1 call if single-box, 2 if
    // multi-box  3. interior size. This is a breaking change from the
    // single-box-only contract: even when multiBoxProbability is 0, the
    // isMultiBox draw itself still consumes one rng() call every group,
    // shifting every later draw — old hand-tuned RNG sequences do not
    // survive this change and were rewritten in seed.test.ts accordingly.
    const isMultiBox = rng() < profile.multiBoxProbability
    const wallDirs = pickWallDirs(rng, isMultiBox ? 2 : 1)
    const interiorSize = rng() < profile.largeInteriorProbability ? 5 : 3

    for (const wallDir of wallDirs) {
      const wallPos = step(containerX, containerY, wallDir)
      cells[wallPos.y][wallPos.x] = { type: 'wall' }
    }
    // No requirement on the container's own root cell — Approach A: the
    // container merely occupying its cell must never be sufficient to win.
    cells[containerY][containerX] = { type: 'floor' }

    const interiorId = `goal${i}Inside`
    const containerId = `goal${i}`
    const interior = { id: interiorId, size: interiorSize, cells: makeFloorCells(interiorSize) }

    const boxes: GroupBox[] = []
    for (const [boxIndex, wallDir] of wallDirs.entries()) {
      // Single-box groups keep the original id shape (`box0`) exactly.
      const boxId = wallDirs.length === 1 ? `box${i}` : `box${i}_${boxIndex}`
      const { cell: eatenCell } = getEntryCell(interior, opposite(wallDir), HALF)
      if (eatenCell === null) {
        // Provably unreachable: HALF always maps to an in-bounds
        // center-of-edge cell for any board size >= 1, independently for
        // each of the 4 directions (hand-verified in the multi-box groups
        // spec's own pre-implementation check, §2.4/§12 step 1).
        throw new Error(`createSeedWorld: getEntryCell unexpectedly returned null for interior size ${interiorSize}`)
      }
      // The win condition for this box: a non-player piece must occupy
      // this cell. Only the pre-placed box starts here, and it can only
      // leave via a real eat move (see the full design spec's one-way-door
      // argument) — unaffected by whether the group has 1 or 2 boxes.
      interior.cells[eatenCell.y][eatenCell.x] = { type: 'floor', requirement: 'box' }
      pieces[boxId] = { id: boxId, kind: 'normal' }
      locations[boxId] = { board: interiorId, x: eatenCell.x, y: eatenCell.y }
      boxes.push({ boxId, originalPosition: { x: eatenCell.x, y: eatenCell.y } })
    }
    boards[interiorId] = interior

    pieces[containerId] = { id: containerId, kind: 'container', boardRef: interiorId }
    locations[containerId] = { board: 'root', x: containerX, y: containerY }

    const group: SeedGroup = {
      containerId,
      interiorId,
      originalPosition: { x: containerX, y: containerY },
      boxes,
    }
    assertValidSeedGroup(group)
    groups.push(group)
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

  // Filler boxes: no rng consumed (deterministic placement), so this never
  // shifts the RNG contract documented above for group construction.
  assertFillerBoxCount(profile.fillerBoxCount, 'profile.fillerBoxCount')
  const fillerBoxIds: string[] = []
  for (let i = 0; i < profile.fillerBoxCount; i++) {
    const slotIndex = i % PLAYER_START_SLOTS
    const cornerIndex = Math.floor(i / PLAYER_START_SLOTS)
    const { x, y } = getSlotCorner(slotIndex, cornerIndex)
    const fillerId = `filler${i}`
    pieces[fillerId] = { id: fillerId, kind: 'normal' }
    locations[fillerId] = { board: 'root', x, y }
    fillerBoxIds.push(fillerId)
  }

  return { world: { boards, pieces, locations }, groups, fillerBoxIds }
}
