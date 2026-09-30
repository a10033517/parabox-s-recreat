import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { Board, Cell, PLAYER_ID, World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'
import { validateInfiniteEnter } from './infiniteEnterValidator'

// Mechanic-aware archetype: "Infinite Enter". The generator is not asked to invent a paradox;
// it builds the one known topology that produces it and randomizes everything around it:
//
//   root       : player on the left, box A (id 1) with a wall behind it, decoy walls,
//                and a sealed pocket holding R — the exitblock Ref to the floating Block
//                (infenter, infenterid = 1). The pocket cannot be reached by walking.
//   A's inside : the clone O of A sits on A's entry cell with a wall behind it, so entering
//                A can only loop inward -> Infinite Enter -> R's floating Block (the goal).
//
// Every candidate still has to pass validateInfiniteEnter (solvable, triggered, and
// unsolvable with Infinite Enter removed) — the archetype is a starting point, not a proof.
export interface IeArchetypeConfig {
  rootSizeRange: [number, number]
  interiorSizes: number[] // odd only, so each side has one center cell
  decoyWallDensity: number
}

export const IE_ARCHETYPE_CONFIG: IeArchetypeConfig = {
  rootSizeRange: [3, 6],
  interiorSizes: [3, 5],
  decoyWallDensity: 0.18,
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

const floor = (): Cell => ({ type: 'floor' })

export function generateInfiniteEnterCandidate(config: IeArchetypeConfig, rng: () => number): World | null {
  const n = randInt(rng, config.rootSizeRange[0], config.rootSizeRange[1])
  const cells: Cell[][] = Array.from({ length: n }, () => Array.from({ length: n }, floor))
  const root: Board = { id: 'b0', size: n, cells }

  // A: one column in from the left, any row that leaves room for a sealed pocket two rows away.
  const ax = randInt(rng, 1, n - 2)
  const ay = randInt(rng, 0, n - 1)
  const pocketRows = Array.from({ length: n }, (_, y) => y).filter((y) => Math.abs(y - ay) >= 2)
  if (pocketRows.length === 0) return null
  const py = pocketRows[randInt(rng, 0, pocketRows.length - 1)]
  const px = n - 1

  const protectedCells = new Set<string>()
  const keep = (x: number, y: number) => protectedCells.add(`${x},${y}`)
  const wall = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < n && y < n) cells[y][x] = { type: 'wall' }
  }

  wall(ax + 1, ay) // behind A: forces "enter" over "push"
  keep(ax, ay)
  keep(ax + 1, ay)
  for (let x = 0; x < ax; x++) keep(x, ay) // the walkway to A stays open
  keep(px, py)
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const nx = px + dx
    const ny = py + dy
    if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue
    if (protectedCells.has(`${nx},${ny}`) && !(nx === ax + 1 && ny === ay)) return null // seal would hit A / the walkway
    wall(nx, ny)
    keep(nx, ny)
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!protectedCells.has(`${x},${y}`) && rng() < config.decoyWallDensity) wall(x, y)
    }
  }

  const playerX = randInt(rng, 0, ax - 1)

  const s = config.interiorSizes[randInt(rng, 0, config.interiorSizes.length - 1)]
  const mid = (s - 1) / 2
  const inner: Cell[][] = Array.from({ length: s }, () => Array.from({ length: s }, floor))
  inner[mid][1] = { type: 'wall' } // behind O
  const interior: Board = { id: 'b1', size: s, cells: inner }

  const goalBoard: Board = { id: 'b9', size: 1, cells: [[{ type: 'floor', requirement: 'player' }]], floatInSpace: true }

  return {
    boards: { b0: root, b1: interior, b9: goalBoard },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      p1: { id: 'p1', kind: 'container', boardRef: 'b1' },
      ref0: { id: 'ref0', kind: 'container', cloneOf: 'p1' },
      ref1: { id: 'ref1', kind: 'container', boardRef: 'b9', infEnter: true, infEnterNum: 1, infEnterId: 1, exitBlock: true },
    },
    locations: {
      [PLAYER_ID]: { board: 'b0', x: playerX, y: ay },
      p1: { board: 'b0', x: ax, y: ay },
      ref0: { board: 'b1', x: 0, y: mid },
      ref1: { board: 'b0', x: px, y: py },
    },
  }
}

export interface IeBatchResult {
  levels: World[]
  attempts: number
  rejected: number
}

export function generateInfiniteEnterLevels(
  count: number,
  rng: () => number,
  maxAttempts = 400,
  config: IeArchetypeConfig = IE_ARCHETYPE_CONFIG,
): IeBatchResult {
  const levels: World[] = []
  const seen = new Set<string>()
  let attempts = 0
  let rejected = 0
  while (levels.length < count && attempts < maxAttempts) {
    attempts++
    const candidate = generateInfiniteEnterCandidate(config, rng)
    if (candidate === null) { rejected++; continue }
    const key = canonicalKey(candidate)
    if (seen.has(key)) { rejected++; continue }
    const verdict = validateInfiniteEnter(candidate, true, 200, 20000)
    if (!verdict.valid) { rejected++; continue }
    seen.add(key)
    levels.push(candidate)
  }
  return { levels, attempts, rejected }
}

function main() {
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/levels/builtin/generated-ie')
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })
  const result = generateInfiniteEnterLevels(5, Math.random)
  result.levels.forEach((world, i) => {
    writeFileSync(join(outputDir, `ie-${String(i + 1).padStart(2, '0')}.json`), JSON.stringify(serializeLevel(world)))
  })
  console.log(`Generated ${result.levels.length} Infinite Enter levels (attempts=${result.attempts}, rejected=${result.rejected})`)
  if (result.levels.length < 5) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
