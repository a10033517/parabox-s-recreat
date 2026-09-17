import { parseLevel } from '../game/engine/levelSchema'
import { World } from '../game/engine/types'
import { listCustomLevels } from '../storage/progress'
import level01 from './builtin/01-first-push.json?raw'
import level02 from './builtin/02-enter-container.json?raw'
import level03 from './builtin/03-chain-push.json?raw'
import level04 from './builtin/04-eat.json?raw'
import level05 from './builtin/05-double-nested.json?raw'
import level06 from './builtin/06-self-loop.json?raw'
import level07 from './builtin/07-loop-eats-container.json?raw'
import level08 from './builtin/08-nested-loop.json?raw'

export interface LevelMeta {
  id: string
  name: string
  world: World
}

export const BUILTIN_LEVELS: LevelMeta[] = [
  { id: '01-first-push', name: '第一次推动', world: parseLevel(JSON.parse(level01)) },
  { id: '02-enter-container', name: '进入箱子', world: parseLevel(JSON.parse(level02)) },
  { id: '03-chain-push', name: '连锁推动', world: parseLevel(JSON.parse(level03)) },
  { id: '04-eat', name: '箱子吞噬', world: parseLevel(JSON.parse(level04)) },
  { id: '05-double-nested', name: '双层嵌套', world: parseLevel(JSON.parse(level05)) },
  { id: '06-self-loop', name: '自我循环', world: parseLevel(JSON.parse(level06)) },
  { id: '07-loop-eats-container', name: '循环吞噬容器', world: parseLevel(JSON.parse(level07)) },
  { id: '08-nested-loop', name: '嵌套循环', world: parseLevel(JSON.parse(level08)) },
]

const generatedModules = import.meta.glob('./builtin/generated/*.json', {
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
  return parseGeneratedModules(generatedModules)
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
