import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { serializeLevel } from '../../../src/game/engine/levelSchema'
import { World } from '../../../src/game/engine/types'
import { canonicalKey } from '../canonical'
import { mulberry32 } from './build'
import { WORLD_PROFILES } from './profiles'
import { DEFAULT_BUDGET, LevelRecord, WorldProfile, verifyWorldLevel } from './verify'

// World-classified level generation (docs: parabox_level_generator_world_profiles.md §9) for ONE
// world at a time: candidate structures from its profile are verified (present / used /
// necessary), and the hardest accepted ones are kept, ordered easiest-first.
//
//   npx tsx tools/generator/worlds/generateWorlds.ts --only enter [--per 20] [--seconds 900] [--dry]
//
// Each world writes its own folder plus a world.json fragment; the manifest the game reads is
// rebuilt from all fragments (buildManifest) — so worlds can be generated in parallel
// (generateAll.ts) or one at a time without touching the others.

export const WORLDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../src/levels/builtin/worlds')

export interface WorldRun {
  profile: WorldProfile
  accepted: { world: World; record: LevelRecord }[]
  attempts: number
  rejected: Record<string, number>
  seconds: number
}

export function runWorld(profile: WorldProfile, opts: { attempts: number; seconds: number; want: number; baseSeed: number }): WorldRun {
  const started = Date.now()
  const seen = new Set<string>()
  const accepted: WorldRun['accepted'] = []
  const rejected: Record<string, number> = {}
  let attempts = 0
  for (; attempts < opts.attempts && accepted.length < opts.want; attempts++) {
    if ((Date.now() - started) / 1000 > opts.seconds) break
    const seed = opts.baseSeed + attempts
    const world = profile.generate(mulberry32(seed))
    if (world === null) {
      rejected.generation = (rejected.generation ?? 0) + 1
      continue
    }
    const key = canonicalKey(world)
    if (seen.has(key)) {
      rejected.duplicate = (rejected.duplicate ?? 0) + 1
      continue
    }
    seen.add(key)
    const verdict = verifyWorldLevel(profile, world, seed, DEFAULT_BUDGET)
    if (!verdict.accepted) {
      rejected[verdict.reason] = (rejected[verdict.reason] ?? 0) + 1
      continue
    }
    accepted.push({ world, record: verdict.record })
  }
  return { profile, accepted, attempts, rejected, seconds: (Date.now() - started) / 1000 }
}

// Difficulty: solution length, plus how big a search the solver needed (a wide, branching
// puzzle is harder than a long corridor of the same length).
export function difficultyScore(record: LevelRecord): number {
  return record.solver.solutionLength + 3 * Math.log2(record.solver.expandedStates + 1)
}

// The `n` hardest accepted levels, ordered easiest first — a progression that stays hard.
export function selectHardest<T extends { record: LevelRecord }>(accepted: T[], n: number): T[] {
  return [...accepted]
    .sort((a, b) => difficultyScore(b.record) - difficultyScore(a.record))
    .slice(0, n)
    .sort((a, b) => difficultyScore(a.record) - difficultyScore(b.record))
}

interface WorldFragment {
  id: string
  order: number
  name: string
  signature: string
  levels: { file: string; record: LevelRecord }[]
}

export function worldDirName(profile: WorldProfile): string {
  return `${String(profile.order).padStart(2, '0')}-${profile.id}`
}

// The game's manifest, rebuilt from every world folder's world.json fragment.
export function buildManifest(dir: string = WORLDS_DIR): void {
  if (!existsSync(dir)) return
  const worlds: WorldFragment[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fragment = join(dir, entry.name, 'world.json')
    if (entry.isDirectory() && existsSync(fragment)) worlds.push(JSON.parse(readFileSync(fragment, 'utf8')) as WorldFragment)
  }
  worlds.sort((a, b) => a.order - b.order)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ worlds }, null, 2))
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

function main(): void {
  const per = Number(arg('per', '20'))
  const attempts = Number(arg('attempts', '1000000'))
  const seconds = Number(arg('seconds', '900'))
  const oversample = Number(arg('oversample', '2'))
  const only = arg('only', '')
  const dry = process.argv.includes('--dry')

  const profiles = WORLD_PROFILES.filter((p) => only === '' || only.split(',').includes(p.id))
  for (const profile of profiles) {
    const run = runWorld(profile, { attempts, seconds, want: per * oversample, baseSeed: 1_000_000 * profile.order })
    const chosen = selectHardest(run.accepted, per)
    const lengths = chosen.map((c) => c.record.solver.solutionLength)
    console.log(
      `${profile.id}: accepted ${run.accepted.length}/${run.attempts} in ${run.seconds.toFixed(0)}s, shipped ${chosen.length}, ` +
        `lengths ${Math.min(...lengths)}-${Math.max(...lengths)} [${lengths.join(', ')}], rejected ${JSON.stringify(run.rejected)}`,
    )
    if (dry || chosen.length === 0) continue
    const dir = worldDirName(profile)
    rmSync(join(WORLDS_DIR, dir), { recursive: true, force: true })
    mkdirSync(join(WORLDS_DIR, dir), { recursive: true })
    const levels = chosen.map((c, i) => {
      const file = `${dir}/${String(i + 1).padStart(2, '0')}.json`
      writeFileSync(join(WORLDS_DIR, file), JSON.stringify(serializeLevel(c.world)))
      return { file, record: c.record }
    })
    const fragment: WorldFragment = { id: profile.id, order: profile.order, name: profile.name, signature: profile.signature, levels }
    writeFileSync(join(WORLDS_DIR, dir, 'world.json'), JSON.stringify(fragment, null, 2))
  }
  if (!dry && !process.argv.includes('--no-manifest')) buildManifest()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
