import { parseLevel } from '../game/engine/levelSchema'
import { World } from '../game/engine/types'
import level01 from './builtin/01-first-push.json?raw'
import level02 from './builtin/02-enter-container.json?raw'
import level03 from './builtin/03-chain-push.json?raw'
import level04 from './builtin/04-eat.json?raw'
import level05 from './builtin/05-double-nested.json?raw'

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
]

// Sub-project 4 rebuilds the generator against the new World format; nothing in
// that format exists yet.
export function loadGeneratedLevels(): LevelMeta[] {
  return []
}

// Custom level names are chosen by the user, so they could collide with a
// builtin id and silently share its completion record. The stored id stays
// the display name; only the LevelMeta id carries the prefix.
export const CUSTOM_LEVEL_ID_PREFIX = 'custom:'

// Sub-project 3 rebuilds the editor against the new World format; any levels
// saved by the old editor are in the old, incompatible format. When this is
// un-stubbed: parseLevel throws on invalid input, and this function runs
// during App's render — restore a per-entry try/catch (the old
// implementation had one) so one corrupt saved level can't white-screen the
// whole app.
export function loadCustomLevels(): LevelMeta[] {
  return []
}
