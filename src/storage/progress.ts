const COMPLETED_KEY = 'parabox:completedLevels'
const CUSTOM_LEVELS_KEY = 'parabox:customLevels'

// Every read/write here is guarded. listCompletedLevels() runs during App's
// render and there is no error boundary in the tree, so a single corrupt
// localStorage value would otherwise throw during render and permanently
// white-screen an offline-first PWA the user cannot easily recover.
function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    console.warn(`Ignoring corrupt localStorage value for ${key}:`, error)
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    // setItem throws QuotaExceededError when storage is full; a failed save must
    // not crash the click handler that triggered it.
    console.warn(`Failed to persist localStorage value for ${key}:`, error)
  }
}

export function markLevelComplete(levelId: string): void {
  const set = new Set(listCompletedLevels())
  set.add(levelId)
  writeJson(COMPLETED_KEY, [...set])
}

export function isLevelComplete(levelId: string): boolean {
  return listCompletedLevels().includes(levelId)
}

export function listCompletedLevels(): string[] {
  return readJson<string[]>(COMPLETED_KEY, [])
}

export interface CustomLevelEntry {
  id: string
  json: string
}

export function saveCustomLevel(id: string, json: string): void {
  const levels = listCustomLevels().filter((l) => l.id !== id)
  levels.push({ id, json })
  writeJson(CUSTOM_LEVELS_KEY, levels)
}

export function listCustomLevels(): CustomLevelEntry[] {
  return readJson<CustomLevelEntry[]>(CUSTOM_LEVELS_KEY, [])
}

export function deleteCustomLevel(id: string): void {
  const levels = listCustomLevels().filter((l) => l.id !== id)
  writeJson(CUSTOM_LEVELS_KEY, levels)
}
