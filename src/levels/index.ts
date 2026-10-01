import { parseLevel } from '../game/engine/levelSchema'
import { World } from '../game/engine/types'
import { listCustomLevels } from '../storage/progress'

export interface LevelMeta {
  id: string
  name: string
  world: World
  hint?: string // what the level teaches, shown while playing (tutorial levels)
}

// The tutorial: one small level per idea, in the official game's order. Made and checked by
// tools/generator/tutorial.ts (npm run generate:tutorial) — each needs the mechanic it teaches.
const tutorialModules = import.meta.glob('./builtin/tutorial/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const tutorialManifestModules = import.meta.glob('./builtin/tutorial/manifest.json', {
  import: 'default',
  eager: true,
}) as Record<string, { levels: { file: string; name: string; hint: string }[] }>

function tutorialLevels(): LevelMeta[] {
  const manifest = Object.values(tutorialManifestModules)[0]
  if (manifest === undefined) return []
  return manifest.levels.flatMap((level) => {
    const raw = tutorialModules[`./builtin/tutorial/${level.file}`]
    if (raw === undefined) return []
    return [{ id: `tutorial-${level.file.replace('.json', '')}`, name: level.name, hint: level.hint, world: parseLevel(JSON.parse(raw)) }]
  })
}

export const BUILTIN_LEVELS: LevelMeta[] = tutorialLevels()

const generatedModules = import.meta.glob('./builtin/generated/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// Mechanic-aware Infinite Enter levels (npm run generate:infinite-enter) live in their own
// folder: generate:levels wipes `generated/` wholesale and must not delete them.
const infiniteEnterModules = import.meta.glob('./builtin/generated-ie/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// Third-party editor example levels (see docs/differential/community-samples/README.md),
// converted from the official version-4 text format by tools/generator/convertCommunitySamples.ts.
// Not gameplay-verified against the original game; kept separate so they're easy to tell apart
// from this project's own curated/generated levels.
const communitySampleModules = import.meta.glob('./builtin/community-samples/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function parseGeneratedModules(modules: Record<string, string>): LevelMeta[] {
  return Object.entries(modules).map(([path, raw]) => {
    const id = path.split('/').pop()!.replace('.json', '')
    return { id, name: id, world: parseLevel(JSON.parse(raw)) }
  })
}

export function loadGeneratedLevels(): LevelMeta[] {
  return [...parseGeneratedModules(generatedModules), ...parseGeneratedModules(infiniteEnterModules)]
}

// World-classified levels (tools/generator/worlds): every level in a world was verified to
// NEED that world's mechanic — solvable with it, proven unsolvable without it.
const worldLevelModules = import.meta.glob('./builtin/worlds/*/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface WorldManifest {
  worlds: { id: string; order: number; name: string; signature: string; levels: { file: string }[] }[]
}
const worldManifestModules = import.meta.glob('./builtin/worlds/manifest.json', {
  import: 'default',
  eager: true,
}) as Record<string, WorldManifest>

export interface WorldGroup {
  id: string
  name: string
  levels: LevelMeta[]
}

// Levels made in the level editor (npm run editor), saved under builtin/authored/. One filed under
// a World (after passing that World's check in the editor) is listed after the generated ones.
const authoredLevelModules = import.meta.glob('./builtin/authored/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface AuthoredManifest {
  levels: { file: string; name: string; worldId?: string }[]
}
const authoredManifestModules = import.meta.glob('./builtin/authored/manifest.json', {
  import: 'default',
  eager: true,
}) as Record<string, AuthoredManifest>

function authoredLevels(): (LevelMeta & { worldId?: string })[] {
  const manifest = Object.values(authoredManifestModules)[0]
  if (manifest === undefined) return []
  return manifest.levels.flatMap((level) => {
    const raw = authoredLevelModules[`./builtin/authored/${level.file}`]
    if (raw === undefined) return []
    return [{ id: `authored-${level.file.replace('.json', '')}`, name: level.name, world: parseLevel(JSON.parse(raw)), worldId: level.worldId }]
  })
}

// Editor levels not filed under any World.
export function loadAuthoredLevels(): LevelMeta[] {
  return authoredLevels().filter((l) => l.worldId === undefined)
}

export function loadWorldLevels(): WorldGroup[] {
  const manifest = Object.values(worldManifestModules)[0]
  if (manifest === undefined) return []
  const authored = authoredLevels()
  return [...manifest.worlds]
    .sort((a, b) => a.order - b.order)
    .map((world) => ({
      id: world.id,
      name: world.name,
      levels: world.levels.flatMap((level, i) => {
        const raw = worldLevelModules[`./builtin/worlds/${level.file}`]
        if (raw === undefined) return []
        return [{ id: `world-${world.id}-${i + 1}`, name: `${world.name.split(' ')[0]} ${i + 1}`, world: parseLevel(JSON.parse(raw)) }]
      }).concat(authored.filter((l) => l.worldId === world.id).map(({ worldId: _w, ...level }) => level)),
    }))
}

export function loadCommunitySampleLevels(): LevelMeta[] {
  return parseGeneratedModules(communitySampleModules).map((level) => ({ ...level, name: `[社群] ${level.name}` }))
}

// Custom level names are chosen by the user, so they could collide with a
// builtin id and silently share its completion record. The stored id stays
// the display name; only the LevelMeta id carries the prefix.
export const CUSTOM_LEVEL_ID_PREFIX = 'custom:'

// Sub-project 3's editor now produces valid World-format saves, so this can
// load them for real. One corrupt entry (hand-edited localStorage, a save
// from an even older format) must not white-screen the app, which calls
// this during render — mirrors storage/progress.ts's readJson guard.
export function loadCustomLevels(): LevelMeta[] {
  const levels: LevelMeta[] = []
  for (const entry of listCustomLevels()) {
    try {
      const world = parseLevel(JSON.parse(entry.json))
      levels.push({ id: `${CUSTOM_LEVEL_ID_PREFIX}${entry.id}`, name: entry.id, world })
    } catch (error) {
      console.warn(`Ignoring corrupt custom level "${entry.id}":`, error)
    }
  }
  return levels
}
