import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus } from 'node:os'
import { WORLD_PROFILES } from './profiles'
import { buildManifest } from './generateWorlds'

// Generates every world in parallel — one process per world (each world's search is
// single-threaded) — then rebuilds the game's manifest once all of them have finished.
//
//   npm run generate:worlds -- [--per 20] [--seconds 900] [--jobs 10]
//
// Extra arguments are passed through to each generateWorlds.ts process.

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const jobs = Number(arg('jobs', String(Math.max(1, Math.min(WORLD_PROFILES.length, cpus().length - 2)))))
const passThrough = process.argv.slice(2).filter((a, i, all) => a !== '--jobs' && all[i - 1] !== '--jobs')
const script = join(dirname(fileURLToPath(import.meta.url)), 'generateWorlds.ts')
const tsx = join(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/tsx/dist/cli.mjs')

function runOne(id: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsx, script, '--only', id, '--no-manifest', ...passThrough], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (d) => process.stdout.write(d))
    child.stderr.on('data', (d) => process.stderr.write(`[${id}] ${d}`))
    child.on('close', (code) => {
      if (code !== 0) console.error(`[${id}] exited with code ${code}`)
      resolve()
    })
  })
}

async function main(): Promise<void> {
  const queue = [...WORLD_PROFILES].map((p) => p.id)
  const started = Date.now()
  console.log(`generating ${queue.length} worlds, ${jobs} at a time`)
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) await runOne(id)
    }),
  )
  if (!process.argv.includes('--dry')) buildManifest()
  console.log(`done in ${((Date.now() - started) / 60000).toFixed(1)} min; manifest rebuilt`)
}

void main()
