import { parseLevel } from '../game/engine/levelSchema'
import { Grid } from '../game/engine/types'
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
