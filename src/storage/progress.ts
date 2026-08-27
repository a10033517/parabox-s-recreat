const COMPLETED_KEY = 'parabox:completedLevels'
const CUSTOM_LEVELS_KEY = 'parabox:customLevels'

export function markLevelComplete(levelId: string): void {
  const set = new Set(listCompletedLevels())
  set.add(levelId)
  localStorage.setItem(COMPLETED_KEY, JSON.stringify([...set]))
}

export function isLevelComplete(levelId: string): boolean {
  return listCompletedLevels().includes(levelId)
}

export function listCompletedLevels(): string[] {
  const raw = localStorage.getItem(COMPLETED_KEY)
  return raw ? (JSON.parse(raw) as string[]) : []
}

interface CustomLevelEntry {
  id: string
  json: string
}

export function saveCustomLevel(id: string, json: string): void {
  const levels = listCustomLevels().filter((l) => l.id !== id)
  levels.push({ id, json })
  localStorage.setItem(CUSTOM_LEVELS_KEY, JSON.stringify(levels))
}

export function listCustomLevels(): CustomLevelEntry[] {
  const raw = localStorage.getItem(CUSTOM_LEVELS_KEY)
  return raw ? (JSON.parse(raw) as CustomLevelEntry[]) : []
}

export function deleteCustomLevel(id: string): void {
  const levels = listCustomLevels().filter((l) => l.id !== id)
  localStorage.setItem(CUSTOM_LEVELS_KEY, JSON.stringify(levels))
}
