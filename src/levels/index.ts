import { parseLevel } from '../game/engine/levelSchema'
import { Grid } from '../game/engine/types'
import { listCustomLevels } from '../storage/progress'
import level01 from './builtin/01-first-push.json?raw'
import level02 from './builtin/02-single-nest.json?raw'
import level03 from './builtin/03-chain-nest.json?raw'

export interface LevelMeta {
  id: string
  name: string
  grid: Grid
}

export const BUILTIN_LEVELS: LevelMeta[] = [
  { id: '01-first-push', name: '第一次推动', grid: parseLevel(level01) },
  { id: '02-single-nest', name: '箱中箱', grid: parseLevel(level02) },
  { id: '03-chain-nest', name: '连锁嵌套', grid: parseLevel(level03) },
]

const generatedModules = import.meta.glob('./builtin/generated/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function loadGeneratedLevels(): LevelMeta[] {
  return Object.entries(generatedModules).map(([path, raw]) => {
    const id = path.split('/').pop()!.replace('.json', '')
    return { id, name: id, grid: parseLevel(raw) }
  })
}

// Custom level names are chosen by the user, so they could collide with a
// builtin or generated id and silently share its completion record. The stored
// id stays the display name; only the LevelMeta id carries the prefix.
export const CUSTOM_LEVEL_ID_PREFIX = 'custom:'

export function loadCustomLevels(): LevelMeta[] {
  const levels: LevelMeta[] = []
  for (const entry of listCustomLevels()) {
    try {
      levels.push({ id: `${CUSTOM_LEVEL_ID_PREFIX}${entry.id}`, name: entry.id, grid: parseLevel(entry.json) })
    } catch (error) {
      console.warn(`Skipping unparseable custom level "${entry.id}":`, error)
    }
  }
  return levels
}
