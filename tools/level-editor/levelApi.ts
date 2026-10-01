import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

// Local level-editor server (npm run editor): a Vite plugin that serves the editor page and a
// small JSON API over the project's own level files. Everything it writes stays inside
// src/levels/builtin/ — the same files the game (and the app build) loads.
//
//   GET    /api/levels                  every level, grouped by where it lives
//   GET    /api/level?path=...          one level
//   PUT    /api/level                   { path, world }          overwrite a level file
//   POST   /api/authored                { name, world }          save a new editor level
//   PATCH  /api/authored                { path, name?, worldId? } rename / file under a World
//   DELETE /api/level?path=...          delete a level (not a tutorial one)
//   POST   /api/solve                   { world }                optimal solution
//   POST   /api/classify                { world }                three-level World verification
//   POST   /api/official/import         { text }                 official .txt -> World
//   POST   /api/official/export         { world }                World -> official .txt
//   POST   /api/draft                   { worldId, seed? }       a generated draft for a World

// Set from the Vite server's root when the plugin starts.
let BUILTIN = join(process.cwd(), 'src/levels/builtin')
let AUTHORED = join(BUILTIN, 'authored')
let AUTHORED_MANIFEST = join(AUTHORED, 'manifest.json')
let INDEX_TS = join(process.cwd(), 'src/levels/index.ts')

function setProjectRoot(root: string): void {
  BUILTIN = join(root, 'src/levels/builtin')
  AUTHORED = join(BUILTIN, 'authored')
  AUTHORED_MANIFEST = join(AUTHORED, 'manifest.json')
  INDEX_TS = join(root, 'src/levels/index.ts')
}

export interface AuthoredEntry {
  file: string // relative to authored/
  name: string
  worldId?: string // a World this level was verified for and filed under
}

function readJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
}

function authoredManifest(): { levels: AuthoredEntry[] } {
  return readJson(AUTHORED_MANIFEST, { levels: [] as AuthoredEntry[] })
}

