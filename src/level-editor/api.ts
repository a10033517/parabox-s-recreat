import { Direction, World } from '../game/engine/types'

// Client for the local level API (tools/level-editor/levelApi.ts).

export interface LevelEntry {
  path: string
  name: string
  worldId?: string
}

export interface LevelGroup {
  id: string
  title: string
  note?: string
  levels: LevelEntry[]
}

export interface SolveResponse {
  status: 'SOLVED' | 'UNSOLVABLE' | 'EXPANSION_CAP' | 'DEPTH_CAP'
  moves: Direction[]
  expandedStates?: number
  seconds: number
}

export interface WorldVerdict {
  id: string
  name: string
  signature: string
  presence: boolean
  usage: boolean
  necessity: boolean | 'unproven'
}

export interface ClassifyResponse {
  solveStatus: SolveResponse['status']
  solutionLength?: number
  worlds: WorldVerdict[]
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

export const api = {
  levels: () => call<{ groups: LevelGroup[] }>('GET', '/api/levels').then((r) => r.groups),
  level: (path: string) => call<{ world: World }>('GET', `/api/level?path=${encodeURIComponent(path)}`).then((r) => r.world),
  save: (path: string, world: World) => call<{ ok: true }>('PUT', '/api/level', { path, world }),
  create: (name: string, world: World) => call<{ path: string }>('POST', '/api/authored', { name, world }).then((r) => r.path),
  updateAuthored: (path: string, patch: { name?: string; worldId?: string | null }) => call<{ ok: true }>('PATCH', '/api/authored', { path, ...patch }),
  deleteLevel: (path: string) => call<{ ok: true }>('DELETE', `/api/level?path=${encodeURIComponent(path)}`),
  solve: (world: World) => call<SolveResponse>('POST', '/api/solve', { world }),
  classify: (world: World) => call<ClassifyResponse>('POST', '/api/classify', { world }),
  importOfficial: (text: string) => call<{ world: World }>('POST', '/api/official/import', { text }).then((r) => r.world),
  exportOfficial: (world: World) => call<{ text: string; warnings: string[] }>('POST', '/api/official/export', { world }),
  draft: (worldId: string) => call<{ world: World; verified: boolean; seed: number; solutionLength?: number }>('POST', '/api/draft', { worldId }),
}