function writeAuthoredManifest(manifest: { levels: AuthoredEntry[] }): void {
  mkdirSync(AUTHORED, { recursive: true })
  writeFileSync(AUTHORED_MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
}

// A level path from the client, as a file inside src/levels/builtin — never anywhere else.
function levelFile(path: unknown): string {
  if (typeof path !== 'string' || !path.endsWith('.json') || path.includes('\0')) throw new Error('bad path')
  const file = resolve(BUILTIN, path)
  if (!file.startsWith(BUILTIN + sep)) throw new Error('path outside src/levels/builtin')
  if (file === AUTHORED_MANIFEST || file.endsWith(`${sep}manifest.json`)) throw new Error('not a level file')
  return file
}

const rel = (file: string) => relative(BUILTIN, file).split(sep).join('/')

function tutorialNames(): Map<string, string> {
  const index = readFileSync(INDEX_TS, 'utf8')
  const names = new Map<string, string>()
  for (const m of index.matchAll(/\{ id: '([^']+)', name: '([^']+)'/g)) names.set(m[1], m[2])
  return names
}

interface LevelGroup {
  id: string
  title: string
  note?: string
  levels: { path: string; name: string; worldId?: string }[]
}

function listLevels(): LevelGroup[] {
  const jsonIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort() : [])
  const names = tutorialNames()
  const groups: LevelGroup[] = []
  groups.push({
    id: 'tutorial', title: '教学关卡',
    levels: jsonIn(BUILTIN).map((f) => ({ path: f, name: names.get(f.replace('.json', '')) ?? f })),
  })
  groups.push({
    id: 'authored', title: '编辑器关卡',
    levels: authoredManifest().levels.map((l) => ({ path: `authored/${l.file}`, name: l.name, worldId: l.worldId })),
  })
  const worlds = readJson<{ worlds: { id: string; name: string; levels: { file: string }[] }[] }>(join(BUILTIN, 'worlds/manifest.json'), { worlds: [] })
  for (const w of worlds.worlds) {
    groups.push({
      id: `world-${w.id}`, title: w.name, note: '生成的关卡:重新执行 generate:worlds 会覆盖修改',
      levels: w.levels.map((l, i) => ({ path: `worlds/${l.file}`, name: `${w.name.split(' ')[0]} ${i + 1}` })),
    })
  }
  groups.push({
    id: 'community', title: '社群关卡', note: '由 docs/differential/community-samples/*.txt 转换:重新转换会覆盖修改',
    levels: jsonIn(join(BUILTIN, 'community-samples')).map((f) => ({ path: `community-samples/${f}`, name: f.replace('.json', '') })),
  })
  groups.push({
    id: 'generated', title: '更多生成关卡', note: '旧生成器的关卡',
    levels: [
      ...jsonIn(join(BUILTIN, 'generated')).map((f) => ({ path: `generated/${f}`, name: f.replace('.json', '') })),
      ...jsonIn(join(BUILTIN, 'generated-ie')).map((f) => ({ path: `generated-ie/${f}`, name: f.replace('.json', '') })),
    ],
  })
  return groups
}

// Deletes a level file and every list that names it. Tutorial levels are imported one by one
// in src/levels/index.ts, so deleting one would break the game build: those are refused.
function deleteLevel(file: string): void {
  const path = rel(file)
  if (!path.includes('/')) throw new Error('教学关卡是游戏程式直接引用的,不能在这里删除')
  if (!existsSync(file)) throw new Error('level does not exist')
  if (path.startsWith('authored/')) {
    const manifest = authoredManifest()
    manifest.levels = manifest.levels.filter((l) => l.file !== path.slice('authored/'.length))
    writeAuthoredManifest(manifest)
  } else if (path.startsWith('worlds/')) {
    // The world's own fragment and the combined manifest both list its levels.
    const levelPath = path.slice('worlds/'.length)
    const dropFrom = (json: string) => {
      if (!existsSync(json)) return
      const data = JSON.parse(readFileSync(json, 'utf8')) as { worlds?: { levels: { file: string }[] }[]; levels?: { file: string }[] }
      for (const w of data.worlds ?? []) w.levels = w.levels.filter((l) => l.file !== levelPath)
      if (data.levels !== undefined) data.levels = data.levels.filter((l) => l.file !== levelPath)
      writeFileSync(json, JSON.stringify(data, null, 2))
    }
    dropFrom(join(BUILTIN, 'worlds', levelPath.split('/')[0], 'world.json'))
    dropFrom(join(BUILTIN, 'worlds', 'manifest.json'))
  }
  rmSync(file, { force: true })
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function slug(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return s === '' ? 'level' : s.slice(0, 40)
}

// Engine / generator modules, loaded through Vite so the editor always runs the current code.
async function modules(server: ViteDevServer) {
  const load = (p: string) => server.ssrLoadModule(p)
  const [schema, solver, verify, profiles, events, rules, officialIn, officialOut, build] = await Promise.all([
    load('/src/game/engine/levelSchema.ts'),
    load('/tools/generator/solver.ts'),
    load('/tools/generator/worlds/verify.ts'),
    load('/tools/generator/worlds/profiles.ts'),
    load('/src/game/engine/events.ts'),
    load('/src/game/engine/rules.ts'),
    load('/src/game/engine/officialFormat.ts'),
    load('/src/game/engine/officialExport.ts'),
    load('/tools/generator/worlds/build.ts'),
  ])
  return { schema, solver, verify, profiles, events, rules, officialIn, officialOut, build }
}

const SOLVE_DEPTH = 300
const SOLVE_EXPANDED = 400_000

async function handle(server: ViteDevServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = `${req.method} ${url.pathname}`
  const m = await modules(server)
  const validWorld = (world: unknown) => m.schema.parseLevel(JSON.parse(JSON.stringify(world)))

  switch (route) {
    case 'GET /api/levels':
      return send(res, 200, { groups: listLevels() })

    case 'GET /api/level': {
      const file = levelFile(url.searchParams.get('path'))
      return send(res, 200, { world: JSON.parse(readFileSync(file, 'utf8')) })
    }

    case 'PUT /api/level': {
      const b = await body(req)
      const file = levelFile(b.path)
      if (!existsSync(file)) throw new Error('level does not exist (use POST /api/authored for a new one)')
      const world = validWorld(b.world)
      writeFileSync(file, JSON.stringify(m.schema.serializeLevel(world)))
      return send(res, 200, { ok: true })
    }

    case 'POST /api/authored': {
      const b = await body(req)
      const name = typeof b.name === 'string' && b.name.trim() !== '' ? b.name.trim() : '新关卡'
      const world = validWorld(b.world)
      const manifest = authoredManifest()
      const taken = new Set(manifest.levels.map((l) => l.file))
      let file = `${slug(name)}.json`
      for (let i = 2; taken.has(file) || existsSync(join(AUTHORED, file)); i++) file = `${slug(name)}-${i}.json`
      mkdirSync(AUTHORED, { recursive: true })
      writeFileSync(join(AUTHORED, file), JSON.stringify(m.schema.serializeLevel(world)))
      manifest.levels.push({ file, name })
      writeAuthoredManifest(manifest)
      return send(res, 200, { path: `authored/${file}` })
    }

    case 'PATCH /api/authored': {
      const b = await body(req)
      const file = rel(levelFile(b.path)).replace(/^authored\//, '')
      const manifest = authoredManifest()
      const entry = manifest.levels.find((l) => l.file === file)
      if (entry === undefined) throw new Error('not an editor level')
      if (typeof b.name === 'string' && b.name.trim() !== '') entry.name = b.name.trim()
      if (b.worldId === null) delete entry.worldId
      else if (typeof b.worldId === 'string') entry.worldId = b.worldId
      writeAuthoredManifest(manifest)
      return send(res, 200, { ok: true })
    }

    case 'DELETE /api/authored':
    case 'DELETE /api/level': {
      const file = levelFile(url.searchParams.get('path'))
      deleteLevel(file)
      return send(res, 200, { ok: true })
    }

    case 'POST /api/solve': {
      const world = validWorld((await body(req)).world)
      const started = Date.now()
      const result = m.solver.solveDetailed(world, SOLVE_DEPTH, SOLVE_EXPANDED)
      return send(res, 200, {
        status: result.status,
        moves: result.status === 'SOLVED' ? result.result.moves : [],
        expandedStates: result.status === 'SOLVED' ? result.result.expandedStates : undefined,
        seconds: (Date.now() - started) / 1000,
      })
    }

    case 'POST /api/classify': {
      const world = validWorld((await body(req)).world)
      const solved = m.solver.solveDetailed(world, SOLVE_DEPTH, SOLVE_EXPANDED)
      const moves = solved.status === 'SOLVED' ? solved.result.moves : undefined
      const events = moves !== undefined ? m.verify.solutionEvents(world, moves) : undefined
      const worlds = []
      for (const profile of m.profiles.WORLD_PROFILES) {
        const presence = profile.presence(world)
        const usage = presence && events !== undefined ? profile.usage(events, world) : false
        let necessity: boolean | 'unproven' = false
        if (usage) {
          necessity = true
          for (const ablation of profile.ablations(world)) {
            const r = m.events.withEngineContext({ disabledMechanics: new Set(ablation.disabled ?? []) }, () =>
              m.solver.solveDetailed(ablation.world, SOLVE_DEPTH * 2, SOLVE_EXPANDED),
            )
            if (r.status === 'SOLVED') { necessity = false; break }
            if (r.status !== 'UNSOLVABLE') { necessity = 'unproven'; break }
          }
        }
        worlds.push({ id: profile.id, name: profile.name, signature: profile.signature, presence, usage, necessity })
      }
      return send(res, 200, { solveStatus: solved.status, solutionLength: moves?.length, worlds })
    }

    case 'POST /api/official/import': {
      const text = (await body(req)).text
      if (typeof text !== 'string') throw new Error('text required')
      return send(res, 200, { world: m.schema.serializeLevel(m.officialIn.parseOfficialLevel(text)) })
    }

    case 'POST /api/official/export': {
      const world = validWorld((await body(req)).world)
      return send(res, 200, m.officialOut.exportOfficialLevel(world))
    }

    case 'POST /api/draft': {
      const b = await body(req)
      const profile = m.profiles.WORLD_PROFILES.find((p: { id: string }) => p.id === b.worldId)
      if (profile === undefined) throw new Error('unknown world')
      const started = Date.now()
      let seed = typeof b.seed === 'number' ? b.seed : Math.floor(Math.random() * 1e9)
      let last: unknown = null
      // Up to ~20 s: the first candidate that passes the World's three-level check.
      while (Date.now() - started < 20_000) {
        const world = profile.generate(m.build.mulberry32(seed))
        if (world !== null) {
          last = world
          const verdict = m.verify.verifyWorldLevel(profile, world, seed)
          if (verdict.accepted) return send(res, 200, { world: m.schema.serializeLevel(world), verified: true, seed, solutionLength: verdict.record.solver.solutionLength })
        }
        seed++
      }
      if (last === null) throw new Error('no draft could be generated')
      return send(res, 200, { world: m.schema.serializeLevel(last), verified: false, seed })
    }
  }
  send(res, 404, { error: `no route ${route}` })
}

export function levelEditorApi(): Plugin {
  return {
    name: 'level-editor-api',
    configureServer(server) {
      setProjectRoot(resolve(server.config.root))
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        handle(server, req, res).catch((error: unknown) => send(res, 400, { error: error instanceof Error ? error.message : String(error) }))
      })
    },
  }
}
